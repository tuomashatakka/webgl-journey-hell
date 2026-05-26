'use client';

import React from 'react';
import { X as CloseIcon } from 'lucide-react';
import { GraphicsSettings } from './settingsState';

interface SettingsViewProps {
  isOpen: boolean;
  onClose: () => void;
  settings: GraphicsSettings;
  onChange: (newSettings: GraphicsSettings) => void;
}

export default function SettingsView({ isOpen, onClose, settings, onChange }: SettingsViewProps) {
  if (!isOpen) return null;

  const handleResolutionChange = (res: number) => {
    onChange({ ...settings, resolution: res });
  };

  const handleSpeedChange = (spd: number) => {
    onChange({ ...settings, speed: spd });
  };

  const handleHeavyToggle = () => {
    onChange({ ...settings, heavyEffects: !settings.heavyEffects });
  };

  return (
    <aside id="settings-overlay">
      <dialog id="settings-dialog" open>
        <header id="settings-header">
          <span id="settings-title">GRAPHICS & CONTROLS</span>
          <button id="settings-close-btn" onClick={onClose} aria-label="Close settings">
            <CloseIcon size={14} />
          </button>
        </header>

        <section id="settings-body">
          {/* Resolution Panel */}
          <fieldset className="settings-group">
            <legend className="settings-label">RENDER RESOLUTION</legend>
            <p className="settings-description">
              Scales the internal canvas width & height. Lower resolutions can improve framerate significantly.
            </p>
            <p className="settings-choices">
              {([0.33, 0.5, 0.75, 1.0] as const).map((res) => (
                <button
                  key={res}
                  type="button"
                  className={`settings-choice-btn ${settings.resolution === res ? 'active' : ''}`}
                  onClick={() => handleResolutionChange(res)}
                >
                  {res === 1.0 ? '1.0x (NATIVE)' : `${res}x`}
                </button>
              ))}
            </p>
          </fieldset>

          {/* Speed Panel */}
          <fieldset className="settings-group">
            <legend className="settings-label">PLAYBACK SPEED</legend>
            <p className="settings-description">
              Modulates the forward velocity and time progression of the journey.
            </p>
            <p className="settings-choices">
              {([1.0, 2.0, 4.0] as const).map((spd) => (
                <button
                  key={spd}
                  type="button"
                  className={`settings-choice-btn ${settings.speed === spd ? 'active' : ''}`}
                  onClick={() => handleSpeedChange(spd)}
                >
                  {spd}x
                </button>
              ))}
            </p>
          </fieldset>

          {/* Compute Heavy Effects Toggle */}
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
                  checked={settings.heavyEffects}
                  onChange={handleHeavyToggle}
                />
                <span className="settings-custom-checkbox" />
                <span className="settings-switch-text">
                  {settings.heavyEffects ? 'COMPUTE HEAVY EFFECTS: ENABLED' : 'COMPUTE HEAVY EFFECTS: MINIFIED'}
                </span>
              </label>
            </p>
          </fieldset>

          {/* Brightness Control Slider */}
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
                value={settings.brightness}
                onChange={(e) => onChange({ ...settings, brightness: parseFloat(e.target.value) })}
              />
              <span className="settings-slider-val">{(settings.brightness * 100).toFixed(0)}%</span>
            </p>
          </fieldset>
        </section>
      </dialog>
    </aside>
  );
}
