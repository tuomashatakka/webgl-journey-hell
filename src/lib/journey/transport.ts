// The tape deck: chapter and lap jumps, and scrubbing along the lap.
//
// The problem it has to solve is that a journey is an *integrator*, not a
// timeline. `z += speed(z) * dt`, and speed depends on where you already are,
// so there is no closed form for "when does section 3 begin" — the only way to
// know is to walk it. Forward and backward are therefore asymmetric:
//
//   forward   — the destination is not known in advance. Step the live
//               simulation fast and watch `marks()` until it gets there. Cheap:
//               the same integration the journey does anyway, many times in
//               one frame.
//
//   backward  — the destination *is* known, because time only ever starts at
//               zero. Every boundary the journey has crossed was crossed while
//               being watched, so the log of "section N began at t" — and of
//               where along the lap every instant was — is complete for
//               everything behind the playhead. Going back reads the log and
//               replays a fresh simulation up to that time.
//
// The log survives jumps, and re-crossing a boundary produces the same time
// again because the replay is deterministic: seekSimulation divides t into
// equal steps rather than stepping until it overshoots.
//
// Every move is a cut (with the tape flash to cover it), never a shuttle: a
// chapter button that fast-forwards through time to get somewhere is a
// different control from one that goes there.

import type { JourneyMarks } from './types'
import { MAX_SEEK_STEPS, seekSimulation } from './seek'


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

export type TransportAction = 'prev-lap' | 'prev' | 'next' | 'next-lap'
export type TransportMode = 'play' | 'flash' | 'scrub'

export interface TransportState {
  mode: TransportMode;

  /** -1 backward, +1 forward, 0 idle. Signs the tape motion in the CRT pass. */
  scrub: number;

  /** 0..1, eased. Drives the CRT pass's scrub treatment. */
  scrubMix: number;
}

export interface JourneyTransport {

  /** Record where the journey is. Call once per live frame, before drawing. */
  observe(time: number, marks: JourneyMarks | null): void;

  /** Jump by structure. Ignored mid-scrub. */
  request(action: TransportAction): void;

  /**
   * Move the playhead to `fraction` (0..1) of the current lap. Called on every
   * pointer move; applied at most once per frame, on the next `tick`.
   */
  scrub(fraction: number): void;

  /** The pointer let go: settle back to play. */
  release(): void;

  /**
   * Apply anything pending and ease the effect mix by one real frame.
   * Returns what the CRT pass and the HUD should show.
   */
  tick(realDt: number): TransportState;

  /** True while scrubbing or flashing — the shell silences audio then. */
  isScrubbing(): boolean;
}

/** Forward search step: coarse, because it may cover minutes in one frame. */
const SEARCH_DT = 1 / 20

/** Journey-seconds a single forward move may cover before giving up. */
const FORWARD_BUDGET = 900

/** Replay dt for backward moves. */
const SEEK_DT = 1 / 20

/** How long you must be *into* a section (or lap) before going back restarts it. */
const GRACE_SECTION = 1.5
const GRACE_LOOP    = 3

const FLASH_SECONDS = 0.28

/** A progress sample is kept every this much of the lap. */
const SAMPLE_STEP = 0.0025

// A journey with no marks() still gets working transport, it just moves by the
// clock. These are the "lap" and "section" it pretends to have.
const FALLBACK_LOOP_SECONDS    = 30
const FALLBACK_SECTION_SECONDS = 8

interface Boundary {
  time:    number;
  loop:    number;
  section: number;
}

/** Monotonic (time, progress) pairs for one lap. */
interface Track {
  t: number[];
  p: number[];
}

export function createJourneyTransport (host: TransportHost): JourneyTransport {
  const log: Boundary[] = [{ time: 0, loop: 0, section: 0 }]
  const loopStart       = new Map<number, number>([[ 0, 0 ]])
  const tracks          = new Map<number, Track>()

  let lastLoop    = 0
  let lastSection = 0

  let mode: TransportMode         = 'play'
  let dir                         = 0
  let mix                         = 0
  let flashLeft                   = 0
  let pendingScrub: number | null = null
  let scrubbing                   = false

  const marksOf = (): JourneyMarks | null => {
    const { sim, time } = host.current()
    return sim?.marks?.() ?? host.marksAt?.(time) ?? null
  }

  const record = (time: number, m: JourneyMarks) => {
    let track = tracks.get(m.loop)
    if (!track) {
      track = { t: [], p: []}
      tracks.set(m.loop, track)
    }

    const n = track.t.length
    if (n === 0 || time > track.t[n - 1] && m.progress >= track.p[n - 1] + SAMPLE_STEP) {
      track.t.push(time)
      track.p.push(m.progress)
    }

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

  /** When lap `loop` was at `progress`, interpolated from its track. */
  const timeAtProgress = (loop: number, progress: number): number => {
    const track = tracks.get(loop)
    const start = loopStart.get(loop) ?? 0
    if (!track || track.t.length === 0 || progress <= track.p[0])
      return start

    let lo = 0
    let hi = track.p.length - 1
    if (progress >= track.p[hi])
      return track.t[hi]
    while (hi - lo > 1) {
      const mid = lo + hi >> 1
      if (track.p[mid] <= progress)
        lo = mid
      else
        hi = mid
    }

    const k = (progress - track.p[lo]) / Math.max(1e-9, track.p[hi] - track.p[lo])
    return track.t[lo] + (track.t[hi] - track.t[lo]) * k
  }

  /** Replay a fresh simulation up to `t` and make it the live one. */
  const seekTo = (t: number) => {
    const sim = host.createSimulation()
    seekSimulation(sim, Math.max(0, t), SEEK_DT)
    host.adopt(sim, Math.max(0, t))

    // The log stays authoritative — re-observing on the way back would append
    // duplicates for boundaries already recorded on the way out.
    const m = marksOf()
    if (m) {
      lastLoop    = m.loop
      lastSection = m.section
    }
  }

  /** Step the live simulation until `arrived` says so (or the budget runs out). */
  const forwardUntil = (arrived: (now: JourneyMarks) => boolean) => {
    let spent = 0
    let steps = 0
    while (steps++ < MAX_SEEK_STEPS && spent < FORWARD_BUDGET) {
      host.advance(SEARCH_DT)
      spent += SEARCH_DT

      const now = marksOf()
      if (!now)
        return
      record(host.current().time, now)
      if (arrived(now) || now.terminal)
        return
    }
  }

  const flash = (direction: number) => {
    dir       = direction
    mode      = 'flash'
    flashLeft = FLASH_SECONDS
  }

  const applyScrub = (fraction: number) => {
    const m = marksOf()
    if (!m)
      return

    const f = Math.min(1, Math.max(0, fraction))
    if (f < m.progress) {
      dir = -1
      seekTo(timeAtProgress(m.loop, f))
    }
    else if (f > m.progress) {
      dir = 1

      const loop = m.loop
      forwardUntil(now => now.loop !== loop || now.progress >= f)
    }
  }

  return {
    observe (time, marks) {
      if (marks)
        record(time, marks)
    },

    request (action) {
      if (scrubbing)
        return

      const { time } = host.current()
      const m        = marksOf()

      if (!m) {
        const span = action === 'prev' || action === 'next' ? FALLBACK_SECTION_SECONDS : FALLBACK_LOOP_SECONDS
        if (action === 'next' || action === 'next-lap') {
          const until = time + span
          let steps   = 0
          while (host.current().time < until && steps++ < MAX_SEEK_STEPS)
            host.advance(SEARCH_DT)
          flash(1)
        }
        else {
          seekTo(time - span)
          flash(-1)
        }
        return
      }

      switch (action) {
        case 'next': {
          const { loop, section } = m
          forwardUntil(now => now.section !== section || now.loop !== loop)
          flash(1)
          break
        }
        case 'next-lap': {
          const { loop } = m
          forwardUntil(now => now.loop !== loop)
          flash(1)
          break
        }
        case 'prev': {
          if (time <= 1e-6)
            return

          // Media convention: go back to the start of this chapter, unless you
          // have only just entered it, in which case go back one further.
          const here = sectionStart(time)
          seekTo(time - here > GRACE_SECTION ? here : previousSectionStart(time))
          flash(-1)
          break
        }
        case 'prev-lap': {
          if (time <= 1e-6)
            return

          const here = loopStart.get(m.loop) ?? 0
          seekTo(time - here > GRACE_LOOP ? here : loopStart.get(m.loop - 1) ?? 0)
          flash(-1)
          break
        }
      }
    },

    scrub (fraction) {
      scrubbing    = true
      mode         = 'scrub'
      pendingScrub = fraction
    },

    release () {
      if (!scrubbing)
        return
      if (pendingScrub !== null) {
        applyScrub(pendingScrub)
        pendingScrub = null
      }
      scrubbing = false
      mode      = 'play'
    },

    tick (realDt) {
      const dt = Math.min(Math.max(realDt, 0), 0.1)

      if (pendingScrub !== null) {
        applyScrub(pendingScrub)
        pendingScrub = null
      }

      if (mode === 'flash') {
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
