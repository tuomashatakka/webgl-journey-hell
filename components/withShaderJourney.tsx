'use client';

// withShaderJourney(fragmentShader) — the pluggable journey template.
//
// A higher-order component that turns a single-pass fragment shader into a full
// journey route. It owns all the WebGL boilerplate that used to be copy-pasted
// into every journey page (context, full-screen quad, resize, pointer, cleanup)
// and wires in the global graphics settings:
//   • resolution  → canvas backing-store scale
//   • speed       → iTime accumulation rate
//   • brightness  → CSS filter on the canvas
//   • contrast    → CSS filter on the canvas
//   • maxFrameRate→ honored globally by the shared frameLoopManager
//
// Rendering runs on the shared, frame-capped loop (lib/frameLoopManager, vendored
// from @tuomashatakka/canvas-loop-framecapper) via useFrameLoop, so every
// templated journey shares one rAF and one FPS cap.
//
// Usage (a journey page is now three lines):
//   'use client';
//   import { withShaderJourney } from '@/components/withShaderJourney';
//   import { skybridgesFrag } from './shader';
//   export default withShaderJourney(skybridgesFrag);

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { createShaderQuad, type ShaderQuad } from '@/lib/shaderQuad';
import { displayFilter } from '@/lib/settings';
import { useFrameLoop } from '@/lib/frameLoopManager';
import { useSettings } from './SettingsProvider';
import SettingsButton from './SettingsButton';

const MAX_DPR = 2;

interface ShaderJourneyOptions {
  /** Optional accent color, exposed as the `--accent` CSS var on the container. */
  accent?: string;
  /** Optional timeline label, evaluated from the same accumulated shader time as iTime. */
  getSectionName?: (time: number) => string;
  /** Optional class for journey-specific section-title typography. */
  sectionTitleClassName?: string;
}

export function withShaderJourney(fragmentShader: string, options: ShaderJourneyOptions = {}) {
  function ShaderJourney() {
    const { settings } = useSettings();

    // Bottom-right HUD: render resolution (backing-store px) + measured FPS.
    const [fps, setFps] = useState(0);
    const [res, setRes] = useState({ w: 0, h: 0 });
    const [sectionName, setSectionName] = useState(
      () => options.getSectionName?.(0) ?? '',
    );
    const [sectionGlitchKey, setSectionGlitchKey] = useState(0);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const quadRef = useRef<ShaderQuad | null>(null);
    const pointerRef = useRef({ x: 0, y: 0 });
    const iTimeRef = useRef(0);
    const sectionNameRef = useRef(sectionName);
    const fpsFrameCountRef = useRef(0);
    const fpsLastTimeRef = useRef(0);

    // Latest settings for the (stable) frame callback + resize, without re-registering.
    const settingsRef = useRef(settings);
    useEffect(() => {
      settingsRef.current = settings;
    }, [settings]);

    // Resize is stored here so the resolution effect can re-trigger it.
    const resizeRef = useRef<() => void>(() => {});

    // --- GL setup / teardown (once) ---
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const gl = canvas.getContext('webgl', { antialias: false, depth: false, alpha: false });
      if (!gl) {
        console.error('WebGL not supported');
        return;
      }

      const quad = createShaderQuad(gl, fragmentShader);
      quadRef.current = quad;
      if (!quad) return; // compile/link failed — leave the canvas blank

      const resize = () => {
        const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
        const scale = dpr * settingsRef.current.resolution;
        canvas.width = Math.max(1, Math.floor(window.innerWidth * scale));
        canvas.height = Math.max(1, Math.floor(window.innerHeight * scale));
        setRes({ w: canvas.width, h: canvas.height });
      };
      resizeRef.current = resize;

      const onPointer = (e: PointerEvent) => {
        pointerRef.current = {
          x: (e.clientX / window.innerWidth) * 2 - 1,
          y: 1 - (e.clientY / window.innerHeight) * 2,
        };
      };

      window.addEventListener('resize', resize);
      window.addEventListener('pointermove', onPointer);
      resize();

      return () => {
        window.removeEventListener('resize', resize);
        window.removeEventListener('pointermove', onPointer);
        quad.dispose();
        quadRef.current = null;
        // NOTE: do NOT call WEBGL_lose_context.loseContext() here. A canvas
        // hands back the same context on every getContext() call, so losing it
        // would poison the next mount (StrictMode/HMR reuse the same canvas
        // node) — the re-acquired context is already lost and every shader
        // compile fails with a null info log. The context is freed when the
        // canvas node is removed on real unmount.
      };
    }, []);

    // Re-scale the backing store when the resolution setting changes.
    useEffect(() => {
      resizeRef.current();
    }, [settings.resolution]);

    // Apply brightness + contrast as a CSS filter (works for any shader, no uniforms needed).
    const { brightness, contrast } = settings;
    useEffect(() => {
      const canvas = canvasRef.current;
      if (canvas) canvas.style.filter = displayFilter({ brightness, contrast });
    }, [brightness, contrast]);

    // One draw per (capped) frame, on the shared loop. Stable callback reading refs.
    const onFrame = useCallback((manager: { deltaTime: number }) => {
      const quad = quadRef.current;
      if (!quad) return;
      iTimeRef.current += manager.deltaTime * settingsRef.current.speed;
      quad.draw({ time: iTimeRef.current, pointer: pointerRef.current });

      if (options.getSectionName) {
        const nextSectionName = options.getSectionName(iTimeRef.current);
        if (nextSectionName !== sectionNameRef.current) {
          sectionNameRef.current = nextSectionName;
          setSectionName(nextSectionName);
          setSectionGlitchKey((value) => value + 1);
        }
      }

      // FPS sampling — count frames and publish once per second.
      fpsFrameCountRef.current += 1;
      const now = performance.now();
      if (fpsLastTimeRef.current === 0) fpsLastTimeRef.current = now;
      const elapsed = now - fpsLastTimeRef.current;
      if (elapsed >= 1000) {
        setFps(Math.round((fpsFrameCountRef.current * 1000) / elapsed));
        fpsFrameCountRef.current = 0;
        fpsLastTimeRef.current = now;
      }
    }, []);
    useFrameLoop(onFrame);

    const containerStyle = options.accent
      ? ({ ['--accent' as string]: options.accent } as React.CSSProperties)
      : undefined;

    return (
      <main id="app-container" style={containerStyle}>
        <canvas id="gl-canvas" ref={canvasRef} />
        <section id="crt-overlay" />
        <Link id="back-btn" href="/">
          ← INDEX
        </Link>
        {sectionName && (
          <header
            key={sectionGlitchKey}
            id="sector-title"
            className={options.sectionTitleClassName}
            data-text={sectionName}
          >
            {sectionName}
          </header>
        )}
        <button
          id="fullscreen-btn"
          onClick={() => {
            if (!document.fullscreenElement) {
              document.documentElement.requestFullscreen().catch((err) =>
                console.error('Error enabling fullscreen:', err),
              );
            } else {
              document.exitFullscreen();
            }
          }}
        >
          FULLSCREEN
        </button>
        <aside id="fps-display">
          {res.w}×{res.h} · {fps} FPS
        </aside>
        <SettingsButton />
      </main>
    );
  }

  ShaderJourney.displayName = 'ShaderJourney';
  return ShaderJourney;
}

export default withShaderJourney;
