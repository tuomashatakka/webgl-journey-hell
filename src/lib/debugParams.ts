// Debug query parameters, honoured by every journey through withShaderJourney.
//
// The problem this solves: a journey is a clock. Everything interesting about it
// — which room you are in, how flooded it is, how far a doorway has assembled —
// is a function of elapsed time, so capturing a particular moment used to mean
// loading the page, sleeping roughly the right number of seconds, and taking a
// screenshot. That is slow, it is flaky, and it cannot express "the frame two
// metres before the join" at all.
//
// With `?t=` the journey instead *seeks*: it steps its simulation from zero to
// the requested time in fixed increments and then holds there, so the same URL
// always produces the same pixels.
//
//   ?t=42.5          seek to 42.5s of journey time and freeze
//   ?dt=0.008        the seek's fixed timestep (default 1/60)
//   ?debug=1         overlay the live state, and publish it on window
//   ?hud=0           hide the chrome, for a clean plate
//   ?w=1600&h=900    exact backing-store size, ignoring dpr and the res setting
//   ?res=1           resolution scale override, 0.1..2
//   ?pointer=0.3,-0.2  hold the pan offset, to look somewhere other than ahead
//
// The fixed timestep is the load-bearing part. A journey that integrates
// (natatorium advances `dist += speed * dt`, and speed depends on where you
// already are) does not land in the same place when it is fed a different
// sequence of deltas, so seeking with real frame times would drift between runs
// and between machines. A fixed dt makes the seek a pure function of t.

export interface DebugParams {

  /** Journey time to hold at, in seconds. null = run live. */
  t: number | null;

  /** Fixed timestep for the seek. Smaller is more faithful and slower. */
  dt: number;

  /** Show the debug overlay and publish window.__journeyDebug. */
  debug: boolean;

  /** Render the usual chrome (back link, title, buttons, FPS). */
  hud: boolean;

  /** Exact backing-store size, bypassing dpr and the resolution setting. */
  w: number | null;
  h: number | null;

  /** Resolution scale override. */
  res: number | null;

  /** Held pan offset, in the same units usePanControl produces. */
  pointer: [ number, number ] | null;
}

export const NO_DEBUG: DebugParams = {
  t:       null,
  dt:      1 / 60,
  debug:   false,
  hud:     true,
  w:       null,
  h:       null,
  res:     null,
  pointer: null,
}

/** Upper bound on seek iterations, so `?t=1e9` cannot hang the tab. */
export const MAX_SEEK_STEPS = 200_000

function num (raw: string | null, min: number, max: number): number | null {
  if (raw === null)
    return null

  const v = Number(raw)
  return Number.isFinite(v) && v >= min && v <= max ? v : null
}

function bool (raw: string | null, fallback: boolean): boolean {
  if (raw === null)
    return fallback
  return raw !== '0' && raw !== 'false'
}

/**
 * Parse the current location's query string. Returns NO_DEBUG during SSR — the
 * site is a static export, so the prerender has no query string and the client
 * picks the real one up on mount.
 */
export function readDebugParams (search?: string): DebugParams {
  const raw = search ?? (typeof window === 'undefined' ? '' : window.location.search)
  if (!raw)
    return NO_DEBUG

  const q = new URLSearchParams(raw)

  let pointer: [ number, number ] | null = null
  const rawPointer = q.get('pointer')
  if (rawPointer) {
    const [ px, py ] = rawPointer.split(',').map(Number)
    if (Number.isFinite(px) && Number.isFinite(py))
      pointer = [ px, py ]
  }

  return {
    t:     num(q.get('t'), 0, 1e6),
    dt:    num(q.get('dt'), 1 / 1000, 1) ?? 1 / 60,
    // ?t= implies you want to see what you seeked to, so it turns the overlay on
    // unless it is explicitly switched back off.
    debug: bool(q.get('debug'), q.has('t')),
    hud:   bool(q.get('hud'), true),
    w:     num(q.get('w'), 16, 8192),
    h:     num(q.get('h'), 16, 8192),
    res:   num(q.get('res'), 0.1, 2),
    pointer,
  }
}

/** Anything the seek can drive. Structurally the JourneySimulation subset it needs. */
interface Steppable {
  step(dt: number, time: number): void;
}

/**
 * Walk a simulation from zero to `t` in fixed increments.
 *
 * Replayed rather than jumped to, because an integrating journey cannot be
 * jumped: natatorium advances `dist += speed * dt` and its speed depends on how
 * deep the water is where it already is, so the only way to know where t seconds
 * puts you is to walk it. The increment is derived by dividing t into a whole
 * number of steps rather than by stepping `dt` until it overshoots — that way
 * the final step is the same size as every other one, and t lands exactly.
 *
 * Returns the number of steps taken, which is capped so `?t=1e9` cannot hang.
 */
export function seekSimulation (sim: Steppable | null, t: number, dt: number): number {
  const steps = Math.min(Math.ceil(t / dt), MAX_SEEK_STEPS)
  if (steps <= 0)
    return 0

  const step = t / steps
  let acc = 0
  for (let i = 0; i < steps; i++) {
    acc += step
    sim?.step(step, acc)
  }
  return steps
}

/** What a frozen journey publishes for whatever is driving the browser. */
export interface JourneyDebugState {
  journey: string;
  time:    number;
  label:   string;
  seeking: boolean;

  /** True once the seeked frame has actually been drawn. */
  ready:    boolean;
  width:    number;
  height:   number;
  fps:      number;
  uniforms: Record<string, number | number[]>;
}

declare global {
  interface Window {
    __journeyDebug?: JourneyDebugState;
  }
}

/**
 * Publish the frame's state on `window`, and mirror readiness onto <html> as a
 * data attribute. The attribute is what makes this usable from a driver: it can
 * be waited on directly rather than polled, and it appears exactly once the
 * seeked frame is on screen.
 */
export function publishDebugState (state: JourneyDebugState): void {
  if (typeof window === 'undefined')
    return

  window.__journeyDebug                         = state
  document.documentElement.dataset.journeyReady = state.ready ? '1' : '0'
}
