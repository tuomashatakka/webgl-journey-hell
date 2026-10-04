// The contracts every journey implements. Nothing here imports React: the
// shell, the dev harness and the tests all build journeys from these.

import type { CustomUniforms, FrameUniforms } from '@wjh/gl/uniforms'


/**
 * Where a journey is in its own structure. Every simulation already computes
 * this; the shapes just differ too much to infer it from `uniforms()` (compare
 * stairwell's flat scalars against loop-line's packed vec4s).
 */
export interface JourneyMarks {

  /** Integer lap index. 0 always, for journeys with no lap concept. */
  loop: number;

  /** Integer section index within the lap, from zero. The section heading counts from it. */
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

/**
 * A CPU-side simulation driving a journey's renderer. Journeys whose motion is
 * authored as easing curves in GLSL don't need one; journeys that integrate
 * (position as an integral of speed, physics) implement this and return the
 * integrated state as uniforms.
 *
 * `step` receives the settings-scaled delta — the same time base that feeds
 * iTime — so the speed control slows the simulation and the shader together.
 */
export interface JourneySimulation {

  /** Advance by `dt` seconds. `time` is the accumulated journey time. */
  step(dt: number, time: number): void;

  /** State for this frame, uploaded verbatim to the shader. */
  uniforms(): CustomUniforms;

  /** Optional HUD section label derived from simulation state, not time. */
  label?(): string;

  /**
   * Optional live detail (speed, altitude) shown after the label in the
   * transport bar only. Kept out of `label` so the section title does not
   * re-animate every time the number changes.
   */
  detail?(): string;

  /**
   * Optional structural position — which lap, which section, how far through.
   * Implementing it is what makes the transport controls move by *structure*
   * rather than by the clock; see lib/journey/transport.
   */
  marks?(): JourneyMarks;

  /** Optional teardown for anything the simulation allocated. */
  dispose?(): void;
}

/**
 * Anything that can put one frame on the canvas. The shader quad satisfies
 * this structurally; a geometry journey returns its own scene object.
 */
export interface JourneyRenderer {

  /** Render one frame at the canvas's current pixel size. */
  draw(frame: FrameUniforms): void;

  /** Release every GL resource the renderer owns. */
  dispose(): void;

  /**
   * Optional: false while the renderer is still waiting on something it loads
   * asynchronously (Δ's textures). The frozen `?t=` path keeps redrawing but
   * does not raise `data-journey-ready` until this is true, so a driver never
   * captures the placeholder frame.
   */
  ready?(): boolean;

  /**
   * Optional: how much of what `ready()` waits on has arrived, 0..1 — the
   * loading bar shows it. Without it the bar jumps when `ready()` turns true.
   */
  progress?(): number;
}

/** Minimum surface a journey's audio engine exposes. */
export interface JourneyAudioEngine {

  /** Flip mute and return the new muted state. */
  toggleMute(): boolean;

  /** Release the AudioContext and any scheduled timers. */
  destroy(): void;

  /**
   * Optional per-frame modulation. Receives the journey's accumulated
   * (speed-scaled) time and, for journeys that run a simulation, the very
   * uniform map the renderer is about to draw with — so the mix follows the
   * same state the geometry does.
   */
  update?(time: number, state?: CustomUniforms): void;

  /** Optional: stop (and resume) making sound while the journey is paused. */
  setPaused?(paused: boolean): void;
}
