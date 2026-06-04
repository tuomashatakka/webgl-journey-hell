'use client';

import React, { useEffect, useRef, useState } from 'react';
import { vsQuad, fsScene, fsPost } from './shaders';
import { getKinematicState, getWalkSpeed } from './kinematics';
import { GraphicsSettings } from '@/lib/settings';
import { useSettings } from '@/components/SettingsProvider';
import { Settings as SettingsIcon } from 'lucide-react';
import Link from 'next/link';
import SettingsView from '@/components/SettingsView';

// Procedural ambience for the concrete shaft: HVAC room tone + a low wind drone,
// reverberant water drips, and the occasional distant handrail clang. All
// synthesized — no audio assets. Gains are nudged per descent segment.
class StairwellAudioEngine {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = true;
  private windLFO: OscillatorNode | null = null;
  private dripInterval: any = null;
  private clangInterval: any = null;

  private droneOscL: OscillatorNode | null = null;
  private droneOscR: OscillatorNode | null = null;
  private mainVolume: GainNode | null = null;
  private roomVolume: GainNode | null = null;
  private dripVolume: GainNode | null = null;
  private clangVolume: GainNode | null = null;

  constructor() {}

  public toggleMute(): boolean {
    if (!this.ctx) {
      this.initContext();
    }
    this.isMuted = !this.isMuted;
    if (this.mainVolume && this.ctx) {
      this.mainVolume.gain.setValueAtTime(this.isMuted ? 0.0 : 0.85, this.ctx.currentTime);
    }
    return this.isMuted;
  }

  public getMutedState(): boolean {
    return this.isMuted;
  }

  private initContext() {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtx();

      this.mainVolume = this.ctx.createGain();
      this.mainVolume.gain.setValueAtTime(0.0, this.ctx.currentTime);
      this.mainVolume.connect(this.ctx.destination);

      // --- Room tone: brown-ish noise through a slowly-sweeping lowpass (air/HVAC) ---
      const bufferSize = 2 * this.ctx.sampleRate;
      const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      let lastOut = 0.0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2.0 - 1.0;
        output[i] = (lastOut + 0.02 * white) / 1.02;
        lastOut = output[i];
        output[i] *= 3.2;
      }

      const noiseSource = this.ctx.createBufferSource();
      noiseSource.buffer = noiseBuffer;
      noiseSource.loop = true;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(210.0, this.ctx.currentTime);
      filter.Q.setValueAtTime(1.6, this.ctx.currentTime);

      this.windLFO = this.ctx.createOscillator();
      this.windLFO.frequency.setValueAtTime(0.06, this.ctx.currentTime);
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.setValueAtTime(140.0, this.ctx.currentTime);
      this.windLFO.connect(lfoGain);
      lfoGain.connect(filter.frequency);
      this.windLFO.start();

      this.roomVolume = this.ctx.createGain();
      this.roomVolume.gain.setValueAtTime(0.22, this.ctx.currentTime);
      noiseSource.connect(filter);
      filter.connect(this.roomVolume);
      this.roomVolume.connect(this.mainVolume);
      noiseSource.start();

      // --- Low wind/structural drone (two detuned partials, heavily lowpassed) ---
      this.droneOscL = this.ctx.createOscillator();
      this.droneOscR = this.ctx.createOscillator();
      this.droneOscL.type = 'sine';
      this.droneOscR.type = 'triangle';
      this.droneOscL.frequency.setValueAtTime(46.0, this.ctx.currentTime);
      this.droneOscR.frequency.setValueAtTime(47.1, this.ctx.currentTime);

      const droneGain = this.ctx.createGain();
      droneGain.gain.setValueAtTime(0.13, this.ctx.currentTime);
      const droneFilter = this.ctx.createBiquadFilter();
      droneFilter.type = 'lowpass';
      droneFilter.frequency.setValueAtTime(90.0, this.ctx.currentTime);
      this.droneOscL.connect(droneFilter);
      this.droneOscR.connect(droneFilter);
      droneFilter.connect(droneGain);
      droneGain.connect(this.mainVolume);
      this.droneOscL.start();
      this.droneOscR.start();

      // --- Drips + clangs ---
      this.dripVolume = this.ctx.createGain();
      this.dripVolume.gain.setValueAtTime(0.35, this.ctx.currentTime);
      this.dripVolume.connect(this.mainVolume);
      this.startDripper();

      this.clangVolume = this.ctx.createGain();
      this.clangVolume.gain.setValueAtTime(0.12, this.ctx.currentTime);
      this.clangVolume.connect(this.mainVolume);
      this.startClangEngine();
    } catch (e) {
      console.error('Audio Context initialization failed:', e);
    }
  }

  private startDripper() {
    const playDrip = () => {
      if (!this.ctx || this.isMuted) return;

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();

      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(900 + Math.random() * 350, this.ctx.currentTime);
      filter.Q.setValueAtTime(7.0, this.ctx.currentTime);

      osc.type = 'sine';
      const startFreq = 1300.0 + Math.random() * 600.0;
      const endFreq = 320.0 + Math.random() * 160.0;
      osc.frequency.setValueAtTime(startFreq, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(endFreq, this.ctx.currentTime + 0.10);

      gain.gain.setValueAtTime(0.0, this.ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.3 + Math.random() * 0.35, this.ctx.currentTime + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.45); // long concrete reverb tail

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.dripVolume!);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.5);
    };

    const scheduleNext = () => {
      playDrip();
      const delay = 900 + Math.random() * 2600; // sparse, lonely
      this.dripInterval = setTimeout(scheduleNext, delay);
    };

    scheduleNext();
  }

  private startClangEngine() {
    const playClang = () => {
      if (!this.ctx || this.isMuted) return;

      // A distant metallic handrail knock: a few inharmonic partials, short-ish decay.
      const partials = [1.0, 2.76, 5.4];
      const base = 220.0 + Math.random() * 120.0;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(base * 2.0, this.ctx.currentTime);
      filter.Q.setValueAtTime(3.0, this.ctx.currentTime);
      filter.connect(this.clangVolume!);

      for (let i = 0; i < partials.length; i++) {
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(base * partials[i], this.ctx.currentTime);
        const amp = 0.3 / (i + 1);
        g.gain.setValueAtTime(0.0, this.ctx.currentTime);
        g.gain.linearRampToValueAtTime(amp, this.ctx.currentTime + 0.002);
        g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.35 + i * 0.05);
        osc.connect(g);
        g.connect(filter);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.5);
      }
    };

    const runClang = () => {
      if (!this.isMuted && Math.random() < 0.5) {
        playClang();
      }
      this.clangInterval = setTimeout(runClang, 2500 + Math.random() * 6000);
    };

    runClang();
  }

  // Modulate the mix per descent segment (loop length 500u, matches kinematics).
  public updateState(z: number) {
    if (!this.ctx || this.isMuted) return;

    const lz = z % 500.0;
    const time = this.ctx.currentTime;

    const isLongDescent = lz >= 70.0 && lz < 250.0;     // sectors II + III
    const isImpossible = lz >= 250.0 && lz < 360.0;     // sector IV — Escher
    const isShaft = lz >= 360.0;                        // sector V — light

    if (this.dripVolume) {
      const target = isLongDescent ? 0.6 : isShaft ? 0.12 : 0.32;
      this.dripVolume.gain.setTargetAtTime(target, time, 0.6);
    }

    if (this.clangVolume) {
      const target = isImpossible ? 0.55 : 0.1;
      this.clangVolume.gain.setTargetAtTime(target, time, 0.4);
    }

    if (this.droneOscL && this.droneOscR) {
      // Pitch the drone down + detune wider through the impossible flight.
      const fL = isImpossible ? 38.0 : isShaft ? 52.0 : 46.0;
      const fR = isImpossible ? 39.7 : isShaft ? 52.6 : 47.1;
      this.droneOscL.frequency.setTargetAtTime(fL, time, 1.2);
      this.droneOscR.frequency.setTargetAtTime(fR, time, 1.2);
    }
  }

  public destroy() {
    if (this.ctx) {
      this.ctx.close();
    }
    if (this.dripInterval) {
      clearTimeout(this.dripInterval);
    }
    if (this.clangInterval) {
      clearTimeout(this.clangInterval);
    }
  }
}

export default function StairwellJourney() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointerRef = useRef({ x: 0, y: 0 });

  const [sectorName, setSectorName] = useState('ENTERING THE STAIRWELL');
  const [glitchKey, setGlitchKey] = useState(0);
  const [fps, setFps] = useState(60);
  const [renderRes, setRenderRes] = useState({ w: 0, h: 0 });
  const [isMuted, setIsMuted] = useState(true);

  const { settings, setSettings } = useSettings();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const audioEngineRef = useRef<StairwellAudioEngine | null>(null);

  const handleAudioToggle = () => {
    if (!audioEngineRef.current) {
      audioEngineRef.current = new StairwellAudioEngine();
    }
    const currentMuted = audioEngineRef.current.toggleMute();
    setIsMuted(currentMuted);
  };

  const settingsRef = useRef<GraphicsSettings>(settings);
  useEffect(() => {
    settingsRef.current = settings;
    // Contrast via CSS filter (brightness stays in-shader through uBrightness).
    if (canvasRef.current) canvasRef.current.style.filter = `contrast(${settings.contrast})`;
  }, [settings]);

  const resizeRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (resizeRef.current) {
      resizeRef.current();
    }
  }, [settings.resolution]);

  const handleFullscreenToggle = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => {
        console.error('Error attempting to enable fullscreen:', err);
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
      console.error('WebGL not supported');
      return;
    }

    const handlePointerMove = (e: PointerEvent) => {
      const nx = (e.clientX / window.innerWidth) * 2.0 - 1.0;
      const ny = (e.clientY / window.innerHeight) * 2.0 - 1.0;
      pointerRef.current = { x: -nx, y: -ny };
    };
    window.addEventListener('pointermove', handlePointerMove);

    function compileShader(type: number, source: string) {
      const shader = gl!.createShader(type);
      if (!shader) return null;
      gl!.shaderSource(shader, source);
      gl!.compileShader(shader);
      if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) {
        console.error('Shader Compile Error:', gl!.getShaderInfoLog(shader));
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
        console.error('Program Link Error:', gl!.getProgramInfoLog(prog));
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
      -1, -1, 1, -1, -1, 1, 1, 1,
    ]), gl.STATIC_DRAW);

    const fbo = gl.createFramebuffer();
    const tex = gl.createTexture();

    const resize = () => {
      const userScale = settingsRef.current.resolution;
      canvas.width = window.innerWidth * userScale;
      canvas.height = window.innerHeight * userScale;
      setRenderRes({ w: canvas.width, h: canvas.height });

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
    resizeRef.current = resize;
    resize();

    const sceneResLoc = gl.getUniformLocation(sceneProg, 'iResolution');
    const sceneTimeLoc = gl.getUniformLocation(sceneProg, 'iTime');
    const sceneIterLoc = gl.getUniformLocation(sceneProg, 'uIteration');
    const scenePointerLoc = gl.getUniformLocation(sceneProg, 'uPointer');
    const scenePlayerZLoc = gl.getUniformLocation(sceneProg, 'uPlayerZ');
    const sceneHeavyLoc = gl.getUniformLocation(sceneProg, 'uHeavy');

    const postResLoc = gl.getUniformLocation(postProg, 'iResolution');
    const postTimeLoc = gl.getUniformLocation(postProg, 'iTime');
    const postTexLoc = gl.getUniformLocation(postProg, 'uTexture');
    const postPointerLoc = gl.getUniformLocation(postProg, 'uPointer');
    const postIterLoc = gl.getUniformLocation(postProg, 'uIteration');
    const postPlayerZLoc = gl.getUniformLocation(postProg, 'uPlayerZ');
    const postBrightnessLoc = gl.getUniformLocation(postProg, 'uBrightness');

    let animationId: number;
    let lastSector = '';
    let currentZ = 0.0;
    let lastTime = 0.0;
    let accumulatedTime = 0.0;
    let lastDrawTime = 0.0;

    let frameCount = 0;
    let fpsLastTime = performance.now();

    const render = (time: number) => {
      animationId = requestAnimationFrame(render);

      // Honor the global MAX FRAME RATE cap (0 = uncapped).
      const maxFps = settingsRef.current.maxFrameRate;
      const msPerFrame = maxFps > 0 ? 1000.0 / maxFps : 0.0;
      if (msPerFrame > 0.0 && time - lastDrawTime < msPerFrame) {
        return;
      }
      lastDrawTime = time;

      if (lastTime === 0.0) {
        lastTime = time;
      }
      const dt = Math.min((time - lastTime) * 0.001, 0.1);
      lastTime = time;

      const currentSettings = settingsRef.current;
      const speedMultiplier = currentSettings.speed;

      frameCount++;
      const now = performance.now();
      if (now - fpsLastTime >= 1000) {
        setFps(Math.round((frameCount * 1000) / (now - fpsLastTime)));
        frameCount = 0;
        fpsLastTime = now;
      }

      const scaledDt = dt * speedMultiplier;

      // Accumulate player Z based on frame-rate independent walk speed.
      const speed = getWalkSpeed(currentZ);
      currentZ += speed * scaledDt;

      if (audioEngineRef.current) {
        audioEngineRef.current.updateState(currentZ);
      }

      const state = getKinematicState(currentZ);
      const currentIteration = state.loop;

      // Ease the iteration float across loop boundaries (500-unit cadence).
      let smoothIteration = currentIteration;
      const distFromBoundary = currentZ % 500.0;
      if (distFromBoundary >= 480.0) {
        const tt = (distFromBoundary - 480.0) / 40.0;
        const ease = 3.0 * tt * tt - 2.0 * tt * tt * tt;
        smoothIteration = currentIteration + ease;
      } else if (distFromBoundary < 20.0) {
        const tt = (distFromBoundary + 20.0) / 40.0;
        const ease = 3.0 * tt * tt - 2.0 * tt * tt * tt;
        smoothIteration = (currentIteration - 1) + ease;
      }

      const sector = state.name;
      if (sector !== lastSector) {
        lastSector = sector;
        setSectorName(sector);
        setGlitchKey((prev) => prev + 1);
      }

      accumulatedTime += scaledDt;
      const iTime = accumulatedTime;

      // --- PASS 1: Raymarch to FBO ---
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, canvas.width, canvas.height);

      gl.useProgram(sceneProg);
      const posLoc1 = gl.getAttribLocation(sceneProg, 'position');
      gl.enableVertexAttribArray(posLoc1);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
      gl.vertexAttribPointer(posLoc1, 2, gl.FLOAT, false, 0, 0);

      gl.uniform2f(sceneResLoc, canvas.width, canvas.height);
      gl.uniform1f(sceneTimeLoc, iTime);
      gl.uniform1f(sceneIterLoc, smoothIteration);
      gl.uniform2f(scenePointerLoc, pointerRef.current.x, pointerRef.current.y);
      gl.uniform1f(scenePlayerZLoc, currentZ);
      gl.uniform1f(sceneHeavyLoc, currentSettings.heavyEffects ? 1.0 : 0.0);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // --- PASS 2: Post-Process to Screen ---
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);

      gl.useProgram(postProg);
      const posLoc2 = gl.getAttribLocation(postProg, 'position');
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
      if (postBrightnessLoc) {
        gl.uniform1f(postBrightnessLoc, currentSettings.brightness);
      }

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    animationId = requestAnimationFrame(render);

    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', handlePointerMove);
      cancelAnimationFrame(animationId);

      if (audioEngineRef.current) {
        audioEngineRef.current.destroy();
        audioEngineRef.current = null;
      }

      gl.deleteBuffer(quadBuffer);
      gl.deleteTexture(tex);
      gl.deleteFramebuffer(fbo);
      gl.deleteProgram(sceneProg);
      gl.deleteProgram(postProg);
    };
  }, []);

  return <main id="app-container" style={{ ['--accent' as string]: '#aeb9c4' } as React.CSSProperties}>
    <canvas id="gl-canvas" ref={canvasRef} />
    <Link id="back-btn" href="/">← INDEX</Link>
    <header key={glitchKey} id="sector-title" data-text={sectorName}>
      {sectorName}
    </header>
    <button id="fullscreen-btn" onClick={handleFullscreenToggle}>FULLSCREEN</button>
    <button id="audio-btn" onClick={handleAudioToggle}>
      {isMuted ? 'UNMUTE AUDIO' : 'MUTE AUDIO'}
    </button>
    <button id="settings-btn" onClick={() => setIsSettingsOpen(true)} title="Settings" aria-label="Open graphics settings">
      <SettingsIcon size={16} />
    </button>
    <aside id="fps-display">{renderRes.w}×{renderRes.h} · {fps} FPS</aside>

    <SettingsView
      isOpen={isSettingsOpen}
      onClose={() => setIsSettingsOpen(false)}
      settings={settings}
      onChange={setSettings}
    />
  </main>;
}
