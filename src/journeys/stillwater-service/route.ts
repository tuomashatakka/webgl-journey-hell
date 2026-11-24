// The ride: one closed flume, authored as a turtle path, sampled into a
// Catmull-Rom curve, timed by a monotone cubic through the leg ends.
//
// Pure maths, no GL: the renderer, the audio and the tests all read it.

import { createClosedCurve, newFrame } from '@wjh/geometry/curve'
import type { ClosedCurve, Frame } from '@wjh/geometry/curve'
import { levelFrame } from '@wjh/geometry/sweep'
import { clamp, smootherstep, smoothstep } from '@wjh/math/scalar'
import type { Act } from './timeline'
import { ACTS, LAP_COUNT, LAP_SECONDS } from './timeline'


const DEG     = Math.PI / 180
const GRAVITY = 9.81
const SAMPLE  = 2

/** Flume cross-section: radius, half-opening and shell, metres and radians. */
export const FLUME = { radius: 0.62, open: 95 * DEG, shell: 0.03, flange: 2.4 } as const

/** What the flume is made of along a stretch. */
export const SECTION = { tiled: 0, fibreglass: 1, acrylic: 2, belt: 3 } as const

const EYE       = 0.78
const BANK_MAX  = 70 * DEG
const LOOK_AHEAD = 4.5

type Section = typeof SECTION[keyof typeof SECTION]

interface LegSpec {
  act:      Act;
  seconds:  number;
  y:        number;
  length?:  number;
  turn?:    number;
  radius?:  number;
  section?: Section;
  solve?:   'run' | 'lift';
}

/**
 * Turns are degrees, positive toward +x from +z. They sum to three full turns.
 * The lounge's level run and the lift are solved so the path closes exactly.
 */
const LEGS: LegSpec[] = [
  { act: 'pool', seconds: 21, length: 34, y: 14, section: SECTION.tiled },
  { act: 'pool', seconds: 5, turn: 90, radius: 6, y: 14, section: SECTION.tiled },
  { act: 'annex', seconds: 4.5, length: 16, y: 11 },
  { act: 'annex', seconds: 3, length: 8, y: 11 },
  { act: 'annex', seconds: 3, turn: -90, radius: 3.2, y: 11 },
  { act: 'annex', seconds: 3, length: 8, y: 11 },
  { act: 'annex', seconds: 3, turn: 90, radius: 3.2, y: 11 },
  { act: 'annex', seconds: 5.5, length: 30, y: 11 },
  { act: 'spiral', seconds: 20, turn: 810, radius: 7, y: 3.5 },
  { act: 'breakwater', seconds: 5, length: 14, y: 3.5 },
  { act: 'breakwater', seconds: 6, turn: 25, radius: 36, y: 3.5 },
  { act: 'breakwater', seconds: 10, turn: -50, radius: 36, y: 3.5 },
  { act: 'breakwater', seconds: 5, turn: 25, radius: 36, y: 3.5 },
  { act: 'breakwater', seconds: 6, length: 18, y: 3.5 },
  { act: 'lounge', seconds: 4, turn: 90, radius: 12, y: 1.2 },
  { act: 'lounge', seconds: 4, length: 14, y: -4.6, section: SECTION.acrylic },
  { act: 'lounge', seconds: 7, length: 30, y: -4.6, section: SECTION.acrylic, solve: 'run' },
  { act: 'lounge', seconds: 5, length: 16, y: 0.6, section: SECTION.acrylic },
  { act: 'carousel', seconds: 7, turn: 180, radius: 7, y: 0.6 },
  { act: 'carousel', seconds: 3, turn: -90, radius: 6, y: 0.6 },
  { act: 'carousel', seconds: 14, length: 40, y: 14, section: SECTION.belt, solve: 'lift' },
]

const START = { x: 0, y: 14, z: 0, heading: 0 }

export interface Leg {
  act:     Act;
  seconds: number;
  section: Section;
  length:  number;

  /** Arc length along the closed curve where the leg starts and ends. */
  s0: number;
  s1: number;

  /** Turtle state at the leg's start. */
  x:       number;
  y:       number;
  z:       number;
  heading: number;

  /** Signed turn, radians, and the centre of the arc (arcs only). */
  turn:    number;
  radius:  number;
  centerX: number;
  centerZ: number;
}

interface Turtle {
  x:       number;
  y:       number;
  z:       number;
  heading: number;
}

function legLength (spec: LegSpec): number {
  return spec.length ?? Math.abs(spec.turn ?? 0) * DEG * (spec.radius ?? 1)
}

/** Position along a leg at fraction u, from the turtle state at its start. */
function walk (spec: LegSpec, from: Turtle, u: number, out: Turtle): Turtle {
  const turn   = (spec.turn ?? 0) * DEG
  out.y        = from.y + (spec.y - from.y) * smootherstep(0, 1, u)
  if (!turn) {
    const d     = legLength(spec) * u
    out.x       = from.x + Math.sin(from.heading) * d
    out.z       = from.z + Math.cos(from.heading) * d
    out.heading = from.heading
    return out
  }

  const r     = spec.radius ?? 1
  const side  = Math.sign(turn)
  const cx    = from.x + Math.sin(from.heading + side * Math.PI / 2) * r
  const cz    = from.z + Math.cos(from.heading + side * Math.PI / 2) * r
  const angle = from.heading - side * Math.PI / 2 + turn * u
  out.x       = cx + Math.sin(angle) * r
  out.z       = cz + Math.cos(angle) * r
  out.heading = from.heading + turn * u
  return out
}

function trace (specs: LegSpec[]): { points: Turtle[]; starts: Turtle[]; end: Turtle } {
  const points: Turtle[] = []
  const starts: Turtle[] = []
  let at: Turtle         = { ...START }
  for (const spec of specs) {
    starts.push({ ...at })
    const n = Math.max(1, Math.round(legLength(spec) / SAMPLE))
    for (let i = 0; i < n; i++)
      points.push(walk(spec, at, i / n, { x: 0, y: 0, z: 0, heading: 0 }))
    at = walk(spec, at, 1, { x: 0, y: 0, z: 0, heading: 0 })
  }
  return { points, starts, end: at }
}

/** Lengthen the two free straights until the path ends where it began. */
function solveLegs (): LegSpec[] {
  const specs = LEGS.map(spec => ({ ...spec }))
  const { starts, end } = trace(specs)
  for (const [ i, spec ] of specs.entries()) {
    if (!spec.solve)
      continue

    const h      = starts[i].heading
    const dx     = START.x - end.x
    const dz     = START.z - end.z
    const along  = spec.solve === 'run' ? Math.sin(h) * dx : Math.cos(h) * dz
    spec.length = (spec.length ?? 0) + along
  }
  return specs
}

/** Index of the arc-length sample nearest `p`, searched near a guess. */
function nearestS (curve: ClosedCurve, p: Turtle, guess: number): number {
  let best  = guess
  let bestD = Infinity
  const q   = { x: 0, y: 0, z: 0 }
  for (let s = guess - 6; s <= guess + 6; s += 0.02) {
    curve.pointAtDistance((s + curve.length) % curve.length, q)
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2 + (q.z - p.z) ** 2
    if (d < bestD) {
      bestD = d
      best  = s
    }
  }
  return clamp(best, 0, curve.length)
}

function harmonic (a: number, b: number): number {
  return 2 / (1 / a + 1 / b)
}

function hermite (s0: number, s1: number, m0: number, m1: number, dt: number, u: number): { s: number; v: number } {
  const u2 = u * u
  const u3 = u2 * u
  const s  = (2 * u3 - 3 * u2 + 1) * s0 + (u3 - 2 * u2 + u) * m0 * dt + (-2 * u3 + 3 * u2) * s1 + (u3 - u2) * m1 * dt
  const v  = ((6 * u2 - 6 * u) * s0 + (3 * u2 - 4 * u + 1) * m0 * dt + (-6 * u2 + 6 * u) * s1 + (3 * u2 - 2 * u) * m1 * dt) / dt
  return { s, v }
}

function buildRoute () {
  const specs              = solveLegs()
  const { points, starts } = trace(specs)
  const curve              = createClosedCurve(points.map(({ x, y, z }) => ({ x, y, z })), 16)
  const length             = curve.length

  let guess   = 0
  const legs: Leg[] = specs.map((spec, i) => {
    const from = starts[i]
    const s0   = i === 0 ? 0 : nearestS(curve, from, guess)
    guess      = s0 + legLength(spec)
    const turn = (spec.turn ?? 0) * DEG
    const side = Math.sign(turn)
    const r    = spec.radius ?? 0
    return {
      act:     spec.act,
      seconds: spec.seconds,
      section: spec.section ?? SECTION.fibreglass,
      length:  legLength(spec),
      s0,
      s1:      0,
      ...from,
      turn,
      radius:  r,
      centerX: from.x + Math.sin(from.heading + side * Math.PI / 2) * r,
      centerZ: from.z + Math.cos(from.heading + side * Math.PI / 2) * r,
    }
  })
  legs.forEach((leg, i) => {
    leg.s1 = i + 1 < legs.length ? legs[i + 1].s0 : length
  })

  // The clock: knots at every leg end, slopes by harmonic mean, periodic.
  const knotsT = [ 0 ]
  for (const leg of legs)
    knotsT.push(knotsT[knotsT.length - 1] + leg.seconds)
  const knotsS = [ ...legs.map(leg => leg.s0), length ]
  const slopes = legs.map((leg, i) => (knotsS[i + 1] - knotsS[i]) / leg.seconds)
  const tangents = knotsS.map((_, i) => harmonic(slopes[(i - 1 + legs.length) % legs.length], slopes[i % legs.length]))

  function travel (within: number, lap: number): { s: number; v: number; leg: number } {
    const t = clamp(within, 0, LAP_SECONDS)
    let k   = legs.length - 1
    while (knotsT[k] > t)
      k--
    const dt   = knotsT[k + 1] - knotsT[k]
    const last = k === legs.length - 1 && lap === LAP_COUNT - 1
    const { s, v } = hermite(knotsS[k], knotsS[k + 1], tangents[k], last ? 0 : tangents[k + 1], dt, (t - knotsT[k]) / dt)
    return { s, v, leg: k }
  }

  // Speed by arc length, for the bank: walk the lap-1 clock finely.
  const BANK_STEP = 0.25
  const speedByS  = new Float32Array(Math.ceil(length / BANK_STEP) + 1)
  for (let t = 0; t <= LAP_SECONDS; t += 0.01) {
    const { s, v } = travel(t, 0)
    speedByS[Math.min(speedByS.length - 1, Math.round(s / BANK_STEP))] = v
  }
  for (let i = 1; i < speedByS.length; i++)
    if (!speedByS[i])
      speedByS[i] = speedByS[i - 1]

  // The bank: lateral acceleration against gravity, signed to the frame's
  // right, windowed so a straight-to-arc join does not snap the rider over.
  const frameA = newFrame()
  const frameB = newFrame()
  const raw    = new Float32Array(speedByS.length)
  for (let i = 0; i < raw.length; i++) {
    const s = i * BANK_STEP
    levelFrame(curve, (s - 0.5 + length) % length, frameA)
    levelFrame(curve, (s + 0.5) % length, frameB)
    const bend = (frameB.forward.x - frameA.forward.x) * frameA.right.x + (frameB.forward.z - frameA.forward.z) * frameA.right.z
    const v    = speedByS[i]
    raw[i]     = -Math.atan(v * v * bend / GRAVITY)
  }
  const bankByS = new Float32Array(raw.length)
  const W       = Math.round(3 / BANK_STEP)
  for (let i = 0; i < raw.length; i++) {
    let sum = 0
    for (let j = -W; j <= W; j++)
      sum += raw[(i + j + raw.length) % raw.length] * (1 - Math.abs(j) / (W + 1))
    bankByS[i] = clamp(sum / (W + 1), -BANK_MAX, BANK_MAX)
  }

  function lookup (table: Float32Array, s: number): number {
    const f = ((s % length) + length) % length / BANK_STEP
    const i = Math.floor(f)
    const a = table[Math.min(i, table.length - 1)]
    const b = table[Math.min(i + 1, table.length - 1)]
    return a + (b - a) * (f - i)
  }

  function legAt (s: number): Leg {
    const w = ((s % length) + length) % length
    return legs.find(leg => w < leg.s1) ?? legs[legs.length - 1]
  }

  return {
    curve,
    length,
    legs,
    travel,
    bankAt:    (s: number) => lookup(bankByS, s),
    speedAt:   (s: number) => lookup(speedByS, s),
    sectionAt: (s: number) => legAt(s).section,
    legAt,
  }
}

export type Route = ReturnType<typeof buildRoute>

let cached: Route | null = null

export function getRoute (): Route {
  cached ??= buildRoute()
  return cached
}

export interface Pose {
  eye:     [number, number, number];
  forward: [number, number, number];
  up:      [number, number, number];
  speed:   number;
  s:       number;
}

export function createPose (): Pose {
  return { eye: [ 0, 0, 0 ], forward: [ 0, 0, 1 ], up: [ 0, 1, 0 ], speed: 0, s: 0 }
}

const frame: Frame = newFrame()
const ahead: Frame = newFrame()

/** Where the rider sits and looks at `within` seconds into `lap`. */
export function setPose (
  pose: Pose, within: number, lap: number, time: number, warp: number, panX: number, panY: number,
): void {
  const route     = getRoute()
  const { s, v }  = route.travel(within, lap)
  const bank      = route.bankAt(s)
  levelFrame(route.curve, s % route.length, frame)
  route.curve.pointAtDistance((s + LOOK_AHEAD) % route.length, ahead.pos)

  const r  = FLUME.radius
  const cb = Math.cos(bank)
  const sb = Math.sin(bank)
  // The rider's own up: from the trough wall they sit on toward its axis.
  const ux = frame.up.x * cb - frame.right.x * sb
  const uy = frame.up.y * cb - frame.right.y * sb
  const uz = frame.up.z * cb - frame.right.z * sb
  const bob = 0.018 * Math.sin(time * 2.3) + 0.01 * Math.sin(time * 3.7 + 1)
  // Sat up where the channel is lazy, lying back where it is fast.
  const seatR = EYE + 0.3 * smoothstep(2.6, 1.6, route.speedAt(s)) + bob
  // Seat on the wall at the bank angle, eye along the rider's up.
  const bx  = frame.pos.x + frame.up.x * r + (frame.right.x * sb - frame.up.x * cb) * r
  const by  = frame.pos.y + frame.up.y * r + (frame.right.y * sb - frame.up.y * cb) * r
  const bz  = frame.pos.z + frame.up.z * r + (frame.right.z * sb - frame.up.z * cb) * r
  pose.eye[0] = bx + ux * seatR
  pose.eye[1] = by + uy * seatR
  pose.eye[2] = bz + uz * seatR

  // Look between the tangent and a point down the flume.
  let fx    = ahead.pos.x - pose.eye[0]
  let fy    = ahead.pos.y + EYE * 0.7 - pose.eye[1]
  let fz    = ahead.pos.z - pose.eye[2]
  const fl  = Math.hypot(fx, fy, fz) || 1
  fx        = fx / fl * 0.6 + frame.forward.x * 0.4
  fy        = fy / fl * 0.6 + frame.forward.y * 0.4 - 0.08
  fz        = fz / fl * 0.6 + frame.forward.z * 0.4

  // Roll: the bank, then on the later laps the twist the world is in.
  const roll = warp * 0.42 * Math.sin(time * 0.21) * Math.sin(time * 0.057 + 0.4)
  const cr   = Math.cos(roll)
  const sr   = Math.sin(roll)
  let upx    = ux * cr + (frame.right.x * cb + frame.up.x * sb) * sr
  let upy    = uy * cr + (frame.right.y * cb + frame.up.y * sb) * sr
  let upz    = uz * cr + (frame.right.z * cb + frame.up.z * sb) * sr

  // Gaze: yaw about the rider's up, pitch about the resulting right.
  const yaw   = panX * 1.05
  const pitch = panY * 0.62
  const rx    = fy * upz - fz * upy
  const ry    = fz * upx - fx * upz
  const rz    = fx * upy - fy * upx
  const rl    = Math.hypot(rx, ry, rz) || 1
  const cy    = Math.cos(yaw)
  const sy    = Math.sin(yaw)
  let dx      = fx * cy + rx / rl * sy
  let dy      = fy * cy + ry / rl * sy
  let dz      = fz * cy + rz / rl * sy
  const dl    = Math.hypot(dx, dy, dz) || 1
  dx /= dl
  dy /= dl
  dz /= dl
  const cp = Math.cos(pitch)
  const sp = Math.sin(pitch)
  const ox = dx * cp + upx * sp
  const oy = dy * cp + upy * sp
  const oz = dz * cp + upz * sp
  upx      = upx * cp - dx * sp
  upy      = upy * cp - dy * sp
  upz      = upz * cp - dz * sp

  pose.forward[0] = ox
  pose.forward[1] = oy
  pose.forward[2] = oz
  pose.up[0]      = upx
  pose.up[1]      = upy
  pose.up[2]      = upz
  pose.speed      = v
  pose.s          = s % route.length
}

/** The act each leg belongs to, in order, for the tests. */
export const ACT_ORDER = ACTS.map(act => act.id)
