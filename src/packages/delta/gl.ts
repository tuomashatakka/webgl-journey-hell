// Δ/gl — getting the library onto a WebGL2 context.
//
// Loading is asynchronous and a renderer cannot wait for it, so every loader
// here returns immediately with a one-texel placeholder that is safe to sample
// (mid grey, flat, half rough, no relief) and swaps the real texture in when
// the image has decoded. `ready` is what the shell's frozen `?t=` path holds on
// (JourneyRenderer.ready), so a screenshot is never taken of the placeholder.
//
// Strips go through a 2D canvas on their way to texImage3D. texImage3D will
// take an <img> directly and slice it by UNPACK_IMAGE_HEIGHT, but how faithfully
// that path is implemented varies by browser, and getting it wrong is a garbled
// array rather than an error. getImageData is one well-trodden path everywhere,
// and JPEG has no alpha for the canvas to premultiply.

import { MATERIAL_SIZE, MATERIALS, skyAsset } from './manifest'
import { MATERIAL_URLS, SKY_URLS } from './urls'


async function decode (url: string): Promise<HTMLImageElement> {
  const img    = new Image()
  img.decoding = 'async'
  img.src      = url
  await img.decode()
  return img
}

function pixels (img: HTMLImageElement): Uint8Array {
  const canvas  = document.createElement('canvas')
  canvas.width  = img.naturalWidth
  canvas.height = img.naturalHeight

  const ctx     = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0)

  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
}

function anisotropy (gl: WebGL2RenderingContext): number {
  const ext = gl.getExtension('EXT_texture_filter_anisotropic')
  return ext ? Math.min(8, gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number) : 1
}

const ANISO = 0x84FE // TEXTURE_MAX_ANISOTROPY_EXT

function placeholderArray (
  gl: WebGL2RenderingContext, internal: number, texel: number[],
): WebGLTexture {
  const tex = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex)
  gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, internal, 1, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
                new Uint8Array(texel))
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  return tex
}

function uploadArray (
  gl: WebGL2RenderingContext, internal: number, data: Uint8Array, layers: number, aniso: number,
): WebGLTexture {
  const tex = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
  gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, internal, MATERIAL_SIZE, MATERIAL_SIZE, layers, 0,
                gl.RGBA, gl.UNSIGNED_BYTE, data)
  gl.generateMipmap(gl.TEXTURE_2D_ARRAY)
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT)
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT)
  if (aniso > 1)
    gl.texParameterf(gl.TEXTURE_2D_ARRAY, ANISO, aniso)
  return tex
}

export interface MaterialArrays {

  /** sRGB colour. */
  readonly color: WebGLTexture;

  /** Normal (GL convention) in RG, roughness in B. */
  readonly normal: WebGLTexture;

  /** Displacement in R, ambient occlusion in G, metalness in B. */
  readonly detail: WebGLTexture;
  readonly ready:  boolean;

  /** Bind the three arrays to `unit`, `unit + 1`, `unit + 2`. */
  bind(gl: WebGL2RenderingContext, unit: number): void;
  dispose(gl: WebGL2RenderingContext): void;
}

/** Start loading the material library. Returns at once with safe placeholders. */
export function createMaterialArrays (gl: WebGL2RenderingContext): MaterialArrays {
  const tex = {
    color:  placeholderArray(gl, gl.SRGB8_ALPHA8, [ 128, 124, 118, 255 ]),
    normal: placeholderArray(gl, gl.RGBA8, [ 128, 128, 140, 255 ]),
    detail: placeholderArray(gl, gl.RGBA8, [ 128, 255, 0, 255 ]),
  }
  let ready    = false
  let disposed = false

  const aniso = anisotropy(gl)
  Promise.all([ MATERIAL_URLS.color, MATERIAL_URLS.normal, MATERIAL_URLS.detail ].map(decode))
    .then(([ c, n, d ]) => {
      if (disposed || gl.isContextLost())
        return

      const layers = Math.min(MATERIALS.length, Math.floor(c.naturalHeight / c.naturalWidth))
      const next   = {
        color:  uploadArray(gl, gl.SRGB8_ALPHA8, pixels(c), layers, aniso),
        normal: uploadArray(gl, gl.RGBA8, pixels(n), layers, aniso),
        detail: uploadArray(gl, gl.RGBA8, pixels(d), layers, aniso),
      }
      gl.deleteTexture(tex.color)
      gl.deleteTexture(tex.normal)
      gl.deleteTexture(tex.detail)
      Object.assign(tex, next)
      ready = true
    })
    .catch(err => {
      console.error('[Δ] material strips failed to load; keeping placeholders', err)
      // Nothing better is coming, so do not hold a frozen frame forever.
      ready = true
    })

  return {
    get color () {
      return tex.color
    },
    get normal () {
      return tex.normal
    },
    get detail () {
      return tex.detail
    },
    get ready () {
      return ready
    },
    bind (g, unit) {
      g.activeTexture(g.TEXTURE0 + unit)
      g.bindTexture(g.TEXTURE_2D_ARRAY, tex.color)
      g.activeTexture(g.TEXTURE0 + unit + 1)
      g.bindTexture(g.TEXTURE_2D_ARRAY, tex.normal)
      g.activeTexture(g.TEXTURE0 + unit + 2)
      g.bindTexture(g.TEXTURE_2D_ARRAY, tex.detail)
    },
    dispose (g) {
      disposed = true
      g.deleteTexture(tex.color)
      g.deleteTexture(tex.normal)
      g.deleteTexture(tex.detail)
    },
  }
}

export interface SkyTexture {
  readonly id:       string;
  readonly texture:  WebGLTexture;
  readonly exposure: number;
  readonly ready:    boolean;
  bind(gl: WebGL2RenderingContext, unit: number): void;
  dispose(gl: WebGL2RenderingContext): void;
}

/**
 * One equirectangular sky, mipmapped. The mip chain is the cheap irradiance
 * map: sampling a high LOD along a normal is a blurred hemisphere, which is
 * what an overcast sky lights a wall with. REPEAT across, CLAMP down the poles.
 */
export function createSkyTexture (gl: WebGL2RenderingContext, id: string): SkyTexture {
  const asset  = skyAsset(id)
  let texture  = gl.createTexture()!
  let ready    = false
  let disposed = false

  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
                new Uint8Array([ 90, 96, 110, 255 ]))

  decode(SKY_URLS[asset.asset])
    .then(img => {
      if (disposed || gl.isContextLost())
        return

      const next = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, next)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, img)
      gl.generateMipmap(gl.TEXTURE_2D)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.deleteTexture(texture)
      texture = next
      ready   = true
    })
    .catch(err => {
      console.error(`[Δ] sky ${id} failed to load`, err)
      ready = true
    })

  return {
    id,
    exposure: asset.exposure,
    get texture () {
      return texture
    },
    get ready () {
      return ready
    },
    bind (g, unit) {
      g.activeTexture(g.TEXTURE0 + unit)
      g.bindTexture(g.TEXTURE_2D, texture)
    },
    dispose (g) {
      disposed = true
      g.deleteTexture(texture)
    },
  }
}
