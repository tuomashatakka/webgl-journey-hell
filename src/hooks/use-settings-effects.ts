'use client'

import { useEffect } from 'react'
import { saveSettings } from '@wjh/quality/settings'
import type { GraphicsSettings } from '@wjh/quality/settings'
import { frameLoopManager } from '@wjh/web/frameLoopManager'


/**
 * The side effects of the graphics settings: persisted on every change, and
 * the single place that drives the shared frame loop (it caps the global rAF
 * rate from `maxFrameRate` and resumes the loop, which starts paused).
 */
export function useSettingsEffects (settings: GraphicsSettings): void {
  // Persist on every change.
  useEffect(() => {
    saveSettings(settings)
  }, [ settings ])

  // Drive the shared frame loop's cap from the setting (0 = uncapped).
  useEffect(() => {
    frameLoopManager.setFixedFrameRate(settings.maxFrameRate)
  }, [ settings.maxFrameRate ])

  // The manager starts paused; resume once the app is mounted.
  useEffect(() => {
    frameLoopManager.resume()
  }, [])
}
