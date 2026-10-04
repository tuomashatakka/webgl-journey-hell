// Global graphics settings shared by every journey.
//
// These were originally the liminal-only settings (resolution / speed /
// heavyEffects / brightness); they now live in the library so all journeys —
// and the landing grid — read one source of truth. Added here: `contrast`,
// `maxFrameRate`, and `gyroscope`. Brightness + contrast are applied universally
// via a CSS filter on the canvas (see displayFilter), so they need no per-shader
// uniform. maxFrameRate drives the shared frame loop's cap (see SettingsProvider).

import { detectDevice } from './device'


export interface GraphicsSettings {

  /**
   * Internal canvas scale: AUTO_RESOLUTION (0) hands it to the adaptive
   * governor (lib/quality); otherwise 0.15 | 0.33 | 0.5 | 0.75 | 1.0, a
   * fixed multiplier of the (dpr-capped) backing store.
   */
  resolution: number;

  /** Time/velocity multiplier: 1.0 | 2.0 | 4.0. */
  speed: number;

  /** Liminal-only: volumetric glows + deep raymarch steps. Ignored by light journeys. */
  heavyEffects: boolean;

  /** Display brightness, 0.5–2.0 (applied as a CSS filter). */
  brightness: number;

  /** Display contrast, 0.5–2.0 (applied as a CSS filter). */
  contrast: number;

  /** Max rendered frames per second; 0 = uncapped. */
  maxFrameRate: number;

  /** Add device-orientation tilt to the shared journey camera controls. */
  gyroscope: boolean;

  /** The shared CRT pass: tube curvature, chromatic offset, aperture mask, VHS scrub. */
  crt: boolean;
}

/** The resolution value that hands the render scale to the adaptive governor. */
export const AUTO_RESOLUTION = 0

const STORAGE_KEY = 'journey-graphics-settings-v2'

// Earlier keys, read once so existing users keep their config. v1 saved its
// defaults on first visit, so a v1 resolution of 0.5 and heavy effects on are
// what nobody chose: those migrate to the new defaults (AUTO, and heavy
// effects only where the device can afford them).
const V1_KEY     = 'journey-graphics-settings-v1'
const LEGACY_KEY = 'liminal-graphics-settings-v1'

/** Static defaults: what the prerender and a desktop get. */
export const DEFAULT_SETTINGS: GraphicsSettings = {
  resolution:   AUTO_RESOLUTION,
  speed:        1,
  heavyEffects: true,
  brightness:   1,
  contrast:     1,
  maxFrameRate: 60,
  gyroscope:    true,
  crt:          true,
}

/** Defaults for this device: no compute-heavy branches on a phone. */
export function deviceDefaults (): GraphicsSettings {
  return { ...DEFAULT_SETTINGS, heavyEffects: detectDevice().tier > 0 }
}

/** Allowed discrete choices surfaced in the settings UI. */
export const RESOLUTION_CHOICES = [ AUTO_RESOLUTION, 0.15, 0.33, 0.5, 0.75, 1 ] as const
export const SPEED_CHOICES = [ 1, 2, 4 ] as const
export const FRAME_RATE_CHOICES = [ 30, 60, 120, 0 ] as const // 0 = Unlimited

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
    return DEFAULT_SETTINGS

  const defaults = deviceDefaults()
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved)
      return coerce(JSON.parse(saved), defaults)

    const old = localStorage.getItem(V1_KEY) ?? localStorage.getItem(LEGACY_KEY)
    if (old) {
      const v1 = coerce(JSON.parse(old), defaults)
      return {
        ...v1,
        resolution:   v1.resolution === 0.5 ? AUTO_RESOLUTION : v1.resolution,
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  }
  catch (e) {
    console.error('Failed to save settings:', e)
  }
}

/** Human label for a resolution value. */
export function resolutionLabel (res: number): string {
  if (res === AUTO_RESOLUTION)
    return 'AUTO'
  return res === 1 ? '1.0x (NATIVE)' : `${res}x`
}

/** Human label for a max-frame-rate value. */
export function frameRateLabel (fps: number): string {
  return fps > 0 ? `${fps} FPS` : 'UNLIMITED'
}
