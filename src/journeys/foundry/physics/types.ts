// hinge rate injected by a footfall landing on a tile

export interface DebrisBody {

  /** Position: x/z are in the cage's frame, y is world height. */
  px: number
  py: number
  pz: number
  vx: number
  vy: number
  vz: number

  /** Orientation quaternion (x, y, z, w). */
  qx: number
  qy: number
  qz: number
  qw: number

  /** Body-frame angular velocity, rad/s. */
  wx: number
  wy: number
  wz: number

  /** Half-extent scale; the shader derives box dims from the same factor. */
  scale: number
  mass:  number
}

export interface FoundryState {

  /** Which phase of the lap we are in — see MODE_*. */
  mode: number

  /** Seconds spent in the current phase. */
  modeTime: number

  /** Gate open fraction (0 shut, 1 clear) and shutter closed fraction. */
  gate:    number
  shutter: number

  // --- the walker ---------------------------------------------------------

  /**
   * Total distance walked, metres. The clock for the corridor.
   *
   * Not the same number as `z` once the span turns: see routeAt.
   */
  dist: number

  /** Position within the current lap, 0..CYCLE_LEN. */
  z: number

  /** Lateral offset from the hall centreline — nought except on the span. */
  lateral: number

  /** Which way the route is facing, radians about +Z. */
  head: number

  /** Distance at which this lap's walk ends, back at the cage. */
  lapEnd: number

  /** Completed laps, and the version that ramps across the boarding. */
  loop:       number
  smoothLoop: number

  /** Walking speed, m/s. */
  v: number

  /** Footsteps taken; the fractional part is the stride phase. */
  stride: number

  /** Which foot is down: ±1. */
  foot: number

  /** Head height relative to the walking surface, and its rate — a leg spring. */
  bob:  number
  bobV: number

  /** Lateral weight-transfer sway, and its rate. */
  sway:  number
  swayV: number

  /** Floor tremor travelling up from impacts, and its rate. */
  tremor:  number
  tremorV: number

  /** Camera pose, all of it derived from the gait or from the ride. */
  eyeY:   number
  yaw:    number
  pitch:  number
  roll:   number
  shakeX: number
  shakeY: number

  // --- the cage -----------------------------------------------------------

  /**
   * Cage floor height, metres.
   *
   * In MODE_OBLIVION this wraps inside OBLIVION_PERIOD, because that shaft is
   * periodic and the fall is not going to stop.
   */
  y: number

  /** Metres fallen past the pit. Unwrapped, and only ever counts up. */
  fallen: number

  /** Cage vertical velocity, m/s (negative = falling). */
  cageV: number

  /** Cage vertical acceleration, m/s² — drives the shake and the hook. */
  cageA:       number
  cableIntact: boolean

  /** Instantaneous brake friction power, normalised 0..1 — spark intensity. */
  spark: number

  /** Seconds the shoes have been in contact. */
  brakeEngaged: number

  /** Seconds spent settled, gating the phase machine's exits. */
  settleTime: number

  /** True once the brake shoes have stalled the cage and slipped to a creep. */
  creeping: boolean
  debris:   DebrisBody[]

  // --- machinery ----------------------------------------------------------

  /** Flywheel angle and rate driving the wall pistons. */
  crank:      number
  crankOmega: number

  /** Damped pendulum hook hanging from the cage roof. */
  hook:      number
  hookOmega: number

  /** Damped pendulum chain hanging from the hall's hoist beams. */
  chain:      number
  chainOmega: number

  // --- the folding span ---------------------------------------------------

  /** Per-cube fold coordinate (0 = closed cube, 1 = fully unfolded). */
  fold:      number[]
  foldOmega: number[]
}
