// The VHS transport: fast-forward, rewind, and section skip for a journey.
//
// The problem it has to solve is that a journey is an *integrator*, not a
// timeline. `z += speed(z) * dt`, and speed depends on where you already are
// (see natatorium, hollow-orchard, stairwell), so there is no closed form for
// "where am I at t = 90" — the only way to know is to walk it. lib/debugParams
// already established the walk (`seekSimulation`); this file establishes which
// t to walk to.
//
// Forward and backward are therefore asymmetric, and deliberately so:
//
//   forward   — the destination is not known in advance. Step the live
//               simulation fast and watch `marks()` until the index changes.
//               Cheap: it is the same integration the journey does anyway,
//               just many times per frame.
//
//   backward  — the destination *is* known, because time only ever starts at
//               zero. Every boundary the journey has crossed was crossed while
//               being watched, so a log of "the time loop N began" is complete
//               for every N at or below the current one. Rewinding reads the
//               log and replays a fresh simulation up to that time.
//
// The log survives rewinds, and re-crossing a boundary produces the same time
// again, because the replay is deterministic — that is the whole reason
// seekSimulation divides t into equal steps rather than stepping until it
// overshoots.

import { MAX_SEEK_STEPS, seekSimulation } from './debugParams'


/**
 * Where a journey is in its own structure. Every simulation already computes
 * this; the shapes just differ too much to infer it from `uniforms()` (compare
 * stairwell's flat scalars against loop-line's packed vec4s).
 */
export interface JourneyMarks {

  /** Integer lap index. 0 always, for journeys with no lap concept. */
  loop: number;

  /** Integer section index within the lap. */
  section: number;

  /** How many sections a lap has — the tick count on the progress bar. */
  sectionCount: number;

  /** 0..1 position within the lap. The tape position. */
  progress: number;

  /** Set once the route has stopped advancing. */
  terminal?: boolean;

  /**
   * Seconds spent in the state the journey does not come back from — a
   * persistent ending section, or enough laps that the route has stopped going
   * anywhere. 0 while it is still a journey.
   *
   * Counted inside each simulation's own `step`, never by whoever is watching:
   * `seekSimulation` replays a simulation from zero without the shell
   * observing, so an accumulator kept out here would not survive a seek and the
   * signal loss would vanish on every `?t=`. See lib/signalLoss.
   */
  signalAge?: number;
}

/** What the transport needs from whatever owns the live simulation. */
export interface TransportHost {

  /** A fresh simulation at t = 0, or null when the journey has none. */
  createSimulation(): TransportSim | null;

  /** Replace the live simulation and clock. Used by every backward move. */
  adopt(sim: TransportSim | null, time: number): void;

  /** The live simulation and clock. */
  current(): { sim: TransportSim | null; time: number };

  /** Advance the live simulation by dt and the clock with it. No drawing. */
  advance(dt: number): void;

  /**
   * Marks for a journey with no simulation — motion authored in GLSL, position
   * a pure function of the clock. Consulted only when the simulation has none.
   */
  marksAt?(time: number): JourneyMarks | undefined;
}

export interface TransportSim {
  step(dt: number, time: number): void;
  marks?(): JourneyMarks;
}

export type TransportAction = 'ff' | 'rew' | 'next' | 'prev'
export type TransportMode = 'play' | 'ff' | 'rew' | 'flash'

export interface TransportState {
  mode: TransportMode;

  /** -1 backward, +1 forward, 0 idle. Signs the tape motion in the CRT pass. */
  scrub: number;

  /** 0..1, eased. Drives the CRT pass's scrub treatment. */
  scrubMix: number;
}

// Forward shuttle. 24 steps of 1/30s per frame is ~0.8s of journey time a
// frame — fast enough to read as a shuttle, slow enough that you can actually
// see what you are passing. It was half again this and the world went by as a
// smear, which is a fast-forward you cannot navigate with.
const FF_STEP_DT     = 1 / 30
const FF_STEPS_FRAME = 24
const SKIP_STEP_DT   = 1 / 20

/** Journey-seconds a single forward move may cover before giving up. */
const FORWARD_BUDGET = 600

/** Coarse replay dt while rewinding — 3x cheaper per frame than the live 1/60. */
const REW_SEEK_DT = 1 / 20

/** How long you must be *into* a section before ⏮ rewinds to its own start. */
const REPLAY_GRACE_SECTION = 1.5
const REPLAY_GRACE_LOOP    = 3.0

const FLASH_SECONDS = 0.28

// A journey with no marks() still gets working transport, it just moves by the
// clock instead of by structure. These are the "loop" and "section" it pretends
// to have. Shader-only journeys are pure functions of time, so seeking them is
// exact and this is not an approximation of anything.
const FALLBACK_LOOP_SECONDS    = 30
const FALLBACK_SECTION_SECONDS = 8

interface Boundary {
  time:    number;
  loop:    number;
  section: number;
}

export interface JourneyTransport {

  /** Record where the journey is. Call once per live frame, before drawing. */
  observe(time: number, marks: JourneyMarks | null): void;

  /** Begin a move. Ignored while another one is running. */
  request(action: TransportAction): void;

  /**
   * Drive the in-flight move by one real frame and ease the effect mix.
   * Returns what the CRT pass and the HUD should show.
   */
  tick(realDt: number): TransportState;

  /** True while a move is running — the shell suppresses audio updates then. */
  isScrubbing(): boolean;
}

export function createJourneyTransport (host: TransportHost): JourneyTransport {
  const log: Boundary[] = [{ time: 0, loop: 0, section: 0 }]

  // Earliest recorded entry time per lap. Written once per lap; a re-crossing
  // after a rewind produces the same number, so `min` is belt and braces.
  const loopStart = new Map<number, number>([[ 0, 0 ]])

  let lastLoop    = 0
  let lastSection = 0

  let mode: TransportMode = 'play'
  let dir                 = 0
  let mix                 = 0
  let flashLeft           = 0

  // Forward move
  let ffFromLoop             = 0
  let ffFromSection          = 0
  let ffWantSection          = false
  let ffSpent                = 0
  let ffUntil: number | null = null // set only on the no-marks path

  // Backward move
  let rewFrom   = 0
  let rewTo     = 0
  let rewFrames = 0
  let rewFrame  = 0

  const marksOf = (): JourneyMarks | null => {
    const { sim, time } = host.current()
    return sim?.marks?.() ?? host.marksAt?.(time) ?? null
  }

  const record = (time: number, m: JourneyMarks) => {
    if (m.loop === lastLoop && m.section === lastSection)
      return

    lastLoop    = m.loop
    lastSection = m.section
    log.push({ time, loop: m.loop, section: m.section })

    const prev = loopStart.get(m.loop)
    if (prev === undefined || time < prev)
      loopStart.set(m.loop, time)
  }

  /** Start time of the section containing `time`, from the log. */
  const sectionStart = (time: number): number => {
    for (let i = log.length - 1; i >= 0; i--)
      if (log[i].time <= time + 1e-6)
        return log[i].time
    return 0
  }

  /** Start time of the section before the one containing `time`. */
  const previousSectionStart = (time: number): number => {
    const here = sectionStart(time)
    for (let i = log.length - 1; i >= 0; i--)
      if (log[i].time < here - 1e-6)
        return log[i].time
    return 0
  }

  /** Replay a fresh simulation up to `t` and make it the live one. */
  const seekTo = (t: number) => {
    const sim = host.createSimulation()
    seekSimulation(sim, t, REW_SEEK_DT)
    host.adopt(sim, t)

    // The log stays authoritative — re-observing on the way back would append
    // duplicates for boundaries already recorded on the way out.
    const m = marksOf()
    if (m) {
      lastLoop    = m.loop
      lastSection = m.section
    }
  }

  const beginBackward = (target: number, frames: number) => {
    const { time } = host.current()
    rewFrom   = time
    rewTo     = Math.max(0, Math.min(target, time))
    rewFrames = Math.max(1, frames)
    rewFrame  = 0
    mode      = 'rew'
    dir       = -1
  }

  const beginForward = (wantSection: boolean) => {
    const m = marksOf()

    ffWantSection = wantSection
    ffFromLoop    = m?.loop ?? 0
    ffFromSection = m?.section ?? 0
    ffSpent       = 0
    dir           = 1

    if (!m) {
      // No structure to aim at: move by the clock instead.
      const span = wantSection ? FALLBACK_SECTION_SECONDS : FALLBACK_LOOP_SECONDS
      ffUntil    = host.current().time + span
      mode       = 'ff'
      return
    }

    ffUntil = null

    if (!wantSection) {
      mode = 'ff'
      return
    }

    // A section skip is instantaneous — run the whole search now and let the
    // flash cover the jump.
    let steps = 0
    while (steps++ < MAX_SEEK_STEPS && ffSpent < FORWARD_BUDGET) {
      host.advance(SKIP_STEP_DT)
      ffSpent += SKIP_STEP_DT

      const now = marksOf()
      if (!now)
        break
      record(host.current().time, now)
      if (now.section !== ffFromSection || now.loop !== ffFromLoop || now.terminal)
        break
    }
    mode      = 'flash'
    flashLeft = FLASH_SECONDS
  }

  return {
    observe (time, marks) {
      if (marks)
        record(time, marks)
    },

    request (action) {
      if (mode !== 'play')
        return

      const { time } = host.current()
      const m        = marksOf()

      switch (action) {
        case 'ff':
          beginForward(false)
          break
        case 'next':
          beginForward(true)
          break
        case 'rew': {
          if (time <= 1e-6)
            return

          let target: number
          if (m) {
            const here = loopStart.get(m.loop) ?? 0
            // Media convention: rewind restarts the current lap unless you have
            // only just entered it, in which case it goes back one further.
            target = time - here > REPLAY_GRACE_LOOP
              ? here
              : loopStart.get(m.loop - 1) ?? 0
          }
          else
            target = time - FALLBACK_LOOP_SECONDS

          // Each rewind frame replays from zero, so the animation costs
          // O(frames x t). Shorten it on a long-running journey rather than
          // dropping frames on it.
          beginBackward(target, time > 120 ? 14 : 32)
          break
        }

        case 'prev': {
          if (time <= 1e-6)
            return

          let target: number
          if (m) {
            const here = sectionStart(time)
            target = time - here > REPLAY_GRACE_SECTION
              ? here
              : previousSectionStart(time)
          }
          else
            target = time - FALLBACK_SECTION_SECONDS

          seekTo(Math.max(0, target))
          dir       = -1
          mode      = 'flash'
          flashLeft = FLASH_SECONDS
          break
        }
      }
    },

    tick (realDt) {
      const dt = Math.min(Math.max(realDt, 0), 0.1)

      if (mode === 'ff') {
        let done = false
        for (let i = 0; i < FF_STEPS_FRAME; i++) {
          host.advance(FF_STEP_DT)
          ffSpent += FF_STEP_DT

          if (ffUntil !== null) {
            if (host.current().time >= ffUntil)
              done = true
          }
          else {
            const now = marksOf()
            if (!now)
              done = true; else {
              record(host.current().time, now)
              if (now.loop !== ffFromLoop || ffWantSection && now.section !== ffFromSection)
                done = true
              else if (now.terminal)
                done = true
            }
          }

          if (done || ffSpent >= FORWARD_BUDGET) {
            done = true
            break
          }
        }
        if (done)
          mode = 'play'
      }
      else if (mode === 'rew') {
        rewFrame += 1

        const k = Math.min(1, rewFrame / rewFrames)
        seekTo(rewFrom + (rewTo - rewFrom) * k)
        if (k >= 1)
          mode = 'play'
      }
      else if (mode === 'flash') {
        flashLeft -= dt
        if (flashLeft <= 0)
          mode = 'play'
      }

      // Ease in hard, ease out slowly — a tape settles, it does not snap.
      const wanted = mode === 'play' ? 0 : 1
      const rate   = wanted > mix ? 10 : 3.5
      mix += (wanted - mix) * Math.min(1, rate * dt)
      if (mix < 0.002)
        mix = 0

      return { mode, scrub: mix > 0 ? dir : 0, scrubMix: mix }
    },

    isScrubbing () {
      return mode !== 'play'
    },
  }
}
