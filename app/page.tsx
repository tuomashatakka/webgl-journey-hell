'use client';

import React, { useEffect, useRef, useState } from 'react';
import { vsQuad, fsScene, fsPost } from './shaders';
import { getKinematicState, getWalkSpeed } from './kinematics';

export default function LiminalJourney() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointerRef = useRef({ x: 0, y: 0 });

  const [sectorName, setSectorName] = useState("AWAITING TELEMETRY");
  const [glitchKey, setGlitchKey] = useState(0);
  const [fps, setFps] = useState(60);

  const handleFullscreenToggle = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => {
        console.error("Error attempting to enable fullscreen:", err);
      });
    } else {
      document.exitFullscreen();
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const gl = canvas.getContext('webgl', { antialias: false, depth: false });
    if (!gl) {
      console.error("WebGL not supported");
      return;
    }

    const handlePointerMove = (e: PointerEvent) => {
      const nx = (e.clientX / window.innerWidth) * 2.0 - 1.0;
      const ny = (e.clientY / window.innerHeight) * 2.0 - 1.0;
      pointerRef.current = { x: nx, y: -ny };
    };
    window.addEventListener('pointermove', handlePointerMove);

    function compileShader(type: number, source: string) {
      const shader = gl!.createShader(type);
      if (!shader) return null;
      gl!.shaderSource(shader, source);
      gl!.compileShader(shader);
      if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) {
        console.error("Shader Compile Error:", gl!.getShaderInfoLog(shader));
        gl!.deleteShader(shader);
        return null;
      }
      return shader;
    }

    function createProgram(vsSource: string, fsSource: string) {
      const vs = compileShader(gl!.VERTEX_SHADER, vsSource);
      const fs = compileShader(gl!.FRAGMENT_SHADER, fsSource);
      if (!vs || !fs) return null;
      const prog = gl!.createProgram();
      if (!prog) return null;
      gl!.attachShader(prog, vs);
      gl!.attachShader(prog, fs);
      gl!.linkProgram(prog);
      if (!gl!.getProgramParameter(prog, gl!.LINK_STATUS)) {
        console.error("Program Link Error:", gl!.getProgramInfoLog(prog));
        return null;
      }
      return prog;
    }

    const sceneProg = createProgram(vsQuad, fsScene);
    const postProg = createProgram(vsQuad, fsPost);
    if (!sceneProg || !postProg) return;

    const quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1,   1, -1,   -1,  1,   1,  1
    ]), gl.STATIC_DRAW);

    const fbo = gl.createFramebuffer();
    const tex = gl.createTexture();

    const resize = () => {
        const dpr = window.devicePixelRatio || 1;
        const resolutionScale = Math.min(dpr, 1.25); 
        canvas.width = window.innerWidth * resolutionScale;
        canvas.height = window.innerHeight * resolutionScale;
        
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, canvas.width, canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    };

    window.addEventListener('resize', resize);
    resize();

    const sceneResLoc = gl.getUniformLocation(sceneProg, "iResolution");
    const sceneTimeLoc = gl.getUniformLocation(sceneProg, "iTime");
    const sceneIterLoc = gl.getUniformLocation(sceneProg, "uIteration");
    const scenePointerLoc = gl.getUniformLocation(sceneProg, "uPointer");
    const scenePlayerZLoc = gl.getUniformLocation(sceneProg, "uPlayerZ");

    const postResLoc = gl.getUniformLocation(postProg, "iResolution");
    const postTimeLoc = gl.getUniformLocation(postProg, "iTime");
    const postTexLoc = gl.getUniformLocation(postProg, "uTexture");
    const postPointerLoc = gl.getUniformLocation(postProg, "uPointer");
    const postIterLoc = gl.getUniformLocation(postProg, "uIteration");
    const postPlayerZLoc = gl.getUniformLocation(postProg, "uPlayerZ");

    let animationId: number;
    let lastSector = "";
    let currentZ = 0.0;
    let lastTime = 0.0;

    let frameCount = 0;
    let fpsLastTime = performance.now();

    const render = (time: number) => {
        const iTime = time * 0.001;
        
        if (lastTime === 0.0) {
            lastTime = time;
        }
        const dt = Math.min((time - lastTime) * 0.001, 0.1);
        lastTime = time;

        // Count frames to evaluate FPS
        frameCount++;
        const now = performance.now();
        if (now - fpsLastTime >= 1000) {
            setFps(Math.round((frameCount * 1000) / (now - fpsLastTime)));
            frameCount = 0;
            fpsLastTime = now;
        }

        // Accumulate player Z based on frame-rate independent walk speed
        const speed = getWalkSpeed(currentZ);
        currentZ += speed * dt;

        const state = getKinematicState(currentZ);
        const currentIteration = state.loop;
        
        // Transitions the decay update smoothly centered around 600-unit loop boundaries
        let smoothIteration = currentIteration;
        if (currentZ >= 580.0 && currentZ < 620.0) {
            const t = (currentZ - 580.0) / 40.0;
            const ease = 3.0 * t * t - 2.0 * t * t * t;
            smoothIteration = 0.0 + ease;
        } else if (currentZ >= 1180.0 && currentZ < 1220.0) {
            const t = (currentZ - 1180.0) / 40.0;
            const ease = 3.0 * t * t - 2.0 * t * t * t;
            smoothIteration = 1.0 + ease;
        } else if (currentZ >= 1780.0 && currentZ < 1820.0) {
            const t = (currentZ - 1780.0) / 40.0;
            const ease = 3.0 * t * t - 2.0 * t * t * t;
            smoothIteration = 2.0 + ease;
        } else {
            smoothIteration = currentIteration;
        }
        
        const sector = state.name;
        if (sector !== lastSector) {
            lastSector = sector;
            setSectorName(sector);
            setGlitchKey(prev => prev + 1);
        }
        
        // --- PASS 1: Raymarch to FBO ---
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.viewport(0, 0, canvas.width, canvas.height);
        
        gl.useProgram(sceneProg);
        const posLoc1 = gl.getAttribLocation(sceneProg, "position");
        gl.enableVertexAttribArray(posLoc1);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
        gl.vertexAttribPointer(posLoc1, 2, gl.FLOAT, false, 0, 0);
        
        gl.uniform2f(sceneResLoc, canvas.width, canvas.height);
        gl.uniform1f(sceneTimeLoc, iTime);
        gl.uniform1f(sceneIterLoc, smoothIteration);
        gl.uniform2f(scenePointerLoc, pointerRef.current.x, pointerRef.current.y);
        gl.uniform1f(scenePlayerZLoc, currentZ);
        
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        
        // --- PASS 2: Post-Process to Screen ---
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvas.width, canvas.height);
        
        gl.useProgram(postProg);
        const posLoc2 = gl.getAttribLocation(postProg, "position");
        gl.enableVertexAttribArray(posLoc2);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
        gl.vertexAttribPointer(posLoc2, 2, gl.FLOAT, false, 0, 0);
        
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(postTexLoc, 0);
        
        gl.uniform2f(postResLoc, canvas.width, canvas.height);
        gl.uniform1f(postTimeLoc, iTime);
        gl.uniform2f(postPointerLoc, pointerRef.current.x, pointerRef.current.y);
        gl.uniform1f(postIterLoc, smoothIteration);
        gl.uniform1f(postPlayerZLoc, currentZ);
        
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        
        animationId = requestAnimationFrame(render);
    };
 
    animationId = requestAnimationFrame(render);
 
    return () => {
       window.removeEventListener('resize', resize);
       window.removeEventListener('pointermove', handlePointerMove);
       cancelAnimationFrame(animationId);
       
       gl.deleteBuffer(quadBuffer);
       gl.deleteTexture(tex);
       gl.deleteFramebuffer(fbo);
       gl.deleteProgram(sceneProg);
       gl.deleteProgram(postProg);
    };
  }, []);

  return <main id="app-container">
    <canvas id="gl-canvas" ref={canvasRef} />
    <section id="crt-overlay" />
    <header key={glitchKey} id="sector-title" data-text={sectorName}>
      {sectorName}
    </header>
    <button id="fullscreen-btn" onClick={handleFullscreenToggle}>FULLSCREEN</button>
    <aside id="fps-display">{fps} FPS</aside>
  </main>
}
