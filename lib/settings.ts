// Global graphics settings shared by every journey.
//
// These were originally the liminal-only settings (resolution / speed /
// heavyEffects / brightness); they now live in the library so all journeys —
// and the landing grid — read one source of truth. Added here: `contrast` and
// `maxFrameRate`. Brightness + contrast are applied universally via a CSS
// filter on the canvas (see displayFilter), so they need no per-shader uniform.
// maxFrameRate drives the shared frame loop's cap (see SettingsProvider).

export interface GraphicsSettings {
  /** Internal canvas scale: 0.15 | 0.33 | 0.5 | 0.75 | 1.0 (backing-store multiplier). */
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
}

const STORAGE_KEY = 'journey-graphics-settings-v1';
// Older liminal-scoped key — read once for back-compat so existing users keep their config.
const LEGACY_KEY = 'liminal-graphics-settings-v1';

export const DEFAULT_SETTINGS: GraphicsSettings = {
  resolution: 0.5, // default to 50% — lighter on the GPU, fits the clinical/quiet vibe
  speed: 1.0,
  heavyEffects: true,
  brightness: 1.0,
  contrast: 1.0,
  maxFrameRate: 60,
};

/** Allowed discrete choices surfaced in the settings UI. */
export const RESOLUTION_CHOICES = [0.15, 0.33, 0.5, 0.75, 1.0] as const;
export const SPEED_CHOICES = [1.0, 2.0, 4.0] as const;
export const FRAME_RATE_CHOICES = [30, 60, 120, 0] as const; // 0 = Unlimited

function coerce(parsed: Partial<GraphicsSettings> | null | undefined): GraphicsSettings {
  const p = parsed ?? {};
  return {
    resolution: typeof p.resolution === 'number' ? p.resolution : DEFAULT_SETTINGS.resolution,
    speed: typeof p.speed === 'number' ? p.speed : DEFAULT_SETTINGS.speed,
    heavyEffects: typeof p.heavyEffects === 'boolean' ? p.heavyEffects : DEFAULT_SETTINGS.heavyEffects,
    brightness: typeof p.brightness === 'number' ? p.brightness : DEFAULT_SETTINGS.brightness,
    contrast: typeof p.contrast === 'number' ? p.contrast : DEFAULT_SETTINGS.contrast,
    maxFrameRate: typeof p.maxFrameRate === 'number' ? p.maxFrameRate : DEFAULT_SETTINGS.maxFrameRate,
  };
}

export function loadSettings(): GraphicsSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const saved = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_KEY);
    if (saved) return coerce(JSON.parse(saved));
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
  return DEFAULT_SETTINGS;
}

export function saveSettings(settings: GraphicsSettings) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}

/** CSS filter string applying brightness + contrast — works on any canvas, no shader uniforms needed. */
export function displayFilter(settings: Pick<GraphicsSettings, 'brightness' | 'contrast'>): string {
  return `brightness(${settings.brightness}) contrast(${settings.contrast})`;
}

/** Human label for a max-frame-rate value. */
export function frameRateLabel(fps: number): string {
  return fps > 0 ? `${fps} FPS` : 'UNLIMITED';
}