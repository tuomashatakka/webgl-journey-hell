import { FALL_START, LAP_LEN, PHASE_WRAP, SECTIONS, SECTION_COUNT, beatAt, gradeAt, liftAt, yawAt } from './route'
import { D, DRAG, FIT_Z2, G, ROLL_RES, V_MAX, V_MIN } from './constants'

/** The peak-to-mean ratio of the above. Curvature caps are stated against it. */
const EASE_PEAK = 1.875

/** Sleeper pitch, and the bay spacing of the trestle bents. Both divide PHASE_WRAP. */
const TIE_PITCH  = 2.5

const BENT_PITCH = 10

/**
 * Smallest turn radius the rectification can carry, as a curvature. A quadratic
 * in z cannot follow a track out of the +Z half-space, so this is a hard
 * property of the technique rather than a taste call: at 1/44 per metre a
 * sustained turn has swung 73 degrees by the far end of the fit, which is about
 * as much as a quadratic can be asked to swallow before the far half of the
 * picture stops being the track and starts being an extrapolation.
 *
 * It is not a limit on how a turn *feels*. Lateral acceleration is v^2/r, so
 * this radius at the speed the void section runs at is 0.9g in your ribs.
 */
const MAX_CURV = 1 / 44

/**
 * ...and how much of a turn the fit may be asked to swallow whole. MAX_CURV
 * bounds the shear at a point, which is a cost. This bounds the *integral* over
 * the range the quadratic is pinned across, which is correctness: a track that
 * swings much past a radian inside the visible range has left the +Z half-space,
 * and no quadratic in z can follow it out of there.
 */
const MAX_WINDOW_TURN = 1

/**
 * Dev-only guard for the properties the route table cannot be allowed to break.
 * Every one of these produces a *geometry* bug rather than a type error, which
 * is exactly the class worth asserting instead of discovering in a screenshot.
 */
export function assertRouteSane (): string[] {
  const problems: string[] = []

  for (let i = 0; i < SECTION_COUNT; i++) {
    const s    = SECTIONS[i]
    const next = SECTIONS[(i + 1) % SECTION_COUNT]

    if (s.grade.length !== s.turn.length + 1)
      problems.push(`${s.name}: ${s.turn.length} beats needs ${s.turn.length + 1} grades, has ${s.grade.length}`)

    if (s.lift.length !== s.turn.length)
      problems.push(`${s.name}: ${s.turn.length} beats needs ${s.turn.length} lift entries, has ${s.lift.length}`)

    if (Math.abs(s.grade[s.grade.length - 1] - next.grade[0]) > 1e-9)
      problems.push(`${s.name} -> ${next.name}: grade steps by ` +
        `${((next.grade[0] - s.grade[s.grade.length - 1]) / D).toFixed(2)} deg — the tangent is discontinuous`)

    const beatLen = s.len / s.turn.length
    for (let j = 0; j < s.turn.length; j++) {
      const k = Math.abs(s.turn[j]) * EASE_PEAK / beatLen
      if (k > MAX_CURV + 1e-9)
        problems.push(`${s.name} beat ${j}: peak curvature 1/${(1 / k).toFixed(0)}m is tighter ` +
          `than 1/${(1 / MAX_CURV).toFixed(0)}m — the bend fit cannot follow it`)

      const dg = Math.abs(s.grade[j + 1] - s.grade[j]) * EASE_PEAK / beatLen
      if (dg > MAX_CURV + 1e-9)
        problems.push(`${s.name} beat ${j}: vertical curvature 1/${(1 / dg).toFixed(0)}m is too tight`)
    }

    for (const g of s.grade)
      if (Math.abs(g) > 30 * D)
        problems.push(`${s.name}: ${(g / D).toFixed(0)} deg grade is past the 30 deg the fit is honest over`)

    // Two consecutive sections have to cover everything the march can reach, or
    // there is a stretch of track ahead with no room around it — a hole.
    if (s.len + next.len < 90)
      problems.push(`${s.name} + ${next.name} span ${s.len + next.len}m, less than the march reaches`)

    if (s.lampY >= s.ceilH || s.lampY <= 0)
      problems.push(`${s.name}: lamps at ${s.lampY}m are not inside a room ${s.ceilH}m tall`)

    if (s.lamp > 0 && Math.abs(PHASE_WRAP / s.lamp - Math.round(PHASE_WRAP / s.lamp)) > 1e-9)
      problems.push(`${s.name}: lamp pitch ${s.lamp} does not divide PHASE_WRAP — the lamps will jump on the fold`)
  }

  // The windowed bound. Walked numerically rather than derived, because it is a
  // property of the table as a whole — a turn can be inside the pointwise cap in
  // every beat and still add up to a fold-back across a join.
  for (let start = 0; start < LAP_LEN; start += 2) {
    const dYaw   = Math.abs(yawAt(start + FIT_Z2) - yawAt(start))
    const dGrade = Math.abs(gradeAt(start + FIT_Z2) - gradeAt(start))
    if (dYaw > MAX_WINDOW_TURN)
      problems.push(`s=${start}: the track turns ${dYaw.toFixed(2)} rad inside the fit window — ` +
        'a quadratic cannot follow that out of the +Z half-space')
    if (dGrade > MAX_WINDOW_TURN)
      problems.push(`s=${start}: the grade turns ${dGrade.toFixed(2)} rad inside the fit window`)
  }

  // A chain that lets go *before* the crest strands the cart on the hill, and
  // the cart cannot be stranded, so V_MIN quietly carries it over instead and
  // the ride silently stops being a gravity railway. Walk the profile and say so
  // instead: anywhere the cart runs free and uphill, it must arrive with enough
  // speed to reach the next place the grade turns down.
  {
    let v         = 12
    let stalledAt = ''
    for (let k = 0; k < 4000; k++) {
      const s     = k * (LAP_LEN / 4000)
      const g     = gradeAt(s)
      const chain = liftAt(s)
      const h     = LAP_LEN / 4000 / Math.max(v, 0.05)
      if (chain > 0)
        v += (chain - v) * (1 - Math.exp(-h / 0.55))
      else
        v += (-G * Math.sin(g) - DRAG * v * v - ROLL_RES * G * Math.cos(g)) * h
      if (v < V_MIN + 0.05 && !stalledAt)
        stalledAt = `${s.toFixed(0)}m (${beatAt(s).sec.name})`
      v = Math.max(V_MIN, Math.min(V_MAX, v))
    }
    if (stalledAt)
      problems.push(`the cart valleys at ${stalledAt} and only V_MIN carries it over — ` +
        'the chain has to run past the crest, not stop at it')
  }

  // The pitch-over is a pure function of one grade, so two sections that agreed
  // before it still agree after it — but the seam into the shaft is a different
  // formula meeting the tipped-over one, and that is worth asserting rather than
  // discovering as a derailment on the fourth lap.
  {
    const before = gradeAt(FALL_START - 1e-4)
    const after  = gradeAt(FALL_START + 1e-4)
    if (Math.abs(before - after) > 1e-3)
      problems.push(`the rails end with a ${((after - before) / D).toFixed(2)} deg step ` +
        'into the shaft — the tangent is discontinuous')
  }

  for (const [ label, pitch ] of [[ 'TIE_PITCH', TIE_PITCH ], [ 'BENT_PITCH', BENT_PITCH ]] as const)
    if (Math.abs(PHASE_WRAP / pitch - Math.round(PHASE_WRAP / pitch)) > 1e-9)
      problems.push(`${label} ${pitch} does not divide PHASE_WRAP`)

  return problems
}
