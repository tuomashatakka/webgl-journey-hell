'use client';

// App-wide graphics-settings context. Mounted once in app/layout.tsx so every
// route (the landing grid + each journey) reads one source of truth, persisted
// to localStorage. This is also the single place that drives the shared frame
// loop: it caps the global rAF rate from `maxFrameRate` and resumes the loop
// (the vendored frameLoopManager starts paused).

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  loadSettings,
  saveSettings,
  DEFAULT_SETTINGS,
  type GraphicsSettings,
} from '@/lib/settings';
import { frameLoopManager } from '@/lib/frameLoopManager';

interface SettingsAPI {
  settings: GraphicsSettings;
  /** Replace the whole settings object (used by the settings panel's onChange). */
  setSettings: (next: GraphicsSettings) => void;
  /** Merge a partial patch into the current settings. */
  update: (patch: Partial<GraphicsSettings>) => void;
}

const SettingsCtx = createContext<SettingsAPI | null>(null);

/** Read + mutate the global graphics settings. Must be used under <SettingsProvider>. */
export function useSettings(): SettingsAPI {
  const ctx = useContext(SettingsCtx);
  if (!ctx) throw new Error('useSettings must be used within a <SettingsProvider>');
  return ctx;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  // loadSettings() is window-guarded → DEFAULT on the server, saved value on the client.
  const [settings, setSettings] = useState<GraphicsSettings>(() => loadSettings());

  // Persist on every change.
  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  // Drive the shared frame loop's cap from the setting (0 = uncapped).
  useEffect(() => {
    frameLoopManager.setFixedFrameRate(settings.maxFrameRate);
  }, [settings.maxFrameRate]);

  // The manager starts paused; resume once the app is mounted.
  useEffect(() => {
    frameLoopManager.resume();
  }, []);

  const api = useMemo<SettingsAPI>(
    () => ({
      settings,
      setSettings,
      // Functional update sees the latest state without a render-time ref.
      update: (patch) => setSettings((prev) => ({ ...prev, ...patch })),
    }),
    [settings],
  );

  return <SettingsCtx.Provider value={api}>{children}</SettingsCtx.Provider>;
}