'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { createShaderQuad } from '@/lib/shaderQuad';
import { signalBloomFrag } from './shader';

const MAX_DPR = 2;

export default function SignalBloomJourney() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointerRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl', { antialias: false, depth: false, alpha: false });
    if (!gl) {
      console.error('WebGL not supported');
      return;
    }

    const quad = createShaderQuad(gl, signalBloomFrag);
    if (!quad) return;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
    };
    const onPointer = (e: PointerEvent) => {
      pointerRef.current = {
        x: (e.clientX / window.innerWidth) * 2 - 1,
        y: 1 - (e.clientY / window.innerHeight) * 2,
      };
    };
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', onPointer);
    resize();

    let raf = 0;
    const render = () => {
      quad.draw({ time: performance.now() * 0.001, pointer: pointerRef.current });
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onPointer);
      quad.dispose();
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, []);

  return (
    <main id="app-container">
      <canvas id="gl-canvas" ref={canvasRef} />
      <section id="crt-overlay" />
      <Link id="fullscreen-btn" href="/" style={{ textDecoration: 'none' }}>
        ← INDEX
      </Link>
    </main>
  );
}
