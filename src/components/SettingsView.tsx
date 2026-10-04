'use client'

// Global graphics & controls panel: an <aside> dialog fixed to the right edge over
// a full-viewport backdrop. It receives `settings` and an `onChange`; its focus
// contract (focus in, Tab trapped, Esc closes, focus restored) is
// hooks/use-dialog-focus. It renders against the #settings-* / .settings-* CSS
// in app/styles/settings.css. Mounted by SettingsButton (grid + journeys) and by the
// bespoke liminal route.

import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { CONFIG } from '@wjh/config/config'
import { X as CloseIcon } from 'lucide-react'
import { GraphicsSettings, resolutionLabel, frameRateLabel } from '@wjh/quality/settings'
import { requestGyroscopePermission } from '@wjh/web/panControl'
import { useDialogFocus } from '✦/hooks/use-dialog-focus'


interface SettingsViewProps {
  isOpen:   boolean;
  onClose:  () => void;
  settings: GraphicsSettings;
  onChange: (newSettings: GraphicsSettings) => void;
}

export default function SettingsView ({ isOpen, onClose, settings, onChange }: SettingsViewProps) {
  const panelRef = useRef<HTMLElement>(null)
  useDialogFocus(isOpen, panelRef, onClose)

  if (!isOpen)
    return null

  const changeGyroscope = async (enabled: boolean) => {
    if (!enabled) {
      onChange({ ...settings, gyroscope: false })
      return
    }

    const permitted = await requestGyroscopePermission()
    onChange({ ...settings, gyroscope: permitted })
  }

  // Portalled to the body: the toolbar that opens it is a stacking context of its
  // own, and the panel has to sit above everything on the page, not just in it.
  return createPortal(
    <>
      {/* The backdrop: a fixed full-viewport layer, so a click anywhere outside the panel closes it. */}
      <div className="settings-backdrop" id="settings-backdrop" aria-hidden="true" onClick={ onClose } />

      <aside
        ref={ panelRef }
        className="settings-panel"
        id="settings-panel"
        aria-modal="true"
        aria-labelledby="settings-title"
        role="dialog"
        tabIndex={ -1 }>
        <header className="settings-header" id="settings-header">
          <h2 className="settings-title" id="settings-title">GRAPHICS & CONTROLS</h2>

          <button className="settings-close-btn" id="settings-close-btn" aria-label="Close settings" type="button" onClick={ onClose }>
            <CloseIcon aria-hidden size={ 16 } />
          </button>
        </header>

        <section className="settings-body" id="settings-body">
          {/* Resolution */}
          <fieldset className="settings-group">
            <legend className="settings-label">RENDER RESOLUTION</legend>

            <p className="settings-description">
              Scales the internal canvas width & height. AUTO adapts it to hold the frame rate on this device; lower fixed values can improve framerate significantly.
            </p>

            <p className="settings-choices">
              {CONFIG.settings.resolutionChoices.map(res =>
                <button
                  key={ res }
                  className={ `settings-choice-btn ${settings.resolution === res ? 'active' : ''}` }
                  type="button"
                  onClick={ () => onChange({ ...settings, resolution: res }) }>
                  {resolutionLabel(res)}
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
              {CONFIG.settings.speedChoices.map(spd =>
                <button
                  key={ spd }
                  className={ `settings-choice-btn ${settings.speed === spd ? 'active' : ''}` }
                  type="button"
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
              {CONFIG.settings.frameRateChoices.map(fps =>
                <button
                  key={ fps }
                  className={ `settings-choice-btn ${settings.maxFrameRate === fps ? 'active' : ''}` }
                  type="button"
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
                  id="heavy-effects-checkbox"
                  type="checkbox"
                  checked={ settings.heavyEffects }
                  onChange={ () => onChange({ ...settings, heavyEffects: !settings.heavyEffects }) } />

                <span className="settings-custom-checkbox" />

                <span className="settings-switch-text">
                  {settings.heavyEffects ? 'COMPUTE HEAVY EFFECTS: ENABLED' : 'COMPUTE HEAVY EFFECTS: MINIFIED'}
                </span>
              </label>
            </p>
          </fieldset>

          {/* Shared CRT post pass */}
          <fieldset className="settings-group">
            <legend className="settings-label">CRT DISPLAY</legend>

            <p className="settings-description">
              Tube curvature, chromatic offset and aperture mask over every journey — and the
              tape treatment the transport controls play during a fast-forward or rewind.
            </p>

            <p className="settings-toggle-container">
              <label className="settings-switch-label">
                <input
                  id="crt-checkbox"
                  type="checkbox"
                  checked={ settings.crt }
                  onChange={ () => onChange({ ...settings, crt: !settings.crt }) } />

                <span className="settings-custom-checkbox" />

                <span className="settings-switch-text">
                  {settings.crt ? 'CRT DISPLAY: ENABLED' : 'CRT DISPLAY: BYPASSED'}
                </span>
              </label>
            </p>
          </fieldset>

          {/* Device-orientation look controls */}
          <fieldset className="settings-group">
            <legend className="settings-label">GYROSCOPE LOOK</legend>

            <p className="settings-description" id="gyroscope-description">
              Add phone tilt to the journey camera. Your browser may ask for motion sensor permission when enabled.
            </p>

            <p className="settings-toggle-container">
              <label className="settings-switch-label">
                <input
                  id="gyroscope-checkbox"
                  aria-describedby="gyroscope-description"
                  type="checkbox"
                  checked={ settings.gyroscope }
                  onChange={ e => void changeGyroscope(e.target.checked) } />

                <span className="settings-custom-checkbox" aria-hidden="true" />

                <span className="settings-switch-text">
                  {settings.gyroscope ? 'GYROSCOPE LOOK: ENABLED' : 'GYROSCOPE LOOK: DISABLED'}
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
                className="settings-slider"
                type="range"
                min="0.5"
                max="2.0"
                step="0.05"
                value={ settings.brightness }
                onChange={ e => onChange({ ...settings, brightness: Number.parseFloat(e.target.value) }) } />

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
                className="settings-slider"
                type="range"
                min="0.5"
                max="2.0"
                step="0.05"
                value={ settings.contrast }
                onChange={ e => onChange({ ...settings, contrast: Number.parseFloat(e.target.value) }) } />

              <span className="settings-slider-val">{(settings.contrast * 100).toFixed(0)}%</span>
            </p>
          </fieldset>
        </section>
      </aside>
    </>, document.body)
}
