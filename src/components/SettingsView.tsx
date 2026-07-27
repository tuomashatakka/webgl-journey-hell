'use client'

// Global graphics & controls panel. Presentational: it receives `settings` and
// an `onChange` and renders against the existing #settings-* / .settings-* CSS
// in app/globals.css. Mounted by SettingsButton (grid + journeys) and by the
// bespoke liminal route.

import React from 'react'
import { X as CloseIcon } from 'lucide-react'
import {
  GraphicsSettings,
  RESOLUTION_CHOICES,
  SPEED_CHOICES,
  FRAME_RATE_CHOICES,
  frameRateLabel,
} from '@/lib/settings'


interface SettingsViewProps {
  isOpen:   boolean;
  onClose:  () => void;
  settings: GraphicsSettings;
  onChange: (newSettings: GraphicsSettings) => void;
}

export default function SettingsView ({ isOpen, onClose, settings, onChange }: SettingsViewProps) {
  if (!isOpen)
    return null

  return <aside
    id="settings-overlay" onPointerDown={ e => {
      // Only swallow clicks on the backdrop itself — never intercept the panel's
      // controls. Range sliders rely on the native pointerdown default to drag,
      // so calling preventDefault() here previously froze brightness + contrast.
      if (e.target === e.currentTarget)
        e.stopPropagation()
    } }>
    <dialog id="settings-dialog" open>
      <header id="settings-header">
        <span id="settings-title">GRAPHICS & CONTROLS</span>

        <button id="settings-close-btn" onClick={ onClose } aria-label="Close settings">
          <CloseIcon size={ 14 } />
        </button>
      </header>

      <section id="settings-body">
        {/* Resolution */}
        <fieldset className="settings-group">
          <legend className="settings-label">RENDER RESOLUTION</legend>

          <p className="settings-description">
            Scales the internal canvas width & height. Lower resolutions can improve framerate significantly.
          </p>

          <p className="settings-choices">
            {RESOLUTION_CHOICES.map(res =>
              <button
                key={ res }
                type="button"
                className={ `settings-choice-btn ${settings.resolution === res ? 'active' : ''}` }
                onClick={ () => onChange({ ...settings, resolution: res }) }>
                {res === 1.0 ? '1.0x (NATIVE)' : `${res}x`}
              </button>
            )}
          </p>
        </fieldset>

        {/* Playback speed */}
        <fieldset className="settings-group">
          <legend className="settings-label">PLAYBACK SPEED</legend>

          <p className="settings-description">
            Modulates the forward velocity and time progression of the journey.
          </p>

          <p className="settings-choices">
            {SPEED_CHOICES.map(spd =>
              <button
                key={ spd }
                type="button"
                className={ `settings-choice-btn ${settings.speed === spd ? 'active' : ''}` }
                onClick={ () => onChange({ ...settings, speed: spd }) }>
                {spd}x
              </button>
            )}
          </p>
        </fieldset>

        {/* Max frame rate */}
        <fieldset className="settings-group">
          <legend className="settings-label">MAX FRAME RATE</legend>

          <p className="settings-description">
            Caps how many frames are rendered per second. Lower caps save GPU & battery; UNLIMITED runs as fast as the display allows.
          </p>

          <p className="settings-choices">
            {FRAME_RATE_CHOICES.map(fps =>
              <button
                key={ fps }
                type="button"
                className={ `settings-choice-btn ${settings.maxFrameRate === fps ? 'active' : ''}` }
                onClick={ () => onChange({ ...settings, maxFrameRate: fps }) }>
                {frameRateLabel(fps)}
              </button>
            )}
          </p>
        </fieldset>

        {/* Compute-heavy effects */}
        <fieldset className="settings-group">
          <legend className="settings-label">ENVIRONMENT EFFECTS</legend>

          <p className="settings-description">
            Toggle volumetric glows, deep step limits, and intensive scene rendering routes.
          </p>

          <p className="settings-toggle-container">
            <label className="settings-switch-label">
              <input
                type="checkbox"
                id="heavy-effects-checkbox"
                checked={ settings.heavyEffects }
                onChange={ () => onChange({ ...settings, heavyEffects: !settings.heavyEffects }) } />

              <span className="settings-custom-checkbox" />

              <span className="settings-switch-text">
                {settings.heavyEffects ? 'COMPUTE HEAVY EFFECTS: ENABLED' : 'COMPUTE HEAVY EFFECTS: MINIFIED'}
              </span>
            </label>
          </p>
        </fieldset>

        {/* Brightness */}
        <fieldset className="settings-group">
          <legend className="settings-label">DISPLAY BRIGHTNESS</legend>

          <p className="settings-description">
            Modulate the luminance and signal output of the monitor.
          </p>

          <p className="settings-slider-row">
            <input
              type="range"
              className="settings-slider"
              min="0.5"
              max="2.0"
              step="0.05"
              value={ settings.brightness }
              onChange={ e => onChange({ ...settings, brightness: parseFloat(e.target.value) }) } />

            <span className="settings-slider-val">{(settings.brightness * 100).toFixed(0)}%</span>
          </p>
        </fieldset>

        {/* Contrast */}
        <fieldset className="settings-group">
          <legend className="settings-label">DISPLAY CONTRAST</legend>

          <p className="settings-description">
            Stretch or compress the tonal range — flatten the signal or punch up the blacks and whites.
          </p>

          <p className="settings-slider-row">
            <input
              type="range"
              className="settings-slider"
              min="0.5"
              max="2.0"
              step="0.05"
              value={ settings.contrast }
              onChange={ e => onChange({ ...settings, contrast: parseFloat(e.target.value) }) } />

            <span className="settings-slider-val">{(settings.contrast * 100).toFixed(0)}%</span>
          </p>
        </fieldset>
      </section>
    </dialog>
  </aside>
}
