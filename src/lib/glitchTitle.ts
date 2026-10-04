// The title card every journey opens on: the name fades up out of black, holds,
// and then the signal carrying it fails — the picture tears into displaced
// bands, the channels separate, and the bytes themselves go bad — and what is
// left underneath is the journey, already running.
//
// Drawn on a 2D canvas over the journey's own, so it works identically over
// every renderer. "Byte corruption" is literal: the clean title is rendered
// once, its RGBA bytes are copied with offsets that are not multiples of four
// (so channels rotate into each other), runs of them are smeared and bits are
// flipped, and the results are kept as images. They are built one per idle
// frame while the title holds, so nothing in the card ever stalls a frame;
// the tear-out then draws displaced slices from them.

import { clamp01, smoothstep } from './math'
import { mulberry32 } from './rng'
import { spacedText, spacedWidth } from './canvasText'


export interface GlitchTitleOptions {
  title:     string;
  subtitle?: string;

  /** Accent colour, for the hairline and the chromatic fringe. */
  accent: string;

  /** A plain fade, no glitching (prefers-reduced-motion). */
  calm?: boolean;
}

export interface GlitchTitle {

  /** Draw the card at `t` seconds. False once it has finished. */
  draw(t: number): boolean;

  /** Jump straight to the tear-out (the viewer tapped). */
  skip(t: number): void;

  /** Match the overlay's backing store to its CSS box. */
  resize(width: number, height: number): void;
}

/** Seconds: fade in until IN, hold until HOLD, torn out by OUT. */
const IN   = 1.15
const HOLD = 2.75
const OUT  = 4.0

const CALM_IN   = 0.8
const CALM_HOLD = 2.2
const CALM_OUT  = 3.0

/** Byte-corrupted variants, from barely damaged to wrecked. */
const VARIANTS = 6

/** The glitch picks a new pattern this many times a second, like a frame rate. */
const GLITCH_FPS = 24

interface Layers {
  base:   HTMLCanvasElement;
  red:    HTMLCanvasElement;
  cyan:   HTMLCanvasElement;
  broken: HTMLCanvasElement[];

  /** The rows the text occupies, for aiming the damage. */
  top:    number;
  bottom: number;
}

function canvasOf (w: number, h: number): HTMLCanvasElement {
  const c  = document.createElement('canvas')
  c.width  = Math.max(1, w)
  c.height = Math.max(1, h)
  return c
}

/**
 * The largest size, at most `size`, at which `text` (letter-spaced by
 * `spacingRatio` of the size) fits `maxWidth`. Width is linear in size, so one
 * measurement settles it.
 */
function fitSize (ctx: CanvasRenderingContext2D, font: (px: number) => string, text: string, size: number, spacingRatio: number, maxWidth: number): number {
  ctx.font    = font(size)

  const width = spacedWidth(ctx, text, size * spacingRatio)
  return width > maxWidth ? size * maxWidth / width : size
}

/** Split `text` into two lines at the word boundary nearest its middle. */
function twoLines (text: string): [ string, string ] {
  const words = text.split(' ')
  let best    = 1
  let bestGap = Infinity
  for (let i = 1; i < words.length; i++) {
    const gap = Math.abs(words.slice(0, i).join(' ').length - words.slice(i).join(' ').length)
    if (gap < bestGap) {
      bestGap = gap
      best    = i
    }
  }
  return [ words.slice(0, best).join(' '), words.slice(best).join(' ') ]
}

/** A copy of `src` in one flat colour (its alpha kept). */
function tinted (src: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const c   = canvasOf(src.width, src.height)
  const ctx = c.getContext('2d')!
  ctx.drawImage(src, 0, 0)
  ctx.globalCompositeOperation = 'source-in'
  ctx.fillStyle                = color
  ctx.fillRect(0, 0, c.width, c.height)
  return c
}

/**
 * Wreck the bytes of the title's band. `amount` 0..1. Every operation works on
 * raw RGBA bytes, which is the point: copies at offsets that are not multiples
 * of four shift red into green into blue, and a smeared run repeats a row's
 * bytes across the next ones the way a stalled decoder does.
 */
function corrupt (src: HTMLCanvasElement, top: number, bottom: number, amount: number, seed: number): HTMLCanvasElement {
  const out = canvasOf(src.width, src.height)
  const ctx = out.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(src, 0, 0)

  const y0   = Math.max(0, Math.floor(top))
  const rows = Math.max(1, Math.min(src.height, Math.ceil(bottom)) - y0)
  const img  = ctx.getImageData(0, y0, src.width, rows)
  const d    = img.data
  const n    = d.length
  const rnd  = mulberry32(seed)
  const row  = src.width * 4

  // Channel rotation: copy runs of bytes forward by an offset that is not a
  // multiple of four.
  const shifts = Math.floor(3 + amount * 26)
  for (let i = 0; i < shifts; i++) {
    const len  = Math.floor(row * (0.2 + rnd() * 2.5 * amount))
    const from = Math.floor(rnd() * Math.max(1, n - len))
    const off  = (Math.floor(rnd() * 40) * 4 + 1 + Math.floor(rnd() * 3)) * (rnd() < 0.5 ? -1 : 1)
    const to   = Math.min(Math.max(0, from + off), n - len)
    d.copyWithin(to, from, from + len)
  }

  // Smears: one row's bytes repeated down a band.
  const smears = Math.floor(amount * 7)
  for (let i = 0; i < smears; i++) {
    const r0   = Math.floor(rnd() * rows)
    const span = Math.floor(2 + rnd() * rows * 0.25 * amount)
    const x0   = Math.floor(rnd() * src.width * 0.6) * 4
    const w    = Math.floor(src.width * (0.2 + rnd() * 0.5)) * 4
    const from = r0 * row + x0
    for (let r = 1; r < span && r0 + r < rows; r++)
      d.copyWithin((r0 + r) * row + x0, from, Math.min(from + w, (r0 + 1) * row))
  }

  // Bit flips, in bursts.
  const flips = Math.floor(amount * amount * 1800)
  for (let i = 0; i < flips; i++) {
    const at = Math.floor(rnd() * n)
    d[at] ^= 1 << Math.floor(4 + rnd() * 4)
  }

  // Macroblocks: 8×8 squares posterised to their corner, as a codec that has
  // lost its residuals would draw them.
  const blocks = Math.floor(amount * 40)
  for (let i = 0; i < blocks; i++) {
    const bx = Math.floor(rnd() * (src.width / 8)) * 8
    const by = Math.floor(rnd() * Math.max(1, rows / 8)) * 8
    const c0 = (by * src.width + bx) * 4
    for (let y = 0; y < 8 && by + y < rows; y++)
      for (let x = 0; x < 8 && bx + x < src.width; x++) {
        const k  = ((by + y) * src.width + bx + x) * 4
        d[k]     = d[c0]
        d[k + 1] = d[c0 + 1]
        d[k + 2] = d[c0 + 2]
        d[k + 3] = d[c0 + 3]
      }
  }

  ctx.putImageData(img, 0, y0)
  return out
}

export function createGlitchTitle (canvas: HTMLCanvasElement, opts: GlitchTitleOptions): GlitchTitle {
  const ctx   = canvas.getContext('2d')!
  const tIn   = opts.calm ? CALM_IN : IN
  const tHold = opts.calm ? CALM_HOLD : HOLD
  let tOut                  = opts.calm ? CALM_OUT : OUT
  let outStart              = tHold
  let layers: Layers | null = null

  const build = (w: number, h: number): Layers => {
    const base  = canvasOf(w, h)
    const b     = base.getContext('2d')!
    const maxW  = w * 0.88
    const title = opts.title.toUpperCase()
    const head  = (px: number) => `700 ${px}px "Arial Narrow", "Helvetica Neue", Helvetica, Arial, sans-serif`
    const body  = (px: number) => `400 ${px}px "Helvetica Neue", Helvetica, Arial, sans-serif`
    const size  = fitSize(b, head, title, Math.max(18, Math.min(w * 0.058, h * 0.11)), 0.32, maxW)
    const midY  = h * 0.5

    b.fillStyle    = '#f4f4f4'
    b.textBaseline = 'middle'
    b.font         = head(size)
    spacedText(b, title, w / 2, midY, size * 0.32)

    let bottom = midY + size * 0.75
    if (opts.subtitle) {
      // A tagline that will not fit on one line at a readable size takes two.
      const text  = opts.subtitle.toUpperCase()
      const want  = Math.max(10, size * 0.26)
      const fit   = fitSize(b, body, text, want, 0.42, maxW)
      const lines = fit < want * 0.8 ? twoLines(text) : [ text ]
      const sub   = lines.length > 1
        ? Math.min(...lines.map(l => fitSize(b, body, l, want, 0.42, maxW)))
        : fit

      b.globalAlpha = 0.62
      b.font        = body(sub)
      lines.forEach((line, i) => spacedText(b, line, w / 2, midY + size * 1.15 + i * sub * 1.6, sub * 0.42))
      bottom = midY + size * 1.15 + (lines.length - 1) * sub * 1.6 + sub
      b.globalAlpha = 1
    }

    // The accent hairline under the name.
    b.fillStyle = opts.accent
    b.fillRect(w / 2 - size * 1.6, midY + size * 0.72, size * 3.2, Math.max(1, size * 0.04))

    return {
      base,
      red:    tinted(base, '#ff2050'),
      cyan:   tinted(base, '#00e5ff'),
      broken: [],
      top:    midY - size * 0.8,
      bottom,
    }
  }

  /** Amount of glitch at t: flickers on the way in, quiet on the hold, a ramp out. */
  const glitchAt = (t: number, rnd: () => number): number => {
    if (opts.calm)
      return 0
    if (t < tIn)
      return rnd() < 0.18 ? 0.15 + rnd() * 0.35 : 0
    if (t < outStart)
      return rnd() < 0.05 ? 0.12 : 0
    return 0.25 + 0.75 * smoothstep(outStart, tOut, t)
  }

  return {
    resize (w, h) {
      if (canvas.width === w && canvas.height === h && layers)
        return
      canvas.width  = Math.max(1, w)
      canvas.height = Math.max(1, h)
      layers        = build(canvas.width, canvas.height)
    },

    skip (t) {
      if (t < outStart) {
        outStart = Math.max(t, tIn * 0.5)
        tOut     = outStart + (OUT - HOLD) * 0.8
      }
    },

    draw (t) {
      if (!layers)
        return true

      const w = canvas.width
      const h = canvas.height
      ctx.clearRect(0, 0, w, h)
      if (t >= tOut)
        return false

      // Spread the corruption work over the hold, one variant per frame.
      if (!opts.calm && layers.broken.length < VARIANTS && t > 0.2) {
        const k = layers.broken.length
        layers.broken.push(corrupt(layers.base, layers.top, layers.bottom, (k + 1) / VARIANTS, 1013 + k * 7919))
      }

      const frame = Math.floor(t * GLITCH_FPS)
      const rnd   = mulberry32(frame * 2654435761 >>> 0)
      const out   = clamp01((t - outStart) / Math.max(0.01, tOut - outStart))
      const g     = glitchAt(t, rnd)

      // --- the black it all starts on -----------------------------------------
      // Fades plainly when calm; otherwise it is torn away in bands, the way a
      // picture rolls back in when a signal locks.
      if (opts.calm) {
        ctx.fillStyle = `rgba(0, 0, 0, ${1 - out})`
        ctx.fillRect(0, 0, w, h)
      }
      else if (out < 1) {
        ctx.fillStyle = `rgba(0, 0, 0, ${1 - out * out * 0.9})`
        ctx.fillRect(0, 0, w, h)

        const holes = Math.floor(out * 38)
        for (let i = 0; i < holes; i++) {
          const y  = rnd() * h
          const bh = 2 + rnd() * h * 0.08 * (0.3 + out)
          ctx.clearRect(0, y, w, bh)
        }
      }

      // --- the name -------------------------------------------------------------
      const alpha = opts.calm
        ? smoothstep(0, tIn, t) * (1 - out)
        : smoothstep(0, tIn, t) * (1 - smoothstep(0.55, 1, out))
      if (alpha <= 0.001)
        return true

      const src = g > 0.3 && layers.broken.length
        ? layers.broken[Math.min(layers.broken.length - 1, Math.floor(g * layers.broken.length))]
        : layers.base

      // Chromatic separation, wider as the glitch grows.
      const split     = g * w * 0.012
      ctx.globalAlpha = alpha
      if (split > 0.5) {
        ctx.globalCompositeOperation = 'lighter'
        ctx.drawImage(layers.red, -split, 0)
        ctx.drawImage(layers.cyan, split, 0)
        ctx.globalCompositeOperation = 'source-over'
      }
      ctx.drawImage(src, 0, 0)

      // Displacement: bands of the picture slid sideways.
      const bands = Math.floor(g * 16)
      for (let i = 0; i < bands; i++) {
        const y  = layers.top + rnd() * (layers.bottom - layers.top)
        const bh = 1 + rnd() * (layers.bottom - layers.top) * 0.18
        const dx = (rnd() - 0.5) * w * 0.16 * g
        ctx.clearRect(0, y, w, bh)
        ctx.drawImage(src, 0, y, w, bh, dx, y, w, bh)
      }

      // Late in the tear, whole rows of the name drop out.
      if (out > 0.45) {
        const drops = Math.floor((out - 0.45) * 30)
        for (let i = 0; i < drops; i++)
          ctx.clearRect(0, layers.top + rnd() * (layers.bottom - layers.top), w, 1 + rnd() * 6)
      }

      ctx.globalAlpha = 1
      return true
    },
  }
}
