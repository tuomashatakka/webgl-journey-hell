// How much a frame may cost on this device, and the knobs that follow from it.

import type { QualityHints } from '../gl'
import type { DeviceProfile } from './device'
import { detectDevice } from './device'


export * from './device'
export * from './governor'

/** What a renderer may spend at each tier. See QualityHints. */
export function qualityForTier (tier: 0 | 1 | 2): QualityHints {
  if (tier === 0)
    return { tier, msaa: 0, bloomLevels: 3 }
  if (tier === 1)
    return { tier, msaa: 2, bloomLevels: 4 }
  return { tier, msaa: 4, bloomLevels: 5 }
}

export interface ScaleRange {
  min:   number;
  max:   number;
  start: number;
}

/**
 * Render-scale bounds for the adaptive governor, in multiples of CSS pixels.
 *
 * A desktop starts at one backing pixel per CSS pixel (what the old 0.5×-of-
 * retina default gave) and may climb to 1.5×. A phone starts well under its
 * CSS resolution — a 390-wide screen at 0.6× is still 234 columns of a picture
 * that is soft by design — and is never asked for more than its CSS pixels.
 */
export function scaleRange (device: DeviceProfile = detectDevice()): ScaleRange {
  const dprCap = Math.min(device.dpr, 2)
  if (device.mobile)
    return device.tier === 0
      ? { min: 0.3, max: Math.min(1, dprCap * 0.6), start: 0.55 }
      : { min: 0.35, max: Math.min(1, dprCap * 0.7), start: 0.7 }
  return device.tier === 1
    ? { min: 0.4, max: dprCap * 0.6, start: 0.85 }
    : { min: 0.5, max: dprCap * 0.75, start: 1.0 }
}
