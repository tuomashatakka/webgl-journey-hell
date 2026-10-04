'use client'

// App-wide graphics-settings context. Mounted once in app/layout.tsx so every
// route (the index + each journey) reads one source of truth, persisted
// to localStorage. This is also the single place that drives the shared frame
// loop (see hooks/use-settings-effects).

import {
  createContext,
  useContext,
  useCallback,
  useMemo,
  useState

} from 'react'
import type { ReactNode } from 'react'
import {
  loadSettings,
  saveSettings
} from '@wjh/quality/settings'
import type { GraphicsSettings } from '@wjh/quality/settings'
import { useSettingsEffects } from '✦/hooks/use-settings-effects'


const SettingsCtx = createContext<SettingsAPI | null>(null)

interface SettingsAPI {
  settings: GraphicsSettings;

  /** Replace the whole settings object (used by the settings panel's onChange). */
  setSettings: (next: GraphicsSettings) => void;

  /** Merge a partial patch into the current settings. */
  update: (patch: Partial<GraphicsSettings>) => void;
}

type SettingsProviderProps = { children: ReactNode }

/** Read + mutate the global graphics settings. Must be used under <SettingsProvider>. */
export function useSettings (): SettingsAPI {
  const ctx = useContext(SettingsCtx)
  if (!ctx)
    throw new Error('useSettings must be used within a <SettingsProvider>')
  return ctx
}

export function SettingsProvider ({ children }: SettingsProviderProps) {
  // loadSettings() is window-guarded → DEFAULT on the server, saved value on the client.
  const [ settings, setSettings ] = useState<GraphicsSettings>(() => loadSettings())

  useSettingsEffects(settings)

  // Functional update sees the latest state without a render-time ref, and
  // keeps its identity so key bindings are not rebound on every change.
  const update = useCallback((patch: Partial<GraphicsSettings>) => setSettings(prev => ({ ...prev, ...patch })), [])

  const api = useMemo<SettingsAPI>(() => ({ settings, setSettings, update }), [ settings, update ])

  return <SettingsCtx.Provider value={ api }>{children}</SettingsCtx.Provider>
}
