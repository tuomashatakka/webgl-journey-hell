// Shared view-pan input for every journey: pointer/touch + gyroscope, tweened.
//
// All journeys steer their camera from one normalized vector in -1..1 (y up),
// uploaded as `uPointer`. Reading `pointermove` straight into that uniform has
// three problems this module fixes:
//
//   • touch has no hover, so a finger landing far from the last touch point
//     TELEPORTS the camera. Big deltas are eased across a distance-scaled
//     duration instead; small moves keep an immediate, snappy follow.
//   • phones have a gyroscope and no comfortable way to drag while holding the
//     device. Device orientation is summed on top of the pointer, so tilting
//     pans the view as well (only when the device actually reports it).
//   • iOS gates orientation behind a permission prompt that must originate from
//     a user gesture — handled here, once, on the first tap.
//
// The controller is framework-free (the shared preview canvas on the landing
// grid uses it directly); see hooks/use-pan-control.ts for the React wrapper.

/** Ordinary-motion follow rate, 1/s. Higher = tighter tracking of the pointer. */
const FOLLOW_RATE = 16

/** Target deltas beyond this (in -1..1 units) are treated as a jump and tweened. */
const JUMP_DISTANCE = 0.3

/** Jump tween duration = distance × this, clamped to the bounds below. */
const JUMP_SECONDS_PER_UNIT = 0.35
const JUMP_MIN_DURATION     = 0.16
const JUMP_MAX_DURATION     = 0.5

/** Tilt (degrees, from the calibration pose) that maps to a full-scale ±1 pan. */
const GYRO_RANGE_DEG = 35

/** Tilt below this is ignored, so a hand-held device doesn't jitter the camera. */
const GYRO_DEADZONE_DEG = 1.5

/** Smoothing applied to raw orientation readings, 1/s. */
const GYRO_FOLLOW_RATE = 6

/** Largest frame delta the tweens integrate, so a stalled tab doesn't snap. */
const MAX_DELTA = 0.1

export interface PanVector {
  x: number;
  y: number;
}

export interface PanControlOptions {

  /**
   * Mirror the horizontal axis. Defaults to **true**: every journey steers
   * *away* from the pointer, so that pushing the pointer right swings the world
   * right and the camera looks left, the way dragging a scene around works.
   * Pass `false` for the look-toward-the-pointer reading.
   */
  invertX?: boolean;

  /** Mirror the vertical axis. */
  invertY?: boolean;

  /** Sum device orientation on top of the pointer when available. Default true. */
  gyroscope?: boolean;

  /**
   * Rect the pointer is normalized against. Defaults to the viewport — the
   * landing grid passes its preview canvas so the pointer stays card-relative.
   */
  getRect?: () => DOMRect | null | undefined;
}

export interface PanControl {

  /** Latest tweened value. Stable object identity — safe to hold in a ref. */
  readonly value: PanVector;

  /** True once the device has produced a usable orientation reading. */
  readonly hasGyroscope: boolean;

  /** Advance the tweens by `dt` seconds and return the (same) value object. */
  update: (dt: number) => PanVector;

  /** Adopt the current device pose as the neutral, centered one. */
  recenter: () => void;

  /** Detach every listener. */
  dispose: () => void;
}

/** iOS 13+ exposes a static permission gate on the event constructor. */
interface OrientationPermissionGate {
  requestPermission?: () => Promise<'granted' | 'denied' | 'default'>;
}

type OrientationPermissionState = 'unknown' | 'granted' | 'denied'

let orientationPermission: OrientationPermissionState = 'unknown'

/** Request orientation access from an explicit UI gesture (required by iOS). */
export async function requestGyroscopePermission (): Promise<boolean> {
  if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window))
    return false

  const gate = window.DeviceOrientationEvent as unknown as OrientationPermissionGate
  if (typeof gate.requestPermission !== 'function')
    return true

  if (orientationPermission !== 'unknown')
    return orientationPermission === 'granted'

  try {
    const result          = await gate.requestPermission()
    orientationPermission = result === 'granted' ? 'granted' : 'denied'
  }
  catch {
    orientationPermission = 'denied'
  }
  return orientationPermission === 'granted'
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

/** Shortest signed distance between two angles, in degrees (-180..180]. */
function angleDelta (a: number, b: number): number {
  let d = a - b
  while (d > 180)
    d -= 360
  while (d < -180)
    d += 360
  return d
}

/** Degrees of tilt → -1..1, with a deadzone around the calibration pose. */
function tiltAxis (deg: number): number {
  const magnitude = Math.max(0, Math.abs(deg) - GYRO_DEADZONE_DEG)
  return clamp(Math.sign(deg) * magnitude / GYRO_RANGE_DEG, -1, 1)
}

export function createPanControl (options: PanControlOptions = {}): PanControl {
  const invertX                      = options.invertX === false ? 1 : -1
  const invertY                      = options.invertY ? -1 : 1
  const useGyro                      = options.gyroscope !== false
  const getRect                      = options.getRect
  const detachers: Array<() => void> = []

  // Absolute pointer target, gyro contribution (raw + smoothed), and output.
  const pointer          = { x: 0, y: 0 }
  const gyroRaw          = { x: 0, y: 0 }
  const gyro             = { x: 0, y: 0 }
  const value: PanVector = { x: 0, y: 0 }

  // Jump tween: eases from `fromX/fromY` toward the *live* target, so a drag
  // that continues after a sudden jump keeps tracking instead of stuttering.
  let tweening      = false
  let tweenElapsed  = 0
  let tweenDuration = 0
  let tweenFromX    = 0
  let tweenFromY    = 0

  let baseline: { beta: number; gamma: number } | null = null
  let hasGyroscope                                     = false
  let disposed                                         = false

  const onPointerMove = (e: PointerEvent) => {
    const rect = getRect?.()
    if (rect) {
      if (rect.width === 0 || rect.height === 0)
        return
      pointer.x = invertX * ((e.clientX - rect.left) / rect.width * 2 - 1)
      pointer.y = invertY * (1 - (e.clientY - rect.top) / rect.height * 2)
      return
    }
    pointer.x = invertX * (e.clientX / window.innerWidth * 2 - 1)
    pointer.y = invertY * (1 - e.clientY / window.innerHeight * 2)
  }

  window.addEventListener('pointermove', onPointerMove)
  detachers.push(() => window.removeEventListener('pointermove', onPointerMove))

  // --- Gyroscope -----------------------------------------------------------

  const onOrientation = (e: DeviceOrientationEvent) => {
    const { beta, gamma } = e
    if (beta === null || gamma === null)
      return // no usable reading (desktop browsers fire empty events)

    hasGyroscope = true
    if (!baseline)
      baseline = { beta, gamma }

    const dBeta  = angleDelta(beta, baseline.beta)
    const dGamma = angleDelta(gamma, baseline.gamma)

    // Orientation is reported in device space; rotate it into screen space so
    // tilting "right" pans right in landscape as well as portrait.
    const angle = typeof screen !== 'undefined' && screen.orientation?.angle || 0
    let ax: number,
      ay: number
    switch (angle) {
      case 90:
        ax = dBeta
        ay = -dGamma
        break
      case 180:
        ax = -dGamma
        ay = -dBeta
        break
      case 270:
        ax = -dBeta
        ay = dGamma
        break
      default:
        ax = dGamma
        ay = dBeta
    }

    // Tilting the top of the device away from you looks down, so `ay` (which
    // grows as the device is pulled upright) drives the view up.
    gyroRaw.x = invertX * tiltAxis(ax)
    gyroRaw.y = invertY * tiltAxis(ay)
  }

  const recenter = () => {
    baseline  = null
    gyroRaw.x = 0
    gyroRaw.y = 0
  }

  if (useGyro && typeof window !== 'undefined' && 'DeviceOrientationEvent' in window) {
    const gate = window.DeviceOrientationEvent as unknown as OrientationPermissionGate

    const listen = () => {
      if (disposed)
        return
      window.addEventListener('deviceorientation', onOrientation)
      detachers.push(() => window.removeEventListener('deviceorientation', onOrientation))
    }

    if (typeof gate.requestPermission === 'function') {
      if (orientationPermission === 'granted')
        listen()
      else if (orientationPermission === 'unknown') {
        // iOS: the prompt only opens from a user gesture, so piggyback the first
        // tap. Kept passive and once-only — a declined prompt is never re-asked.
        const ask = () => {
          detachGesture()
          requestGyroscopePermission().then(granted => {
            if (granted)
              listen()
          })
        }
        const detachGesture = () => window.removeEventListener('pointerdown', ask)
        window.addEventListener('pointerdown', ask, { once: true, passive: true })
        detachers.push(detachGesture)
      }
    }
    else
      listen()

    // A device rotated mid-journey gets a fresh neutral pose, as does one
    // coming back from a backgrounded tab (where readings stop arriving).
    const onOrientationChange = () => recenter()
    const onVisibility        = () => {
      if (document.visibilityState === 'visible')
        recenter()
    }
    screen.orientation?.addEventListener('change', onOrientationChange)
    window.addEventListener('orientationchange', onOrientationChange)
    document.addEventListener('visibilitychange', onVisibility)
    detachers.push(() => {
      screen.orientation?.removeEventListener('change', onOrientationChange)
      window.removeEventListener('orientationchange', onOrientationChange)
      document.removeEventListener('visibilitychange', onVisibility)
    })
  }

  // --- Tweening ------------------------------------------------------------

  const update = (dt: number): PanVector => {
    const step = clamp(dt, 0, MAX_DELTA)

    // Gyro is low-passed before it joins the target, so tilt noise can never
    // look like a jump and trip the tween below.
    const gyroLerp = 1 - Math.exp(-GYRO_FOLLOW_RATE * step)
    gyro.x += (gyroRaw.x - gyro.x) * gyroLerp
    gyro.y += (gyroRaw.y - gyro.y) * gyroLerp

    const targetX = clamp(pointer.x + gyro.x, -1, 1)
    const targetY = clamp(pointer.y + gyro.y, -1, 1)

    const dx       = targetX - value.x
    const dy       = targetY - value.y
    const distance = Math.hypot(dx, dy)

    if (!tweening && distance > JUMP_DISTANCE) {
      tweening      = true
      tweenElapsed  = 0
      tweenDuration = clamp(
        distance * JUMP_SECONDS_PER_UNIT,
        JUMP_MIN_DURATION,
        JUMP_MAX_DURATION,
      )
      tweenFromX = value.x
      tweenFromY = value.y
    }

    if (tweening) {
      tweenElapsed += step

      const t = tweenDuration > 0 ? Math.min(1, tweenElapsed / tweenDuration) : 1
      const e = easeInOutCubic(t)
      value.x = tweenFromX + (targetX - tweenFromX) * e
      value.y = tweenFromY + (targetY - tweenFromY) * e
      if (t >= 1)
        tweening = false
      return value
    }

    const follow = 1 - Math.exp(-FOLLOW_RATE * step)
    value.x += dx * follow
    value.y += dy * follow
    return value
  }

  return {
    value,
    get hasGyroscope () {
      return hasGyroscope
    },
    update,
    recenter,
    dispose () {
      disposed = true
      detachers.forEach(off => off())
      detachers.length = 0
    },
  }
}
