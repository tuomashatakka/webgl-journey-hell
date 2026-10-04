// The /assets page's renderer. One WebGL2 canvas sits behind the whole page and
// every card's preview is a scissored viewport on it: a page of two dozen
// previews with a context each would hit the browser's per-document limit long
// before the bottom of the page. A card only registers the box it wants drawn;
// the one frame loop walks the boxes that are on screen.

import { createGlProgram } from '@wjh/gl/program'
import { createMaterialArrays, createSkyTexture } from './gl'
import type { SkyTexture } from './gl'
import { MAP_MODES, FRAG, VERT } from './browserShader'
import { SKIES } from './manifest'


export interface AssetSlot {
  el:    HTMLElement;
  kind:  0 | 1;
  index: number;
}

export interface AssetView {
  mode:  string;
  light: string;
}

/** A card's preview box: what to draw into it. `kind` 0 a material sphere, 1 a sky pan. */
/** Resize the canvas backing store to the window at the given pixel ratio; returns its size. */
function fitCanvas (canvas: HTMLCanvasElement, dpr: number): [number, number] {
  const w = Math.round(window.innerWidth * dpr)
  const h = Math.round(window.innerHeight * dpr)
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width  = w
    canvas.height = h
  }
  return [ w, h ]
}

/** Draw every registered slot, every frame, until the returned stop is called. */
export function startAssetBrowser (
  canvas: HTMLCanvasElement, read: () => AssetView, slots: Map<string, AssetSlot>,
): (() => void) | null {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: false })
  if (!gl)
    return null

  const prog = createGlProgram(gl, VERT, FRAG)
  if (!prog)
    return null

  const materials = createMaterialArrays(gl)
  const skies     = new Map<string, SkyTexture>(SKIES.map(s => [ s.id, createSkyTexture(gl, s.id) ]))
  const quad      = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, quad)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([ -1, -1, 1, -1, -1, 1, 1, 1 ]), gl.STATIC_DRAW)

  let raf = 0
  const t0    = performance.now()
  const frame = () => {
    raf = requestAnimationFrame(frame)

    const dpr      = Math.min(1.5, window.devicePixelRatio || 1)
    const [ w, h ] = fitCanvas(canvas, dpr)
    gl.viewport(0, 0, w, h)
    gl.disable(gl.SCISSOR_TEST)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.enable(gl.SCISSOR_TEST)

    prog.use()
    materials.bind(gl, 0)
    prog.uniform1i('uMatColor', 0)
    prog.uniform1i('uMatNormal', 1)
    prog.uniform1i('uMatDetail', 2)
    prog.uniform1f('uTime', (performance.now() - t0) / 1000)
    prog.uniform1f('uMode', MAP_MODES.findIndex(m => m.id === read().mode))
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

    for (const slot of slots.values()) {
      const r = slot.el.getBoundingClientRect()
      if (r.bottom < 0 || r.top > window.innerHeight || r.width < 2)
        continue

      const x  = Math.round(r.left * dpr)
      const y  = Math.round((window.innerHeight - r.bottom) * dpr)
      const vw = Math.round(r.width * dpr)
      const vh = Math.round(r.height * dpr)
      gl.viewport(x, y, vw, vh)
      gl.scissor(x, y, vw, vh)

      const skyId = slot.kind === 1 ? SKIES[slot.index].id : read().light
      const sky   = skies.get(skyId)!
      sky.bind(gl, 3)
      prog.uniform1i('uSky', 3)
      prog.uniform1f('uSkyExposure', sky.exposure)
      prog.uniform3f('uSun', 0.6, 0.55, 0.58)
      prog.uniform1f('uKind', slot.kind)
      prog.uniform1f('uLayer', slot.index)
      prog.uniform2f('uSize', vw, vh)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }
  }
  raf = requestAnimationFrame(frame)

  return () => {
    cancelAnimationFrame(raf)
    gl.deleteBuffer(quad)
    materials.dispose(gl)
    skies.forEach(s => s.dispose(gl))
    prog.dispose()
  }
}
