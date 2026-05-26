'use client';

import React, { useEffect, useRef, useState } from 'react';
import { vsQuad, fsScene, fsPost } from './shaders';
import {
  getSectorScale,
  getWarpedMZ,
  getWarpedZ,
  getCamX,
  getCamOffset,
  getCamY,
  getFloorY,
  smoothstep,
  mix
} from './kinematics';

export default function LiminalJourney() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointerRef = useRef({ x: 0, y: 0 });

  const [sectorName, setSectorName] = useState("AWAITING TELEMETRY");
  const [glitchKey, setGlitchKey] = useState(0);

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

    const postResLoc = gl.getUniformLocation(postProg, "iResolution");
    const postTimeLoc = gl.getUniformLocation(postProg, "iTime");
    const postTexLoc = gl.getUniformLocation(postProg, "uTexture");
    const postPointerLoc = gl.getUniformLocation(postProg, "uPointer");
    const postIterLoc = gl.getUniformLocation(postProg, "uIteration");

    let animationId: number;
    let lastSector = "";

    const render = (time: number) => {
        const iTime = time * 0.001;
        
        const SPEED = 5.0; 
        const currentZ = iTime * SPEED;
        const mz = currentZ % 300.0;
        const currentIteration = Math.floor(currentZ / 300.0);
        
        // Transitions the decay update smoothly centered around loop boundary
        let smoothIteration = currentIteration;
        if (mz > 280.0) {
            const t = (mz - 280.0) / 40.0;
            const ease = 3.0 * t * t - 2.0 * t * t * t;
            smoothIteration = currentIteration + ease;
        } else if (mz < 20.0) {
            const t = (mz + 20.0) / 40.0;
            const ease = 3.0 * t * t - 2.0 * t * t * t;
            smoothIteration = (currentIteration - 1) + ease;
            if (smoothIteration < 0.0) smoothIteration = 0.0;
        }
        
        // Calculate dynamic warped boundaries in JS
        const s1 = getSectorScale(1, smoothIteration);
        const s2 = getSectorScale(2, smoothIteration);
        const s3 = getSectorScale(3, smoothIteration);
        const s4 = getSectorScale(4, smoothIteration);
        const s5 = getSectorScale(5, smoothIteration);
        const s6 = getSectorScale(6, smoothIteration);
        
        const w1 = 30.0 * s1;
        const w2 = 40.0 * s2;
        const w3 = 50.0 * s3;
        const w4 = 70.0 * s4;
        const w5 = 80.0 * s5;
        
        const sum = w1 + w2 + w3 + w4 + w5 + (30.0 * s6);
        const wb1 = 300.0 * (w1 / sum);
        const wb2 = wb1 + 300.0 * (w2 / sum);
        const wb3 = wb2 + 300.0 * (w3 / sum);
        const wb4 = wb3 + 300.0 * (w4 / sum);
        const wb5 = wb4 + 300.0 * (w5 / sum);
        
        let sector = "UNKNOWN";
        const is666Now = (Math.floor(smoothIteration) === 2);

        if (is666Now) {
            // Horror naming convention for Sector 666
            if (mz < wb1) sector = "SECTOR 666: THE WEAKENING WALLS";
            else if (mz < wb2) sector = "SECTOR 666: THE BLOOD WATER FALL";
            else if (mz < wb3) sector = "SECTOR 666: SACRIFICIAL PIT";
            else if (mz < wb4) sector = "SECTOR 666: FLOATING BRINK";
            else if (mz < wb5) sector = "SECTOR 666: VOID PARANOIA";
            else sector = "SECTOR 666: THE ABYSS";
        } else {
            // Normal Names
            if (mz < wb1) sector = "SECTOR 1: POOLROOMS";
            else if (mz < wb2) sector = "SECTOR 2: THE DESCENT";
            else if (mz < wb3) sector = "SECTOR 3: CHASM TUBE";
            else if (mz < wb4) sector = "SECTOR 4: CRUMBLING BRIDGE";
            else if (mz < wb5) sector = "SECTOR 5: GRAVITY LABYRINTH";
            else sector = "SECTOR 6: TRANSITION CORRIDOR";
        }
        
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

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        #app-container {
            position: relative;
            width: 100vw;
            height: 100vh;
            background-color: #000;
            overflow: hidden;
            font-family: monospace;
            user-select: none;
        }
        #gl-canvas {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 0;
            display: block;
        }
        #crt-overlay {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 5;
            pointer-events: none;
            background: linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.25) 50%), linear-gradient(90deg, rgba(255, 0, 0, 0.06), rgba(0, 255, 0, 0.02), rgba(0, 0, 255, 0.06));
            background-size: 100% 4px, 3px 100%;
        }
        #sector-title {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            color: #fff;
            font-family: Georgia, serif;
            font-size: 15px;
            letter-spacing: 8px;
            text-transform: uppercase;
            text-align: center;
            pointer-events: none;
            z-index: 20;
            text-shadow: 0 0 10px rgba(255, 255, 255, 0.6);
            animation: fadeGlitch 4.5s cubic-bezier(0.19, 1, 0.22, 1) forwards;
        }
        #sector-title::before, #sector-title::after {
            content: attr(data-text);
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.01);
        }
        #sector-title::before {
            left: 3px;
            text-shadow: -3px 0 #ff0055;
            animation: glitchAnim1 0.8s infinite linear alternate-reverse;
        }
        #sector-title::after {
            left: -3px;
            text-shadow: -2px 0 #00ffff, 0 3px #ffff00;
            animation: glitchAnim2 0.7s infinite linear alternate-reverse;
        }
        @keyframes fadeGlitch {
            0% {
                opacity: 0;
                transform: translate(-50%, -50%) scale(0.85) skewX(20deg);
                filter: hue-rotate(180deg) brightness(2);
            }
            8% {
                opacity: 1;
                transform: translate(-50%, -50%) scale(1.05) skewX(-15deg);
                filter: none;
            }
            14% {
                opacity: 1;
                transform: translate(-50%, -50%) scale(1) skewX(0);
            }
            82% {
                opacity: 1;
                transform: translate(-50%, -50%) scale(1) skewX(0);
            }
            100% {
                opacity: 0.15;
                transform: translate(-50%, -50%) scale(0.98);
            }
        }
        @keyframes glitchAnim1 {
          0% { clip-path: inset(10% 0 85% 0); }
          10% { clip-path: inset(80% 0 5% 0); }
          20% { clip-path: inset(5% 0 90% 0); }
          30% { clip-path: inset(45% 0 45% 0); }
          40% { clip-path: inset(92% 0 1% 0); }
          50% { clip-path: inset(15% 0 80% 0); }
          60% { clip-path: inset(80% 0 5% 0); }
          70% { clip-path: inset(3% 0 92% 0); }
          80% { clip-path: inset(50% 0 43% 0); }
          90% { clip-path: inset(10% 0 82% 0); }
          100% { clip-path: inset(25% 0 70% 0); }
        }
        @keyframes glitchAnim2 {
          0% { clip-path: inset(75% 0 15% 0); }
          10% { clip-path: inset(15% 0 80% 0); }
          20% { clip-path: inset(3% 0 92% 0); }
          30% { clip-path: inset(80% 0 5% 0); }
          40% { clip-path: inset(40% 0 55% 0); }
          50% { clip-path: inset(92% 0 2% 0); }
          60% { clip-path: inset(55% 0 40% 0); }
          70% { clip-path: inset(5% 0 85% 0); }
          80% { clip-path: inset(85% 0 10% 0); }
          90% { clip-path: inset(20% 0 75% 0); }
          100% { clip-path: inset(45% 0 50% 0); }
        }
      `}} />
      <main id="app-container">
        <canvas id="gl-canvas" ref={canvasRef} />
        <section id="crt-overlay" />
        <header key={glitchKey} id="sector-title" data-text={sectorName}>
          {sectorName}
        </header>
      </main>
    </>
  );
}
