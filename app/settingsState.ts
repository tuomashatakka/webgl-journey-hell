export interface GraphicsSettings {
  resolution: number;     // 0.33, 0.5, 0.75, 1.0
  speed: number;          // 1.0, 2.0, 4.0
  heavyEffects: boolean;  // true/false
  brightness: number;    // 0.5 to 2.0
}

const STORAGE_KEY = 'liminal-graphics-settings-v1';

export const DEFAULT_SETTINGS: GraphicsSettings = {
  resolution: 1.0,
  speed: 1.0,
  heavyEffects: true,
  brightness: 1.0,
};

export function loadSettings(): GraphicsSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        resolution: typeof parsed.resolution === 'number' ? parsed.resolution : 1.0,
        speed: typeof parsed.speed === 'number' ? parsed.speed : 1.0,
        heavyEffects: typeof parsed.heavyEffects === 'boolean' ? parsed.heavyEffects : true,
        brightness: typeof parsed.brightness === 'number' ? parsed.brightness : 1.0,
      };
    }
  } catch (e) {
    console.error("Failed to load settings:", e);
  }
  return DEFAULT_SETTINGS;
}

export function saveSettings(settings: GraphicsSettings) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error("Failed to save settings:", e);
  }
}
