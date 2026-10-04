// Image textures that arrive asynchronously, with a placeholder until they do.

import type { AnyGl } from './context'


/** Resolve once `url` has decoded; reject with the url on failure. */
function loadImage (url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img       = new Image()
    img.crossOrigin = 'anonymous'
    img.decoding    = 'async'
    img.onload      = () => resolve(img)
    img.onerror     = () => reject(new Error(`image failed to load: ${url}`))
    img.src         = url
  })
}

export interface ImageTexture {
  readonly tex: WebGLTexture;

  /** False until the image has uploaded (the placeholder is bound until then). */
  loaded(): boolean;
  dispose(): void;
}

export interface ImageTextureOptions {

  /** RGB of the 1×1 placeholder bound while the image loads. */
  placeholder?: [ number, number, number ];
  wrapS?:       number;
  wrapT?:       number;
  mipmaps?:     boolean;
}

/**
 * A texture that shows `placeholder` until `url` has loaded, then the image.
 * Defaults suit an equirectangular environment: repeat across longitude,
 * clamp at the poles, trilinear.
 */
export function loadImageTexture (gl: AnyGl, url: string, opts: ImageTextureOptions = {}): ImageTexture {
  const tex         = gl.createTexture()!
  const [ r, g, b ] = opts.placeholder ?? [ 40, 44, 52 ]
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([ r, g, b ]))
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

  let loaded   = false
  let disposed = false

  loadImage(url).then(img => {
    if (disposed || gl.isContextLost())
      return
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, opts.wrapS ?? gl.REPEAT)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, opts.wrapT ?? gl.CLAMP_TO_EDGE)
    if (opts.mipmaps ?? true) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
      gl.generateMipmap(gl.TEXTURE_2D)
    }
    loaded = true
  }, err => console.error('[texture]', String(err)))

  return {
    tex,
    loaded: () => loaded,
    dispose () {
      disposed = true
      gl.deleteTexture(tex)
    },
  }
}
