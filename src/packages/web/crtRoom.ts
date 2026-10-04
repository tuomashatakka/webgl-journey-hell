// The index page's room: a CRT tuned to one journey's preview at a time, in a
// dark room of dead machines (the picture in ./crtRoomShader).
//
// Framework-free. The React side (hooks/use-crt-room) owns the canvas, the
// frame loop and the buttons; this owns the context, the channels' programs,
// the picture they draw into, and the three moves a viewer can make: change
// the channel (a burst of snow), open the menu (the picture dims under it),
// and go in (a dolly into the tube while the picture fails, then `onDone`).
//
// The HTML laid over the tube face is placed with screenRect(), which
// projects the face with the same camera the shader uses.

import { CONFIG } from '@wjh/config/config'

import { clamp01, smoothstep } from '@wjh/math/scalar'

import { createGlProgram } from '@wjh/gl/program'

import type { GlProgram } from '@wjh/gl/program'

import { QUAD_VS_100, createFullscreenQuad } from '@wjh/gl/quad'

import type { FullscreenQuad } from '@wjh/gl/quad'

import { createRenderTarget, rgba8 } from '@wjh/gl/targets'

import type { RenderTarget } from '@wjh/gl/targets'

import { ROOM_FRAG } from './crtRoomShader'

// The camera and the tube, as in the shader.
const SCREEN_C: V3   = [ 0, 0.7, -0.335 ]

const SCREEN_H       = [ 0.3, 0.225 ]

const CAM_TARGET: V3 = [ 0, 0.86, 0 ]

const CAM_HEIGHT     = 0.95

const FOCAL          = 1.65

const FACE_Z         = SCREEN_C[2] - 0.02

/** Words cut short, for the dead monitors — the ends of journeys' names. */
const GLYPHS = [ 'Po', 'ma', 'res', 'and', 'oin', 'LOOP', 'sta', 'VOID', '∂t', 'hel', 'fall', 'Sky', 'rou', 'orc', 'nat', '∞' ]

/** A channel: the journey's self-driving preview shader and its accent colour. */
export interface CrtChannel {
  preview: string;
  accent:  string;
}

/** The tube face's box in CSS pixels, relative to the canvas. */
export interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CrtRoom {

  /** Change channel: snow, then the new picture. */
  tune(index: number): void;
  setMenu(open: boolean): void;

  /** Dolly into the tube while the picture fails; `onDone` once it has. */
  zoom(onDone: () => void): void;
  frame(dt: number): void;

  /** Match the backing store to the canvas's CSS box. */
  resize(cssWidth: number, cssHeight: number, scale: number): void;
  screenRect(): ScreenRect;
  dispose(): void;
}

type V3 = [ number, number, number ]

interface Moves {
  time:    number;
  channel: number;
  snow:    number;
  menu:    number;
  menuTo:  number;
  zoom:    number;
  onDone:  (() => void) | null;
}

interface Gpu {
  gl:       WebGLRenderingContext;
  room:     GlProgram;
  quad:     FullscreenQuad;
  picture:  RenderTarget;
  glyphs:   WebGLTexture | null;
  channels: Map<number, GlProgram | null>;
}

const sub   = (a: V3, b: V3): V3 => [ a[0] - b[0], a[1] - b[1], a[2] - b[2] ]

const dot   = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

const cross = (a: V3, b: V3): V3 => [ a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0] ]

const unit  = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1
  return [ a[0] / l, a[1] / l, a[2] / l ]
}

/** Far enough back that the set fits a narrow screen's width. */
export function cameraDistance (aspect: number): number {
  return Math.max(2.7, FOCAL / Math.max(0.2, aspect))
}

/** The tube face, projected through the resting camera, in CSS pixels. */
function projectScreen (w: number, h: number): ScreenRect {
  const ro: V3 = [ 0, CAM_HEIGHT, -cameraDistance(w / h) ]
  const cw     = unit(sub(CAM_TARGET, ro))
  const cu     = unit(cross([ 0, 1, 0 ], cw))
  const cv     = cross(cw, cu)
  const pts    = [ -1, 1 ].flatMap(sx => [ -1, 1 ].map(sy => {
    const d = sub([ SCREEN_C[0] + sx * SCREEN_H[0], SCREEN_C[1] + sy * SCREEN_H[1], FACE_Z ], ro)
    const z = dot(d, cw)
    return [ w / 2 + FOCAL * dot(d, cu) / z * h, h / 2 - FOCAL * dot(d, cv) / z * h ]
  }))
  const xs = pts.map(p => p[0])
  const ys = pts.map(p => p[1])
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
}

/** A 4×4 atlas of the GLYPHS, green ink on black, as big as each cell allows and cut by it. */
function glyphAtlas (gl: WebGLRenderingContext): WebGLTexture | null {
  const c  = document.createElement('canvas')
  c.width  = 512
  c.height = 512

  const ctx = c.getContext('2d')
  if (!ctx)
    return null

  ctx.fillStyle    = '#000'
  ctx.fillRect(0, 0, 512, 512)
  ctx.fillStyle    = '#fff'
  ctx.textBaseline = 'middle'
  ctx.font         = '700 92px "Helvetica Neue", Helvetica, Arial, sans-serif'
  GLYPHS.forEach((word, i) => {
    const x = i % 4 * 128
    const y = Math.floor(i / 4) * 128
    ctx.save()
    ctx.beginPath()
    ctx.rect(x, y, 128, 128)
    ctx.clip()
    ctx.fillText(word, x + 8 - i % 3 * 18, y + 66)
    ctx.restore()
  })

  const tex = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return tex
}

function hexToRgb (hex: string): V3 {
  const n = Number.parseInt(hex.replace('#', '').padEnd(6, '0')
    .slice(0, 6), 16)
  return [ (n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255 ]
}

/** Move the room's clocks on by `dt`: the snow decays, the menu eases, the dolly runs. */
function advance (m: Moves, dt: number): void {
  const { index } = CONFIG
  m.time += dt
  m.snow  = Math.max(0, m.snow - dt * 1000 / index.staticMs)
  m.menu += (m.menuTo - m.menu) * Math.min(1, dt * 8)
  if (!m.onDone)
    return

  m.zoom += dt * 1000 / index.zoomMs
  if (m.zoom >= 1 + index.glitchHoldMs / index.zoomMs) {
    const done = m.onDone
    m.onDone   = null
    done()
  }
}

/** The tuned channel's preview, drawn into the picture texture. */
function drawPicture (g: Gpu, channels: CrtChannel[], m: Moves): void {
  if (!g.channels.has(m.channel))
    g.channels.set(m.channel, createGlProgram(g.gl, QUAD_VS_100, channels[m.channel].preview, 'crt-channel'))

  const prog = g.channels.get(m.channel)
  g.picture.bind()
  g.gl.clearColor(0, 0, 0, 1)
  g.gl.clear(g.gl.COLOR_BUFFER_BIT)
  if (!prog)
    return
  prog.use()
  prog.frame({ time: m.time, pointer: { x: 0, y: 0 }}, g.picture.width, g.picture.height)
  g.quad.draw()
}

function drawRoom (g: Gpu, channels: CrtChannel[], m: Moves): void {
  const { gl, room } = g
  const canvas       = gl.canvas as HTMLCanvasElement
  const glow         = hexToRgb(channels[m.channel].accent)
  const lit          = 0.55 * (1 - 0.5 * m.menu) * (1 - clamp01(m.zoom))
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.viewport(0, 0, canvas.width, canvas.height)
  room.use()
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, g.picture.tex)
  gl.activeTexture(gl.TEXTURE1)
  gl.bindTexture(gl.TEXTURE_2D, g.glyphs)
  room.uniform1i('uScreen', 0)
  room.uniform1i('uGlyphs', 1)
  room.uniform1f('uStatic', m.snow)
  room.uniform1f('uMenu', m.menu)
  room.uniform1f('uZoom', clamp01(m.zoom))
  room.uniform1f('uGlitch', smoothstep(0.45, 1, m.zoom))
  room.uniform1f('uCamDist', cameraDistance(canvas.clientWidth / Math.max(1, canvas.clientHeight)))
  room.uniform3f('uGlow', glow[0] * lit + m.snow * 0.3, glow[1] * lit + m.snow * 0.3, glow[2] * lit + m.snow * 0.3)
  room.frame({ time: m.time }, canvas.width, canvas.height)
  g.quad.draw()
}

function createGpu (canvas: HTMLCanvasElement): Gpu | null {
  const gl   = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false })
  const room = gl && createGlProgram(gl, QUAD_VS_100, ROOM_FRAG, 'crt-room')
  if (!gl || !room)
    return null

  const { pictureWidth, pictureHeight } = CONFIG.index
  return {
    gl,
    room,
    quad:     createFullscreenQuad(gl),
    picture:  createRenderTarget(gl, pictureWidth, pictureHeight, rgba8(gl)),
    glyphs:   glyphAtlas(gl),
    channels: new Map(),
  }
}

export function createCrtRoom (canvas: HTMLCanvasElement, channels: CrtChannel[]): CrtRoom | null {
  const g = createGpu(canvas)
  if (!g)
    return null

  const m: Moves = { time: 0, channel: 0, snow: 1, menu: 0, menuTo: 0, zoom: 0, onDone: null }

  return {
    tune (index) {
      m.channel = (index % channels.length + channels.length) % channels.length
      m.snow    = 1
    },
    setMenu (open) {
      m.menuTo = open ? 1 : 0
    },
    zoom (onDone) {
      m.zoom   = 0
      m.onDone = onDone
    },
    frame (dt) {
      advance(m, dt)
      drawPicture(g, channels, m)
      drawRoom(g, channels, m)
    },
    resize (cssWidth, cssHeight, scale) {
      const w = Math.max(1, Math.round(cssWidth * scale))
      const h = Math.max(1, Math.round(cssHeight * scale))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width  = w
        canvas.height = h
      }
    },
    screenRect: () => projectScreen(canvas.clientWidth, canvas.clientHeight),
    dispose () {
      g.channels.forEach(p => p?.dispose())
      g.room.dispose()
      g.quad.dispose()
      g.picture.dispose()
      g.gl.deleteTexture(g.glyphs)
    },
  }
}
