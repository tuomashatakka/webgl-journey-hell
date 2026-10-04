// What every GL helper here accepts, and how to tell the two apart.
//
// The shell hands out WebGL 1 contexts to the single-pass shader journeys and
// WebGL 2 to everything that wants texture arrays, MSAA or VAOs, so the shared
// helpers take either and branch only where the APIs actually differ.

export type AnyGl = WebGLRenderingContext | WebGL2RenderingContext

export function isWebGL2 (gl: AnyGl): gl is WebGL2RenderingContext {
  return typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext
}

/** Defaults tuned for a full-screen raymarch: no depth, no MSAA, opaque. */
const BASE_CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  alpha:     false,
  antialias: false,
  depth:     false,
}

/**
 * Create a context of the asked-for type. `preserveDrawingBuffer` is the
 * caller's to decide: a screenshot driver needs it, and it costs a copy per
 * frame, so it is never part of the defaults.
 */
export function createContext (
  canvas: HTMLCanvasElement,
  type: 'webgl' | 'webgl2',
  attributes: WebGLContextAttributes = {},
): AnyGl | null {
  return canvas.getContext(type, { ...BASE_CONTEXT_ATTRIBUTES, ...attributes }) as AnyGl | null
}
