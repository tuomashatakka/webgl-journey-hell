// The signal-loss caption, drawn to a 2D canvas so the CRT pass can swallow it.
//
// It is *not* DOM. A DOM overlay sits above the canvas, and lib/gl/crtPass works by
// reading the canvas back buffer and drawing over it — so anything in DOM ends up
// flat and square on top of a curved, torn, fringed picture, which gives the whole
// effect away in one frame. This is uploaded as a texture and composited inside
// the pass, before the curvature, so the tube treats it as part of the broadcast.
//
// Canvas2D rather than SDF text in GLSL because the content is a caption *and* a
// line graph, and one of those is genuinely unpleasant to write in a fragment
// shader.
//
// Nothing in here may call Math.random() or read a clock. Every mark is a
// function of the SignalLoss it is handed, because `?t=` has to redraw the same
// frame twice — see lib/signalLoss for why that constraint reaches this far.

import { CONFIG } from '@wjh/config/config'
import { dbAt, signalHash } from './signalLoss'
import type { SignalLoss } from './signalLoss'
import { spacedText } from '@wjh/web/canvasText'


export interface SignalOverlay {
  canvas: HTMLCanvasElement;

  /**
   * Redraw for this state at this backing-store size. Returns false when nothing
   * has changed and the texture does not need re-uploading.
   */
  update(loss: SignalLoss, w: number, h: number): boolean;

  dispose(): void;
}

/** The warning triangle, as a path. A glyph would depend on the host's fonts. */
function warningTriangle (ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const h = r * 1.72

  ctx.beginPath()
  ctx.moveTo(cx, cy - h * 0.5)
  ctx.lineTo(cx + r, cy + h * 0.5)
  ctx.lineTo(cx - r, cy + h * 0.5)
  ctx.closePath()
  ctx.lineWidth = Math.max(1, r * 0.12)
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(cx, cy - h * 0.1)
  ctx.lineTo(cx, cy + h * 0.2)
  ctx.lineWidth = Math.max(1, r * 0.15)
  ctx.stroke()

  ctx.beginPath()
  ctx.arc(cx, cy + h * 0.33, Math.max(1, r * 0.085), 0, Math.PI * 2)
  ctx.fill()
}

function drawMeter (
  ctx: CanvasRenderingContext2D,
  loss: SignalLoss,
  cx: number,
  top: number,
  w: number,
  h: number,
  u: number,
): void {
  const left = cx - w / 2
  const y    = (db: number) => top + h * (CONFIG.signal.overlay.dbTop - db) / (CONFIG.signal.overlay.dbTop - CONFIG.signal.overlay.dbBottom)

  ctx.strokeStyle = 'rgba(255,255,255,0.22)'
  ctx.lineWidth   = Math.max(1, u * 0.06)
  ctx.strokeRect(left, top, w, h)

  ctx.font         = `300 ${u * 1.5}px ${CONFIG.ui.typeface}`
  ctx.textAlign    = 'right'
  ctx.textBaseline = 'middle'

  for (const db of [ -12, -40, -68 ]) {
    const gy        = y(db)
    ctx.strokeStyle = 'rgba(255,255,255,0.10)'
    ctx.beginPath()
    ctx.moveTo(left, gy)
    ctx.lineTo(left + w, gy)
    ctx.stroke()

    ctx.fillStyle = 'rgba(255,255,255,0.42)'
    ctx.fillText(String(db), left - u * 0.7, gy)
  }

  // The trace is sampled, not remembered. A scrolling history buffer is the
  // obvious implementation and it cannot survive a seek: this asks dbAt() what
  // the reading *was* at each column's moment, so the same ?t= draws the same
  // graph however you arrived at it.
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'
  ctx.lineWidth   = Math.max(1, u * 0.09)
  ctx.beginPath()

  const cols = Math.max(2, Math.min(240, Math.round(w / Math.max(1, u * 0.28))))
  for (let i = 0; i < cols; i++) {
    const f  = i / (cols - 1)
    const at = loss.age - (1 - f) * CONFIG.signal.overlay.windowSeconds
    const gy = y(at <= 0 ? CONFIG.signal.overlay.dbTop - 1 : dbAt(at))
    const gx = left + w * f
    if (i === 0)
      ctx.moveTo(gx, gy); else
      ctx.lineTo(gx, gy)
  }
  ctx.stroke()

  ctx.font      = `300 ${u * 1.6}px ${CONFIG.ui.typeface}`
  ctx.textAlign = 'left'
  ctx.fillStyle = 'rgba(255,255,255,0.62)'
  ctx.fillText('dB', left, top - u * 1.4)

  ctx.textAlign = 'right'
  ctx.fillStyle = 'rgba(255,255,255,0.90)'
  ctx.fillText(`${loss.db.toFixed(1)} dB`, left + w, top - u * 1.4)
}

export function createSignalOverlay (): SignalOverlay | null {
  if (typeof document === 'undefined')
    return null

  const canvas = document.createElement('canvas')
  const ctx    = canvas.getContext('2d')
  if (!ctx)
    return null

  let lastTick = -1
  let lastW    = 0
  let lastH    = 0

  return {
    canvas,

    update (loss, w, h) {
      if (w <= 0 || h <= 0)
        return false

      // The drawing surface is capped and the aspect preserved, so the caption
      // is the same size on screen whatever the resolution setting is doing.
      const dw = Math.min(CONFIG.signal.overlay.maxWidth, Math.max(64, Math.round(w)))
      const dh = Math.max(48, Math.round(dw * h / w))

      const tick = Math.floor(loss.age * CONFIG.signal.overlay.tickHz)
      if (tick === lastTick && dw === lastW && dh === lastH)
        return false

      lastTick = tick
      lastW    = dw
      lastH    = dh
      if (canvas.width !== dw || canvas.height !== dh) {
        canvas.width  = dw
        canvas.height = dh
      }

      ctx.clearRect(0, 0, dw, dh)
      if (loss.level <= 0.001)
        return true

      const u  = dh / 100 // one layout unit, so nothing is authored in pixels
      const cx = dw / 2
      const cy = dh * 0.42

      // The caption struggles rather than sitting there: it fades up with the
      // loss and then flickers on the same twelve-a-second tick everything else
      // moves on, hash-gated so it drops out at random rather than pulsing.
      const settle    = Math.min(1, loss.age / 2.5)
      const flick     = signalHash(tick * 3.7) < 0.12 ? 0.55 : 1
      ctx.globalAlpha = Math.min(1, 0.25 + loss.level) * settle * flick

      ctx.strokeStyle = 'rgba(255,255,255,0.92)'
      ctx.fillStyle   = 'rgba(255,255,255,0.92)'
      warningTriangle(ctx, cx, cy - u * 12, u * 6.4)

      ctx.font         = `300 ${u * 5.2}px ${CONFIG.ui.typeface}`
      ctx.textAlign    = 'left'
      ctx.textBaseline = 'alphabetic'
      ctx.fillStyle    = 'rgba(255,255,255,0.94)'
      spacedText(ctx, 'SIGNAL LOSS', cx, cy + u * 2.2, u * 1.5)

      if (loss.meter > 0.001) {
        ctx.globalAlpha *= loss.meter
        drawMeter(ctx, loss, cx, cy + u * 10, u * 46, u * 22, u)
      }

      ctx.globalAlpha = 1
      return true
    },

    dispose () {
      canvas.width  = 0
      canvas.height = 0
    },
  }
}
