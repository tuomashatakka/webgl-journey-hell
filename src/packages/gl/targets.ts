// Off-screen targets: colour formats, textures, framebuffers, MSAA, and the
// scene → resolve → bloom chain both rasterized journeys render through.
//
// Every renderer here used to allocate these by hand, each with its own idea of
// the fallback when half-float targets are missing. The policy lives here now:
// RGBA16F where EXT_color_buffer_float exists, RGBA8 everywhere else, and MSAA
// clamped to what the device reports for the chosen format.

import type { AnyGl } from './context'
import { isWebGL2 } from './context'


export interface ColorFormat {
  internal: number;
  format:   number;
  type:     number;

  /** True when this is a half-float format (values above 1 survive). */
  hdr: boolean;
}

interface TextureOptions {
  filter?: number;
  wrap?:   number;

  /** Allocate the full mip chain (texStorage2D) so generateMipmap can fill it. */
  mips?: boolean;
}

export interface RenderTarget {
  readonly fbo:    WebGLFramebuffer;
  readonly tex:    WebGLTexture;
  readonly width:  number;
  readonly height: number;

  /** Bind for drawing and set the viewport to cover it. */
  bind(): void;
  dispose(): void;
}

export interface RenderTargetOptions extends TextureOptions {

  /** Attach a 24-bit depth renderbuffer (WebGL 2) / 16-bit (WebGL 1). */
  depth?: boolean;
}

interface MsaaTarget {
  readonly fbo:     WebGLFramebuffer;
  readonly samples: number;
  readonly width:   number;
  readonly height:  number;
  bind(): void;

  /** Resolve the colour into `target` by blit. */
  resolveTo(target: RenderTarget): void;
  dispose(): void;
}

export interface PostChainOptions {

  /** Prefer a half-float scene (falls back to RGBA8 when unsupported). */
  hdr?: boolean;

  /** MSAA samples for the scene pass; 0 renders straight into the resolve target. */
  msaa?: number;

  /** How many half-resolution bloom levels to build under the scene. */
  bloomLevels?: number;
}

/**
 * The rasterizer's frame: draw the scene into `bindScene()` (multisampled when
 * the device and the quality tier allow), `resolve()`, then read `scene.tex`
 * and walk `bloom` down and back up. Reallocates only when the size or the
 * options actually change, so calling `resize` every frame is free.
 */
export interface PostChain {
  readonly format: ColorFormat;
  readonly width:  number;
  readonly height: number;

  /** Samples actually in use (0 when MSAA is off or unsupported). */
  readonly samples: number;

  /** The resolved scene colour. */
  readonly scene: RenderTarget;

  /** Each half the size of the one before; [0] is half the scene. */
  readonly bloom: readonly RenderTarget[];

  /** Returns true when anything was reallocated. */
  resize(width: number, height: number, opts?: PostChainOptions): boolean;
  bindScene(): void;
  resolve(): void;
  dispose(): void;
}

/** Plain 8-bit RGBA: renderable and filterable everywhere. */
export function rgba8 (gl: AnyGl): ColorFormat {
  return {
    internal: isWebGL2(gl) ? gl.RGBA8 : gl.RGBA,
    format:   gl.RGBA,
    type:     gl.UNSIGNED_BYTE,
    hdr:      false,
  }
}

/**
 * The best colour format a scene can render into: RGBA16F where the context
 * can render to it, RGBA8 otherwise. Callers check `hdr` to decide whether to
 * encode (Reinhard) values above one into the 8-bit fallback.
 */
export function sceneFormat (gl: WebGL2RenderingContext, preferHdr = true): ColorFormat {
  if (preferHdr && gl.getExtension('EXT_color_buffer_float')) {
    gl.getExtension('OES_texture_float_linear')
    return { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT, hdr: true }
  }
  return rgba8(gl)
}

/** How many mip levels a w × h texture has. */
function mipLevels (w: number, h: number): number {
  return Math.floor(Math.log2(Math.max(w, h))) + 1
}

/** An empty 2D texture of `fmt`, with sampling state set. */
function createTexture (gl: AnyGl, w: number, h: number, fmt: ColorFormat, opts: TextureOptions = {}): WebGLTexture {
  const tex    = gl.createTexture()!
  const filter = opts.filter ?? gl.LINEAR
  const wrap   = opts.wrap ?? gl.CLAMP_TO_EDGE
  gl.bindTexture(gl.TEXTURE_2D, tex)
  if (opts.mips && isWebGL2(gl)) {
    gl.texStorage2D(gl.TEXTURE_2D, mipLevels(w, h), fmt.internal, w, h)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
  }
  else {
    gl.texImage2D(gl.TEXTURE_2D, 0, fmt.internal, w, h, 0, fmt.format, fmt.type, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
  }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap)
  return tex
}

/** A texture-backed framebuffer of `fmt`. */
export function createRenderTarget (
  gl: AnyGl,
  width: number,
  height: number,
  fmt: ColorFormat,
  opts: RenderTargetOptions = {},
): RenderTarget {
  const tex = createTexture(gl, width, height, fmt, opts)
  const fbo = gl.createFramebuffer()!
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)

  let depth: WebGLRenderbuffer | null = null
  if (opts.depth) {
    depth = gl.createRenderbuffer()
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth)
    gl.renderbufferStorage(gl.RENDERBUFFER, isWebGL2(gl) ? gl.DEPTH_COMPONENT24 : gl.DEPTH_COMPONENT16, width, height)
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth)
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)

  return {
    fbo,
    tex,
    width,
    height,
    bind () {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      gl.viewport(0, 0, width, height)
    },
    dispose () {
      gl.deleteFramebuffer(fbo)
      gl.deleteTexture(tex)
      if (depth)
        gl.deleteRenderbuffer(depth)
    },
  }
}

/** The most MSAA samples `fmt` supports as a renderbuffer on this device. */
function maxSamples (gl: WebGL2RenderingContext, fmt: ColorFormat): number {
  if (fmt.hdr) {
    const s = gl.getInternalformatParameter(gl.RENDERBUFFER, fmt.internal, gl.SAMPLES) as Int32Array | null
    return s && s.length ? Math.max(0, ...Array.from(s)) : 0
  }
  return gl.getParameter(gl.MAX_SAMPLES) as number
}

/** A multisampled colour (+ depth) renderbuffer target. */
function createMsaaTarget (
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  fmt: ColorFormat,
  samples: number,
  depth = true,
): MsaaTarget {
  const color = gl.createRenderbuffer()
  gl.bindRenderbuffer(gl.RENDERBUFFER, color)
  gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, fmt.internal, width, height)

  let depthRb: WebGLRenderbuffer | null = null
  if (depth) {
    depthRb = gl.createRenderbuffer()
    gl.bindRenderbuffer(gl.RENDERBUFFER, depthRb)
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, width, height)
  }

  const fbo = gl.createFramebuffer()!
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color)
  if (depthRb)
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthRb)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)

  return {
    fbo,
    samples,
    width,
    height,
    bind () {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      gl.viewport(0, 0, width, height)
    },
    resolveTo (target) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fbo)
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, target.fbo)
      gl.blitFramebuffer(0, 0, width, height, 0, 0, target.width, target.height, gl.COLOR_BUFFER_BIT, gl.NEAREST)
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null)
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null)
    },
    dispose () {
      gl.deleteFramebuffer(fbo)
      gl.deleteRenderbuffer(color)
      if (depthRb)
        gl.deleteRenderbuffer(depthRb)
    },
  }
}

export function createPostChain (gl: WebGL2RenderingContext, initial: PostChainOptions = {}): PostChain {
  let opts: Required<PostChainOptions> = { hdr: true, msaa: 4, bloomLevels: 5, ...initial }
  let format                           = sceneFormat(gl, opts.hdr)

  let width                      = 0
  let height                     = 0
  let samples                    = 0
  let msaa: MsaaTarget | null    = null
  let scene: RenderTarget | null = null
  const bloom: RenderTarget[]      = []

  const release = () => {
    msaa?.dispose()
    scene?.dispose()
    bloom.forEach(b => b.dispose())
    msaa         = null
    scene        = null
    bloom.length = 0
  }

  const chain: PostChain = {
    get format () {
      return format
    },
    get width () {
      return width
    },
    get height () {
      return height
    },
    get samples () {
      return samples
    },
    get scene () {
      return scene!
    },
    get bloom () {
      return bloom
    },

    resize (w, h, next) {
      const merged = next ? { ...opts, ...next } : opts
      const same   = w === width && h === height &&
        merged.hdr === opts.hdr && merged.msaa === opts.msaa && merged.bloomLevels === opts.bloomLevels
      if (same && scene)
        return false

      release()
      if (merged.hdr !== opts.hdr)
        format = sceneFormat(gl, merged.hdr)
      opts   = merged
      width  = w
      height = h

      samples = Math.min(Math.max(0, opts.msaa), maxSamples(gl, format))
      if (samples > 1)
        msaa = createMsaaTarget(gl, w, h, format, samples)
      else
        samples = 0

      // Without MSAA the scene is drawn straight into the resolve target,
      // which then needs the depth buffer the multisampled one would have had.
      scene = createRenderTarget(gl, w, h, format, { depth: samples === 0 })

      let bw = w
      let bh = h
      for (let i = 0; i < opts.bloomLevels; i++) {
        bw = Math.max(1, bw >> 1)
        bh = Math.max(1, bh >> 1)
        bloom.push(createRenderTarget(gl, bw, bh, format))
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      return true
    },

    bindScene () {
      if (msaa)
        msaa.bind()
      else
        scene!.bind()
    },

    resolve () {
      if (msaa && scene)
        msaa.resolveTo(scene)
    },

    dispose: release,
  }
  return chain
}
