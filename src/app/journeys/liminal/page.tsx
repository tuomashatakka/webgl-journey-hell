'use client'

import React, { useEffect, useRef, useState } from 'react'
import { vsQuad, fsScene, fsPost } from './shaders'
import { getKinematicState, getWalkSpeed } from './kinematics'
import { GraphicsSettings } from '@/lib/settings'
import { useSettings } from '@/components/SettingsProvider'
import { Settings as SettingsIcon } from 'lucide-react'
import Link from 'next/link'
import SettingsView from '@/components/SettingsView'


class CyberLiminalAudioEngine {
  private ctx:            AudioContext | null = null
  private isMuted:        boolean = true
  private lowpassLFO:     OscillatorNode | null = null
  private waterInterval:  ReturnType<typeof setInterval> | null = null
  private glitchInterval: ReturnType<typeof setInterval> | null = null

  private droneOscL:    OscillatorNode | null = null
  private droneOscR:    OscillatorNode | null = null
  private mainVolume:   GainNode | null = null
  private noiseVolume:  GainNode | null = null
  private waterVolume:  GainNode | null = null
  private glitchVolume: GainNode | null = null

  constructor () {}

  public toggleMute (): boolean {
    if (!this.ctx)
      this.initContext()
    this.isMuted = !this.isMuted
    if (this.mainVolume && this.ctx)
      this.mainVolume.gain.setValueAtTime(this.isMuted ? 0.0 : 0.8, this.ctx.currentTime)
    return this.isMuted
  }

  public getMutedState (): boolean {
    return this.isMuted
  }

  private initContext () {
    try {
      const AudioCtx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      this.ctx       = new AudioCtx()

      this.mainVolume = this.ctx.createGain()
      this.mainVolume.gain.setValueAtTime(0.0, this.ctx.currentTime)
      this.mainVolume.connect(this.ctx.destination)

      const bufferSize  = 2 * this.ctx.sampleRate
      const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate)
      const output      = noiseBuffer.getChannelData(0)
      let lastOut = 0.0
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2.0 - 1.0
        output[i]   = (lastOut + 0.02 * white) / 1.02
        lastOut = output[i]
        output[i] *= 3.5
      }

      const noiseSource  = this.ctx.createBufferSource()
      noiseSource.buffer = noiseBuffer
      noiseSource.loop   = true

      const filter = this.ctx.createBiquadFilter()
      filter.type  = 'lowpass'
      filter.frequency.setValueAtTime(140.0, this.ctx.currentTime)
      filter.Q.setValueAtTime(2.5, this.ctx.currentTime)

      this.lowpassLFO = this.ctx.createOscillator()
      this.lowpassLFO.frequency.setValueAtTime(0.08, this.ctx.currentTime)

      const lfoGain = this.ctx.createGain()
      lfoGain.gain.setValueAtTime(110.0, this.ctx.currentTime)

      this.lowpassLFO.connect(lfoGain)
      lfoGain.connect(filter.frequency)
      this.lowpassLFO.start()

      this.noiseVolume = this.ctx.createGain()
      this.noiseVolume.gain.setValueAtTime(0.25, this.ctx.currentTime)

      noiseSource.connect(filter)
      filter.connect(this.noiseVolume)
      this.noiseVolume.connect(this.mainVolume)
      noiseSource.start()

      this.droneOscL      = this.ctx.createOscillator()
      this.droneOscR      = this.ctx.createOscillator()
      this.droneOscL.type = 'sine'
      this.droneOscR.type = 'triangle'

      this.droneOscL.frequency.setValueAtTime(54.4, this.ctx.currentTime)
      this.droneOscR.frequency.setValueAtTime(55.2, this.ctx.currentTime)

      const droneGain = this.ctx.createGain()
      droneGain.gain.setValueAtTime(0.12, this.ctx.currentTime)

      const droneFilter = this.ctx.createBiquadFilter()
      droneFilter.type  = 'lowpass'
      droneFilter.frequency.setValueAtTime(80.0, this.ctx.currentTime)

      this.droneOscL.connect(droneFilter)
      this.droneOscR.connect(droneFilter)
      droneFilter.connect(droneGain)
      droneGain.connect(this.mainVolume)

      this.droneOscL.start()
      this.droneOscR.start()

      this.waterVolume = this.ctx.createGain()
      this.waterVolume.gain.setValueAtTime(0.48, this.ctx.currentTime)
      this.waterVolume.connect(this.mainVolume)

      this.startWaterDripper()

      this.glitchVolume = this.ctx.createGain()
      this.glitchVolume.gain.setValueAtTime(0.35, this.ctx.currentTime)
      this.glitchVolume.connect(this.mainVolume)

      this.startGlitchEngine()
    }
    catch (e) {
      console.error('Audio Context initialization failed:', e)
    }
  }

  private startWaterDripper () {
    const playDrip = () => {
      if (!this.ctx || this.isMuted)
        return

      const osc    = this.ctx.createOscillator()
      const gain   = this.ctx.createGain()
      const filter = this.ctx.createBiquadFilter()

      filter.type = 'bandpass'
      filter.frequency.setValueAtTime(1100 + Math.random() * 400, this.ctx.currentTime)
      filter.Q.setValueAtTime(6.0, this.ctx.currentTime)

      osc.type        = 'sine'

      const startFreq = 1600.0 + Math.random() * 800.0
      const endFreq   = 400.0 + Math.random() * 200.0
      osc.frequency.setValueAtTime(startFreq, this.ctx.currentTime)
      osc.frequency.exponentialRampToValueAtTime(endFreq, this.ctx.currentTime + 0.08)

      gain.gain.setValueAtTime(0.0, this.ctx.currentTime)
      gain.gain.linearRampToValueAtTime(0.35 + Math.random() * 0.4, this.ctx.currentTime + 0.005)
      gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.12)

      osc.connect(filter)
      filter.connect(gain)
      gain.connect(this.waterVolume!)
      osc.start()
      osc.stop(this.ctx.currentTime + 0.15)
    }

    const scheduleNextDrip = () => {
      playDrip()

      const delay        = 400 + Math.random() * 1200
      this.waterInterval = setTimeout(scheduleNextDrip, delay)
    }

    scheduleNextDrip()
  }

  private startGlitchEngine () {
    const playGlitchClick = () => {
      if (!this.ctx || this.isMuted)
        return

      const osc  = this.ctx.createOscillator()
      const gain = this.ctx.createGain()

      osc.type = 'sawtooth'
      osc.frequency.setValueAtTime(10000.0 * Math.random(), this.ctx.currentTime)

      gain.gain.setValueAtTime(0.0, this.ctx.currentTime)
      gain.gain.linearRampToValueAtTime(0.18, this.ctx.currentTime + 0.001)
      gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.015)

      osc.connect(gain)
      gain.connect(this.glitchVolume!)
      osc.start()
      osc.stop(this.ctx.currentTime + 0.02)
    }

    const runGlitch = () => {
      if (!this.isMuted && Math.random() < 0.28) {
        const ticks = Math.floor(1 + Math.random() * 4)
        for (let i = 0; i < ticks; i++)
          setTimeout(playGlitchClick, i * 45)
      }
      this.glitchInterval = setTimeout(runGlitch, 150 + Math.random() * 3000)
    }

    runGlitch()
  }

  public updateState (z: number) {
    if (!this.ctx || this.isMuted)
      return

    const loopVal = Math.floor(z / 500.0)
    const lz      = z % 500.0

    let isWaterSegment        = false
    let isGlitchSegment       = false
    let isHeavyOrganicSegment = false

    if (lz >= 60.0 && lz < 130.0)
      isWaterSegment = true
    if (lz >= 280.0 && lz < 360.0)
      isWaterSegment = true

    if (lz >= 360.0) {
      if (loopVal > 0) {
        isGlitchSegment = true

        const local666 = lz - 360.0

        if (loopVal === 1)
          if (local666 < 60.0)
            isHeavyOrganicSegment = true
          else
            isWaterSegment = true; else if (loopVal === 2) {
          if (local666 >= 60.0 && local666 < 90.0)
            isHeavyOrganicSegment = true
        }
        else {
          if (local666 >= 40.0 && local666 < 60.0)
            isHeavyOrganicSegment = true
          if (local666 >= 100.0)
            isGlitchSegment = true
        }
      }
    }

    if (z >= 1890.0)
      isGlitchSegment = true

    const time = this.ctx.currentTime

    if (this.waterVolume) {
      const targetWaterGain = isWaterSegment ? 0.72 : 0.08
      this.waterVolume.gain.setTargetAtTime(targetWaterGain, time, 0.5)
    }

    if (this.glitchVolume) {
      const targetGlitchGain = isGlitchSegment ? 0.58 : 0.05
      this.glitchVolume.gain.setTargetAtTime(targetGlitchGain, time, 0.3)
    }

    if (this.droneOscL && this.droneOscR) {
      const targetFreqL = isHeavyOrganicSegment ? 44.0 : 54.4
      const targetFreqR = isHeavyOrganicSegment ? 44.6 : 55.2
      this.droneOscL.frequency.setTargetAtTime(targetFreqL, time, 1.0)
      this.droneOscR.frequency.setTargetAtTime(targetFreqR, time, 1.0)
    }
  }

  public destroy () {
    if (this.ctx)
      this.ctx.close()
    if (this.waterInterval)
      clearTimeout(this.waterInterval)
    if (this.glitchInterval)
      clearTimeout(this.glitchInterval)
  }
}

export default function LiminalJourney () {
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const pointerRef = useRef({ x: 0, y: 0 })

  const [ sectorName, setSectorName ] = useState('AWAITING TELEMETRY')
  const [ glitchKey, setGlitchKey ]   = useState(0)
  const [ fps, setFps ]               = useState(60)
  const [ renderRes, setRenderRes ]   = useState({ w: 0, h: 0 })
  const [ isMuted, setIsMuted ]       = useState(true)

  // Settings come from the global provider (single source of truth, persisted there).
  const { settings, setSettings }             = useSettings()
  const [ isSettingsOpen, setIsSettingsOpen ] = useState(false)

  const audioEngineRef = useRef<CyberLiminalAudioEngine | null>(null)

  const handleAudioToggle = () => {
    if (!audioEngineRef.current)
      audioEngineRef.current = new CyberLiminalAudioEngine()

    const currentMuted = audioEngineRef.current.toggleMute()
    setIsMuted(currentMuted)
  }

  // Synchronize React state developments with the WebGL animation render thread references
  const settingsRef = useRef<GraphicsSettings>(settings)
  useEffect(() => {
    settingsRef.current = settings
    // Contrast via CSS filter (brightness stays in-shader through uBrightness).
    if (canvasRef.current)
      canvasRef.current.style.filter = `contrast(${settings.contrast})`
  }, [ settings ])

  // Handle resolution variations reactively without resetting the whole GPU context
  const resizeRef = useRef<() => void>(() => {})
  useEffect(() => {
    if (resizeRef.current)
      resizeRef.current()
  }, [ settings.resolution ])

  const handleFullscreenToggle = () => {
    if (!document.fullscreenElement)
      document.documentElement.requestFullscreen().catch(err => {
        console.error('Error attempting to enable fullscreen:', err)
      }); else
      document.exitFullscreen()
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas)
      return

    const gl = canvas.getContext('webgl', { antialias: false, depth: false })
    if (!gl) {
      console.error('WebGL not supported')
      return
    }

    const handlePointerMove = (e: PointerEvent) => {
      const nx           = e.clientX / window.innerWidth * 2.0 - 1.0
      const ny           = e.clientY / window.innerHeight * 2.0 - 1.0
      pointerRef.current = { x: -nx, y: -ny }
    }
    window.addEventListener('pointermove', handlePointerMove)

    function compileShader (type: number, source: string) {
      const shader = gl!.createShader(type)
      if (!shader)
        return null
      gl!.shaderSource(shader, source)
      gl!.compileShader(shader)
      if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) {
        console.error('Shader Compile Error:', gl!.getShaderInfoLog(shader))
        gl!.deleteShader(shader)
        return null
      }
      return shader
    }

    function createProgram (vsSource: string, fsSource: string) {
      const vs = compileShader(gl!.VERTEX_SHADER, vsSource)
      const fs = compileShader(gl!.FRAGMENT_SHADER, fsSource)
      if (!vs || !fs)
        return null

      const prog = gl!.createProgram()
      if (!prog)
        return null
      gl!.attachShader(prog, vs)
      gl!.attachShader(prog, fs)
      gl!.linkProgram(prog)
      if (!gl!.getProgramParameter(prog, gl!.LINK_STATUS)) {
        console.error('Program Link Error:', gl!.getProgramInfoLog(prog))
        return null
      }
      return prog
    }

    const sceneProg = createProgram(vsQuad, fsScene)
    const postProg  = createProgram(vsQuad, fsPost)
    if (!sceneProg || !postProg)
      return

    const quadBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 1, -1, -1, 1, 1, 1
    ]), gl.STATIC_DRAW)

    const fbo = gl.createFramebuffer()
    const tex = gl.createTexture()

    const resize = () => {
      const userScale = settingsRef.current.resolution
      canvas.width    = window.innerWidth * userScale
      canvas.height   = window.innerHeight * userScale
      setRenderRes({ w: canvas.width, h: canvas.height })

      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, canvas.width, canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    }

    window.addEventListener('resize', resize)
    resizeRef.current = resize
    resize()

    const sceneResLoc     = gl.getUniformLocation(sceneProg, 'iResolution')
    const sceneTimeLoc    = gl.getUniformLocation(sceneProg, 'iTime')
    const sceneIterLoc    = gl.getUniformLocation(sceneProg, 'uIteration')
    const scenePointerLoc = gl.getUniformLocation(sceneProg, 'uPointer')
    const scenePlayerZLoc = gl.getUniformLocation(sceneProg, 'uPlayerZ')
    const sceneHeavyLoc   = gl.getUniformLocation(sceneProg, 'uHeavy')

    const postResLoc        = gl.getUniformLocation(postProg, 'iResolution')
    const postTimeLoc       = gl.getUniformLocation(postProg, 'iTime')
    const postTexLoc        = gl.getUniformLocation(postProg, 'uTexture')
    const postPointerLoc    = gl.getUniformLocation(postProg, 'uPointer')
    const postIterLoc       = gl.getUniformLocation(postProg, 'uIteration')
    const postPlayerZLoc    = gl.getUniformLocation(postProg, 'uPlayerZ')
    const postBrightnessLoc = gl.getUniformLocation(postProg, 'uBrightness')

    let animationId: number
    let lastSector      = ''
    let currentZ        = 0.0
    let lastTime        = 0.0
    let accumulatedTime = 0.0
    let lastDrawTime    = 0.0

    let frameCount  = 0
    let fpsLastTime = performance.now()

    const render = (time: number) => {
      animationId = requestAnimationFrame(render)

      // Honor the global MAX FRAME RATE cap (0 = uncapped). Skip the frame's
      // work without advancing lastTime, so motion stays frame-rate independent.
      const maxFps     = settingsRef.current.maxFrameRate
      const msPerFrame = maxFps > 0 ? 1000.0 / maxFps : 0.0
      if (msPerFrame > 0.0 && time - lastDrawTime < msPerFrame)
        return
      lastDrawTime = time

      if (lastTime === 0.0)
        lastTime = time

      const dt = Math.min((time - lastTime) * 0.001, 0.1)
      lastTime = time

      const currentSettings = settingsRef.current
      const speedMultiplier = currentSettings.speed

      // Count frames to evaluate FPS
      frameCount++

      const now = performance.now()
      if (now - fpsLastTime >= 1000) {
        setFps(Math.round(frameCount * 1000 / (now - fpsLastTime)))
        frameCount = 0
        fpsLastTime = now
      }

      // Apply scaled dt for speed settings, adapting velocity in a frequency-safe manner
      const scaledDt = dt * speedMultiplier

      // Accumulate player Z based on frame-rate independent walk speed
      const speed = getWalkSpeed(currentZ)
      currentZ += speed * scaledDt

      if (audioEngineRef.current)
        audioEngineRef.current.updateState(currentZ)

      const state            = getKinematicState(currentZ)
      const currentIteration = state.loop

      // Transitions the decay update smoothly centered around 500-unit loop boundaries
      let smoothIteration = currentIteration
      const distFromBoundary = currentZ % 500.0
      if (distFromBoundary >= 480.0) {
        const t    = (distFromBoundary - 480.0) / 40.0
        const ease = 3.0 * t * t - 2.0 * t * t * t
        smoothIteration = currentIteration + ease
      }
      else if (distFromBoundary < 20.0) {
        const t    = (distFromBoundary + 20.0) / 40.0
        const ease = 3.0 * t * t - 2.0 * t * t * t
        smoothIteration = currentIteration - 1 + ease
      }

      const sector = state.name
      if (sector !== lastSector) {
        lastSector = sector
        setSectorName(sector)
        setGlitchKey(prev => prev + 1)
      }

      // Accumulate dynamic waves and light shader speed securely
      accumulatedTime += scaledDt

      const iTime = accumulatedTime

      // --- PASS 1: Raymarch to FBO ---
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      gl.viewport(0, 0, canvas.width, canvas.height)

      gl.useProgram(sceneProg)

      const posLoc1 = gl.getAttribLocation(sceneProg, 'position')
      gl.enableVertexAttribArray(posLoc1)
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer)
      gl.vertexAttribPointer(posLoc1, 2, gl.FLOAT, false, 0, 0)

      gl.uniform2f(sceneResLoc, canvas.width, canvas.height)
      gl.uniform1f(sceneTimeLoc, iTime)
      gl.uniform1f(sceneIterLoc, smoothIteration)
      gl.uniform2f(scenePointerLoc, pointerRef.current.x, pointerRef.current.y)
      gl.uniform1f(scenePlayerZLoc, currentZ)
      gl.uniform1f(sceneHeavyLoc, currentSettings.heavyEffects ? 1.0 : 0.0)

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

      // --- PASS 2: Post-Process to Screen ---
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, canvas.width, canvas.height)

      gl.useProgram(postProg)

      const posLoc2 = gl.getAttribLocation(postProg, 'position')
      gl.enableVertexAttribArray(posLoc2)
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer)
      gl.vertexAttribPointer(posLoc2, 2, gl.FLOAT, false, 0, 0)

      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.uniform1i(postTexLoc, 0)

      gl.uniform2f(postResLoc, canvas.width, canvas.height)
      gl.uniform1f(postTimeLoc, iTime)
      gl.uniform2f(postPointerLoc, pointerRef.current.x, pointerRef.current.y)
      gl.uniform1f(postIterLoc, smoothIteration)
      gl.uniform1f(postPlayerZLoc, currentZ)
      if (postBrightnessLoc)
        gl.uniform1f(postBrightnessLoc, currentSettings.brightness)

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }

    animationId = requestAnimationFrame(render)

    return () => {
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', handlePointerMove)
      cancelAnimationFrame(animationId)

      if (audioEngineRef.current) {
        audioEngineRef.current.destroy()
        audioEngineRef.current = null
      }

      gl.deleteBuffer(quadBuffer)
      gl.deleteTexture(tex)
      gl.deleteFramebuffer(fbo)
      gl.deleteProgram(sceneProg)
      gl.deleteProgram(postProg)
    }
  }, [])

  return <main id="app-container">
    <canvas id="gl-canvas" ref={ canvasRef } />
    <section id="crt-overlay" />
    <Link id="back-btn" href="/">← INDEX</Link>

    <header key={ glitchKey } id="sector-title" data-text={ sectorName }>
      {sectorName}
    </header>

    <button id="fullscreen-btn" onClick={ handleFullscreenToggle }>FULLSCREEN</button>

    <button id="audio-btn" onClick={ handleAudioToggle }>
      {isMuted ? 'UNMUTE AUDIO' : 'MUTE AUDIO'}
    </button>

    <button id="settings-btn" onClick={ () => setIsSettingsOpen(true) } title="Settings" aria-label="Open graphics settings">
      <SettingsIcon size={ 16 } />
    </button>

    <aside id="fps-display">{renderRes.w}×{renderRes.h} · {fps} FPS</aside>

    <SettingsView
      isOpen={ isSettingsOpen }
      onClose={ () => setIsSettingsOpen(false) }
      settings={ settings }
      onChange={ setSettings } />
  </main>
}
