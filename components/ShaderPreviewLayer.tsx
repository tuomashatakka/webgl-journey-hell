'use client';

// Owns the ONE shared WebGL canvas for the whole landing grid. Cards call
// activate()/deactivate() on hover/focus; the single canvas is moved into the
// hovered card's mount slot and renders that journey's previewShader. Programs
// are compiled once per journey and cached in the shared context, so switching
// previews is just a useProgram — never more than one GL context exists.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { createShaderQuad, type ShaderQuad } from '@/lib/shaderQuad';
import type { Journey } from '@/app/journeys/registry';

interface PreviewAPI {
  activate: (journey: Journey, slot: HTMLElement) => void;
  deactivate: (slug: string) => void;
}

const PreviewCtx = createContext<PreviewAPI | null>(null);

/** Hook for cards to drive the shared preview. Null outside a PreviewProvider. */
export function usePreview(): PreviewAPI | null {
  return useContext(PreviewCtx);
}

// Render the preview below native resolution — plenty for a thumbnail, easy on the GPU.
const PREVIEW_SCALE = 0.6;
const MAX_DPR = 2;

export function PreviewProvider({ children }: { children: ReactNode }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const glRef = useRef<WebGLRenderingContext | null>(null);
  const quadCache = useRef<Map<string, ShaderQuad | null>>(new Map());
  const rafRef = useRef<number>(0);
  const activeSlugRef = useRef<string | null>(null);
  const pointerRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Create the canvas + context imperatively so React StrictMode's dev double
  // mount cannot leak a second GL context — cleanup tears everything down.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const canvas = document.createElement('canvas');
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    canvas.style.pointerEvents = 'none'; // keep the card clickable underneath
    host.appendChild(canvas);

    const onPointer = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      pointerRef.current = {
        x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
        y: 1 - ((e.clientY - rect.top) / rect.height) * 2,
      };
    };
    window.addEventListener('pointermove', onPointer);

    canvasRef.current = canvas;
    glRef.current = canvas.getContext('webgl', {
      antialias: false,
      depth: false,
      alpha: false,
    });

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('pointermove', onPointer);
      quadCache.current.forEach((q) => q?.dispose());
      quadCache.current.clear();
      glRef.current?.getExtension('WEBGL_lose_context')?.loseContext();
      canvas.remove();
      glRef.current = null;
      canvasRef.current = null;
      activeSlugRef.current = null;
    };
  }, []);

  const renderLoop = useCallback(() => {
    const gl = glRef.current;
    const slug = activeSlugRef.current;
    if (!gl || !slug) return;
    const quad = quadCache.current.get(slug);
    quad?.draw({ time: performance.now() * 0.001, pointer: pointerRef.current });
    rafRef.current = requestAnimationFrame(renderLoop);
  }, []);

  const activate = useCallback(
    (journey: Journey, slot: HTMLElement) => {
      const gl = glRef.current;
      const canvas = canvasRef.current;
      if (!gl || !canvas) return;

      slot.appendChild(canvas); // move the single canvas onto the hovered card
      activeSlugRef.current = journey.slug;

      const rect = slot.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      canvas.width = Math.max(1, Math.floor(rect.width * dpr * PREVIEW_SCALE));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr * PREVIEW_SCALE));

      if (!quadCache.current.has(journey.slug)) {
        quadCache.current.set(journey.slug, createShaderQuad(gl, journey.previewShader));
      }

      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(renderLoop);
    },
    [renderLoop],
  );

  const deactivate = useCallback((slug: string) => {
    if (activeSlugRef.current !== slug) return; // a newer card already took over
    cancelAnimationFrame(rafRef.current);
    activeSlugRef.current = null;
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (host && canvas) host.appendChild(canvas); // park canvas back off-screen
  }, []);

  const api = useMemo<PreviewAPI>(() => ({ activate, deactivate }), [activate, deactivate]);

  return (
    <PreviewCtx.Provider value={api}>
      <div
        ref={hostRef}
        aria-hidden
        style={{
          position: 'fixed',
          left: -9999,
          top: 0,
          width: 1,
          height: 1,
          overflow: 'hidden',
          pointerEvents: 'none',
        }}
      />
      {children}
    </PreviewCtx.Provider>
  );
}
