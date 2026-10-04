// How much a frame may cost on this device, and the knobs that follow from it.
// The numbers are config (CONFIG.quality); this is the lookup.

import { CONFIG } from '@wjh/config/config'
import type { QualityHints } from '@wjh/gl/uniforms'
import type { DeviceProfile } from './device'
import { detectDevice } from './device'


export interface ScaleRange {
  min:   number;
  max:   number;
  start: number;
}

interface ScaleSpec {
  min:      number;
  maxOfDpr: number;
  maxCap:   number;
  start:    number;
}

/** What a renderer may spend at each tier. See QualityHints. */
export function qualityForTier (tier: 0 | 1 | 2): QualityHints {
  return { tier, ...CONFIG.quality.tiers[tier] }
}

const resolveRange = (spec: ScaleSpec, dprCap: number): ScaleRange =>
  ({ min: spec.min, max: Math.min(spec.maxCap, dprCap * spec.maxOfDpr), start: spec.start })

/** Render-scale bounds for the adaptive governor, in multiples of CSS pixels. */
export function scaleRange (device: DeviceProfile = detectDevice()): ScaleRange {
  const { scale, maxDpr } = CONFIG.quality
  const dprCap            = Math.min(device.dpr, maxDpr)
  if (device.mobile)
    return resolveRange(device.tier === 0 ? scale.phoneLow : scale.phone, dprCap)
  return resolveRange(device.tier === 1 ? scale.desktopMid : scale.desktop, dprCap)
}
