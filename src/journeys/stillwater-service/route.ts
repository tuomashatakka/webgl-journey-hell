import { clamp, mix, smootherstep } from '@wjh/math/scalar'
import type { momentAt } from './timeline'


const DEG         = Math.PI / 180
const TAU         = 2 * Math.PI
const EYE_HEIGHT  = 1.64
const EDGE_MARGIN = 0.14
const CAROUSEL_Z  = 8
const TILE_ORBIT  = 4.65

export const DECK_HEIGHT = 78
export const DECK_LENGTH = 43

const ANNEX_PATH = [
  [ 0, 0, 0 ], [ 5, 0, 6 ], [ 8, 2.8, 9 ], [ 12, 8.6, 9.2 ],
  [ 15, 9.8, 12.5 ], [ 19, 9.8, 19 ], [ 21, 9.8, 22 ],
] as const

type Vec3 = [number, number, number]
type Shot = ReturnType<typeof momentAt>
interface Pose {
  eye:  Vec3;
  look: Vec3;
  up:   Vec3;
}

function beat (start: number, middle: number, end: number, time: number): number {
  return smootherstep(start, middle, time) * (1 - smootherstep(middle, end, time))
}

function sampleHall (axis: 1 | 2, time: number): number {
  const last = ANNEX_PATH.length - 1
  const next = ANNEX_PATH.findIndex(point => point[0] > time)
  if (next === -1)
    return ANNEX_PATH[last][axis]

  const from = Math.max(0, next - 1)
  const a    = ANNEX_PATH[from]
  const b    = ANNEX_PATH[next]
  const p    = ANNEX_PATH[Math.max(0, from - 1)]
  const q    = ANNEX_PATH[Math.min(last, next + 1)]
  const t    = (time - a[0]) / (b[0] - a[0])
  const t2   = t * t
  const t3   = t2 * t
  return (2 * t3 - 3 * t2 + 1) * a[axis] + (t3 - 2 * t2 + t) * (b[axis] - p[axis]) * 0.5 +
    (-2 * t3 + 3 * t2) * b[axis] + (t3 - t2) * (q[axis] - a[axis]) * 0.5
}

/** Both the built walkway and the camera use this cross-section. */
export function deckCenter (z: number): number {
  return 2.3 * Math.sin(z * 0.138) + 0.9 * Math.sin(z * 0.29)
}

export function deckHalfWidth (z: number): number {
  return 0.925 - 0.465 * Math.max(beat(7, 15.1, 24, z), beat(22, 28.3, 37, z))
}

function carouselTileAngle (local: number): number {
  return -0.26 + local * 0.135
}

export function setTilePosition (position: Vec3, local: number): void {
  const angle = carouselTileAngle(local)
  position[0] = TILE_ORBIT * Math.sin(angle)
  position[1] = 0.89
  position[2] = CAROUSEL_Z + TILE_ORBIT * Math.cos(angle)
}

function orient (
  pose: Pose, x: number, y: number, z: number,
  yaw: number, pitch: number, roll: number,
): void {
  const sy = Math.sin(yaw)
  const cy = Math.cos(yaw)
  const sp = Math.sin(pitch)
  const cp = Math.cos(pitch)
  const sr = Math.sin(roll)
  const cr = Math.cos(roll)

  pose.eye[0]  = x
  pose.eye[1]  = y
  pose.eye[2]  = z
  pose.look[0] = x + sy * cp
  pose.look[1] = y + sp
  pose.look[2] = z + cy * cp
  pose.up[0]   = -sy * sp * cr + cy * sr
  pose.up[1]   = cp * cr
  pose.up[2]   = -cy * sp * cr - sy * sr
}

export function setPose (pose: Pose, cue: Shot, panX: number, panY: number): void {
  const { local: t, phase, lap } = cue
  const yaw                      = panX * 0.64
  const pitch                    = panY * 0.47
  const step                     = Math.sin(t * TAU * 1.72)

  switch (cue.id) {
    case 'pool': {
      const glance = beat(2, 10, 20, t)
      orient(pose, 2.05 + 0.22 * Math.sin(t * 0.25), EYE_HEIGHT + step * 0.024, 0.65 + t * 1.24,
             yaw - 0.55 * glance, pitch - 0.11 - 0.18 * glance, step * 0.004)
      break
    }
    case 'annex': {
      const x      = sampleHall(1, t)
      const z      = sampleHall(2, t)
      const ahead  = Math.min(20.99, t + 0.72)
      const behind = Math.max(0, t - 0.2)
      const turn   = Math.atan2(sampleHall(1, ahead) - sampleHall(1, behind), sampleHall(2, ahead) - sampleHall(2, behind))
      orient(pose, x, EYE_HEIGHT + step * 0.019, z, yaw + turn, pitch - 0.09, step * 0.004)
      break
    }
    case 'lift': {
      const drop      = smootherstep(0.35, 16.6, t)
      const slip      = Math.min(lap, 1) * (4.75 + 0.45 * lap) * beat(7.7, 8.55, 10.35, t)
      const overshoot = (0.6 + 0.85 * lap) * beat(14, 16.2, 18, t)
      orient(pose, 0.1, -4.85 - drop * 41 - overshoot + slip, 0,
             yaw + 0.17, pitch - 0.035, Math.sin(t * 17) * 0.003)
      break
    }
    case 'breakwater': {
      const first   = beat(8, 12.4, 16, t)
      const second  = beat(20, 23.3, 27, t)
      const horizon = beat(25.1, 28.5, 32.2, t)
      const z       = 0.8 + 1.18 * t - Math.sin(t * 0.5) * 0.35
      const edge    = deckHalfWidth(z) - EDGE_MARGIN
      const teeter  = (second - first) * (0.76 + 0.12 * lap)
      const bearing = clamp((deckCenter(z + 2) - deckCenter(z)) * 0.27, -0.14, 0.14)
      orient(pose, deckCenter(z) + edge * teeter, DECK_HEIGHT + EYE_HEIGHT + step * (0.023 - 0.012 * Math.abs(teeter)), z,
             yaw + mix(bearing, -0.29, horizon) - first * 0.55 + second * 0.32,
             pitch - 0.1 - first * 0.59 - second * 0.45 + horizon * 0.15, teeter * 6.5 * DEG)
      break
    }
    case 'lounge': {
      const rise = smootherstep(0.52, 0.98, phase)
      orient(pose, 0.6 * Math.sin(t * 0.18), 1.4 + 3.18 * rise + Math.sin(t * 0.7) * 0.08, 1 + t * 1.05,
             yaw - 0.39 * beat(1, 8, 17, t), pitch - 0.13 + 0.56 * rise, Math.sin(t * 0.53) * 0.016)
      break
    }
    case 'carousel': {
      const angle      = -1.3 + t * 0.145
      const x          = 4.5 * Math.sin(angle)
      const z          = CAROUSEL_Z + 4.5 * Math.cos(angle)
      const door       = smootherstep(18, 23.2, t)
      const tangentYaw = angle + 2.05
      const doorYaw    = Math.atan2(0.8 - x, 1.1 - z) + TAU
      orient(pose, x, 2.32, z, yaw + mix(tangentYaw, doorYaw, door),
             pitch - mix(0.36, 0.08, door), Math.sin(angle) * 0.006)
      break
    }
  }
}
