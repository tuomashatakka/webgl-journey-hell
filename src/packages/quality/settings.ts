// Global graphics settings shared by every journey: one source of truth for the
// journeys and the landing grid. Brightness and contrast are applied by the CRT
// pass (packages/gl/crtPass), not a CSS filter, so no shader needs a uniform for
// them. maxFrameRate drives the shared frame loop's cap (see SettingsProvider).

import { CONFIG } from '@wjh/config/config'
import { detectDevice } from './device'


export interface GraphicsSettings {

  /**
   * Internal canvas scale: CONFIG.settings.autoResolution (0) hands it to the adaptive
   * governor (packages/quality/governor); otherwise 0.15 | 0.33 | 0.5 | 0.75 | 1.0, a
   * fixed multiplier of the (dpr-capped) backing store.
   */
  resolution: number;

  /** Time/velocity multiplier: 1.0 | 2.0 | 4.0. */
  speed: number;

  /** Liminal-only: volumetric glows + deep raymarch steps. Ignored by light journeys. */
  heavyEffects: boolean;

  /** Display brightness, 0.5–2.0 (applied by the CRT pass). */
  brightness: number;

  /** Display contrast, 0.5–2.0 (applied by the CRT pass). */
  contrast: number;

  /** Max rendered frames per second; 0 = uncapped. */
  maxFrameRate: number;

  /** Add device-orientation tilt to the shared journey camera controls. */
  gyroscope: boolean;

  /** The shared CRT pass: tube curvature, chromatic offset, aperture mask, VHS scrub. */
  crt: boolean;
}


/** Defaults for this device: no compute-heavy branches on a phone. */
function deviceDefaults (): GraphicsSettings {
  return { ...CONFIG.settings.defaults, heavyEffects: detectDevice().tier > 0 }
}


function coerce (parsed: Partial<GraphicsSettings> | null | undefined, defaults: GraphicsSettings): GraphicsSettings {
  const p    = parsed ?? {}
  const pick = <K extends keyof GraphicsSettings>(key: K): GraphicsSettings[K] =>
    typeof p[key] === typeof defaults[key] ? p[key] as GraphicsSettings[K] : defaults[key]
  return {
    resolution:   pick('resolution'),
    speed:        pick('speed'),
    heavyEffects: pick('heavyEffects'),
    brightness:   pick('brightness'),
    contrast:     pick('contrast'),
    maxFrameRate: pick('maxFrameRate'),
    gyroscope:    pick('gyroscope'),
    crt:          pick('crt'),
  }
}

export function loadSettings (): GraphicsSettings {
  if (typeof window === 'undefined')
    return CONFIG.settings.defaults

  const defaults = deviceDefaults()
  try {
    const saved = localStorage.getItem(CONFIG.settings.storageKey)
    if (saved)
      return coerce(JSON.parse(saved), defaults)

    const old = localStorage.getItem(CONFIG.settings.v1Key) ?? localStorage.getItem(CONFIG.settings.legacyKey)
    if (old) {
      const v1 = coerce(JSON.parse(old), defaults)
      return {
        ...v1,
        resolution:   v1.resolution === 0.5 ? CONFIG.settings.autoResolution : v1.resolution,
        heavyEffects: v1.heavyEffects && defaults.heavyEffects,
      }
    }
  }
  catch (e) {
    console.error('Failed to load settings:', e)
  }
  return defaults
}

export function saveSettings (settings: GraphicsSettings) {
  if (typeof window === 'undefined')
    return
  try {
    localStorage.setItem(CONFIG.settings.storageKey, JSON.stringify(settings))
  }
  catch (e) {
    console.error('Failed to save settings:', e)
  }
}

/** Human label for a resolution value. */
export function resolutionLabel (res: number): string {
  if (res === CONFIG.settings.autoResolution)
    return 'AUTO'
  return res === 1 ? '1.0x (NATIVE)' : `${res}x`
}

/** Human label for a max-frame-rate value. */
export function frameRateLabel (fps: number): string {
  return fps > 0 ? `${fps} FPS` : 'UNLIMITED'
}
