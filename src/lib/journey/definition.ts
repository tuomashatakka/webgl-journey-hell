// A journey, declared once.
//
// Every route used to be a page that called one of three HOCs with its own
// options bag, and the dev harness kept a second, hand-maintained table of the
// same facts. Now each journey exports one definition (app/journeys/<slug>/
// journey.ts) and everything that runs a journey reads it: the page through
// the shell, the bare harness, the tools. Its title and accent come from the
// landing registry, so they are written in exactly one place too.

import type { AnyGl } from '../gl'
import { createShaderQuad } from '../gl'
import type { JourneyAudioEngine, JourneyMarks, JourneyRenderer, JourneySimulation } from './types'


/** How to get a context and build the renderer in it. */
export interface RendererSpec {
  context: 'webgl' | 'webgl2';

  /** Merged over the base attributes (no depth, no antialias, opaque). */
  attributes?: WebGLContextAttributes;

  /**
   * Built once per mount, after the context exists and before the first
   * resize. Null means "it could not be built": the shell leaves the canvas
   * blank rather than throwing, exactly as a failed compile always has.
   */
  create(gl: AnyGl, canvas: HTMLCanvasElement): JourneyRenderer | null;
}

export interface ShaderRendererOptions {

  /** Optional equirectangular environment map URL (sampled as `uEnv`). */
  envMapUrl?: string;
}

/**
 * One GLSL ES 1.00 fragment shader over a full-screen quad — the raymarched
 * path. WebGL 1, because asking for WebGL 2 would change what these shaders
 * compile against for no gain.
 */
export function shaderRenderer (fragment: string, options: ShaderRendererOptions = {}): RendererSpec {
  return {
    context: 'webgl',
    create:  gl => createShaderQuad(gl, fragment, { envUrl: options.envMapUrl }),
  }
}

/**
 * Actual triangles: WebGL 2 for vertex arrays, instancing and blitFramebuffer,
 * and a depth buffer, without which a rasterizer draws its rooms in submission
 * order. `antialias` stays off — the scene resolves its own MSAA target, so
 * multisampling the default framebuffer as well would be paid twice.
 */
export function geometryRenderer (create: (gl: WebGL2RenderingContext, canvas: HTMLCanvasElement) => JourneyRenderer | null): RendererSpec {
  return {
    context:    'webgl2',
    attributes: { depth: true },
    create:     (gl, canvas) => create(gl as WebGL2RenderingContext, canvas),
  }
}

/** A hand-built multi-pass renderer on WebGL 2 (raymarch into a target, then post). */
export function passRenderer (create: (gl: WebGL2RenderingContext, canvas: HTMLCanvasElement) => JourneyRenderer | null): RendererSpec {
  return {
    context: 'webgl2',
    create:  (gl, canvas) => create(gl as WebGL2RenderingContext, canvas),
  }
}

/** The same, on WebGL 1, for a pipeline written in GLSL ES 1.00. */
export function passRendererWebGL1 (create: (gl: AnyGl, canvas: HTMLCanvasElement) => JourneyRenderer | null): RendererSpec {
  return { context: 'webgl', create }
}

export interface JourneyDefinition {

  /** Route segment and folder name under app/journeys/; keys the registry. */
  slug: string;

  renderer: RendererSpec;

  /**
   * Per-mount CPU simulation. Instantiated on mount (never shared between
   * mounts, so remounting restarts the physics), stepped once per frame before
   * the draw, and disposed with the GL resources.
   */
  createSimulation?: () => JourneySimulation;

  /**
   * Per-mount audio engine. Built lazily on the first unmute (an AudioContext
   * may only start from a user gesture). Passing this is what renders the mute
   * button — journeys without a soundtrack never touch Web Audio.
   */
  createAudio?: () => JourneyAudioEngine;

  /**
   * Structural position for a journey whose motion is authored in GLSL and has
   * no simulation at all, as a pure function of time.
   */
  marksAt?: (time: number) => JourneyMarks;

  /** Section title for a journey with no simulation, from time. */
  sectionNameAt?: (time: number) => string;
}

/** Identity, for inference and for a greppable marker on every journey. */
export function defineJourney (definition: JourneyDefinition): JourneyDefinition {
  return definition
}
