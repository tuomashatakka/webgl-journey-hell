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

import { CONFIG } from '@wjh/config/config'
import type { JourneyMarks } from './types'
import { seekSimulation } from './seek'


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

interface TransportSim {
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

  /** Seek `seconds` from now (negative goes back). Ignored mid-scrub. */
  skip(seconds: number): void;

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
    if (n === 0 || time > track.t[n - 1] && m.progress >= track.p[n - 1] + CONFIG.transport.sampleStep) {
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
    seekSimulation(sim, Math.max(0, t), CONFIG.transport.seekDt)
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
    while (steps++ < CONFIG.transport.maxSeekSteps && spent < CONFIG.transport.forwardBudget) {
      host.advance(CONFIG.transport.searchDt)
      spent += CONFIG.transport.searchDt

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
    flashLeft = CONFIG.transport.flashSeconds
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

  /** A journey with no marks() still moves, by the clock: a stand-in "section" and "lap". */
  const moveByClock = (action: TransportAction, time: number) => {
    const span = action === 'prev' || action === 'next' ? CONFIG.transport.fallbackSectionSeconds : CONFIG.transport.fallbackLoopSeconds
    if (action === 'prev' || action === 'prev-lap') {
      seekTo(time - span)
      flash(-1)
      return
    }

    const until = time + span
    let steps   = 0
    while (host.current().time < until && steps++ < CONFIG.transport.maxSeekSteps)
      host.advance(CONFIG.transport.searchDt)
    flash(1)
  }

  const moveForward = (action: TransportAction, { loop, section }: JourneyMarks) => {
    forwardUntil(action === 'next'
      ? now => now.section !== section || now.loop !== loop
      : now => now.loop !== loop)
    flash(1)
  }

  /**
   * Media convention: back to the start of this chapter (or lap), unless you
   * have only just entered it, in which case one further.
   */
  const backTarget = (action: TransportAction, time: number, loop: number): number => {
    if (action === 'prev') {
      const here = sectionStart(time)
      return time - here > CONFIG.transport.graceSection ? here : previousSectionStart(time)
    }

    const here = loopStart.get(loop) ?? 0
    return time - here > CONFIG.transport.graceLoop ? here : loopStart.get(loop - 1) ?? 0
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
      if (!m)
        moveByClock(action, time)
      else if (action === 'next' || action === 'next-lap')
        moveForward(action, m)
      else if (time > 1e-6) {
        seekTo(backTarget(action, time, m.loop))
        flash(-1)
      }
    },

    skip (seconds) {
      if (scrubbing)
        return

      const { time } = host.current()
      if (seconds < 0) {
        if (time <= 1e-6)
          return
        seekTo(time + seconds)
        flash(-1)
        return
      }

      const until = time + seconds
      let steps   = 0
      while (host.current().time < until && steps++ < CONFIG.transport.maxSeekSteps) {
        host.advance(CONFIG.transport.searchDt)

        const now = marksOf()
        if (now)
          record(host.current().time, now)
        if (now?.terminal)
          break
      }
      flash(1)
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
