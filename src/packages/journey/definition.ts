// A journey, declared once.
//
// Every route used to be a page that called one of three HOCs with its own
// options bag, and the dev harness kept a second, hand-maintained table of the
// same facts. Now each journey exports one definition (app/journeys/<slug>/
// journey.ts) and everything that runs a journey reads it: the page through
// the shell, the bare harness, the tools. Its title and accent come from the
// landing registry, so they are written in exactly one place too.

import type { AnyGl } from '@wjh/gl/context'
import { noteGlFailure, takeGlFailure } from '@wjh/gl/program'
import { createShaderQuad } from '@wjh/gl/shaderQuad'
import type { ShaderQuad } from '@wjh/gl/shaderQuad'
import { detectDevice } from '@wjh/quality/device'
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

  /**
   * Lighter builds of the same shader, heaviest first. Each is tried until one
   * links; if none does, the failure screen names every build and the GPU.
   */
  lite?: readonly string[];

  /**
   * Where in `lite` a phone starts. A phone compiler handed a big program can
   * take long enough that the browser resets the GPU, and then nothing after
   * it links either; so a phone starts where it is known to be safe.
   */
  mobileFrom?: number;

  /**
   * Named builds compiled only on `?diag=1`, to bisect a driver that rejects
   * the shader with no log: each is linked and released, and the failure
   * screen lists which linked and which did not. Nothing is drawn.
   */
  probe?: readonly (readonly [string, string])[];
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

/**
 * One GLSL ES 1.00 fragment shader over a full-screen quad — the raymarched
 * path. WebGL 1, because asking for WebGL 2 would change what these shaders
 * compile against for no gain.
 */
export function shaderRenderer (fragment: string, options: ShaderRendererOptions = {}): RendererSpec {
  return {
    context: 'webgl',
    create:  gl => {
      if (options.probe && diagnosing())
        return probeBuilds(gl, options.probe)

      const lite = options.lite ?? []
      if (lite.length === 0)
        return createShaderQuad(gl, fragment, { envUrl: options.envMapUrl })

      const builds = detectDevice().mobile ? lite.slice(options.mobileFrom ?? 0) : [ fragment, ...lite ]
      return firstThatLinks(gl, builds, options.envMapUrl)
    },
  }
}

function diagnosing (): boolean {
  return typeof location !== 'undefined' && new URLSearchParams(location.search).get('diag') === '1'
}

/** Link every probe build and report each; never a renderer. */
function probeBuilds (gl: AnyGl, probe: readonly (readonly [string, string])[]): null {
  const results = probe.map(([ name, source ]) => {
    const quad = createShaderQuad(gl, source, { tag: name })
    quad?.dispose()
    takeGlFailure()
    return `${name} ${quad ? 'OK' : gl.isContextLost() ? 'LOST' : 'FAIL'}`
  })
  noteGlFailure(`diag: ${results.join(' · ')} · ${gpuName(gl)}`)
  return null
}

/**
 * The first build that links, from the first one not already known to take
 * this device's GPU down. A build that fails with the context lost has done
 * exactly that: nothing more can link until the context comes back, and when
 * it does (the engine rebuilds on restore) the chain must start past it, or it
 * loses the context again, forever. Remembered across reloads too, because a
 * browser that loses a context to the same page twice may block WebGL on it.
 */
function firstThatLinks (gl: AnyGl, builds: readonly string[], envUrl?: string): ShaderQuad | null {
  const key                = `wjh.gl.from.${builds.map(b => b.length).join('.')}`
  const failures: string[] = []
  for (let i = recall(key); i < builds.length; i++) {
    const quad = createShaderQuad(gl, builds[i], { envUrl, tag: `build ${i + 1}/${builds.length}` })
    if (quad)
      return quad
    failures.push(takeGlFailure() ?? `build ${i + 1}/${builds.length} failed`)
    if (gl.isContextLost()) {
      remember(key, i + 1)
      failures.push('context lost')
      break
    }
  }
  noteGlFailure(`${failures.join(' · ')} · ${gpuName(gl)}`)
  return null
}

function recall (key: string): number {
  try {
    return Number(localStorage.getItem(key)) || 0
  }
  catch {
    return 0
  }
}

function remember (key: string, from: number): void {
  try {
    localStorage.setItem(key, String(from))
  }
  catch {
    // private mode: the next reload will find out again
  }
}

/** What the GPU calls itself, where the browser will say. */
function gpuName (gl: AnyGl): string {
  const ext = gl.getExtension('WEBGL_debug_renderer_info')
  if (gl.isContextLost())
    return 'GPU unknown (context lost)'
  return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER))
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

/** Identity, for inference and for a greppable marker on every journey. */
export function defineJourney (definition: JourneyDefinition): JourneyDefinition {
  return definition
}
