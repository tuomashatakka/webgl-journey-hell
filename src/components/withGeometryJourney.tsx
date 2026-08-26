'use client'

// withGeometryJourney(createScene) — a journey made of actual triangles.
//
// The sibling of withShaderJourney, and the second of the two renderer paths the
// shell supports. Where a shader journey hands over a fragment source and lets
// lib/shaderQuad build the program, a geometry journey hands over a factory that
// builds an entire scene — vertex buffers, programs, framebuffers — and returns
// something that can draw one frame of it.
//
// Two context differences are the whole reason this wrapper exists:
//
//   • **webgl2**, for vertex array objects, instanced draws and blitFramebuffer.
//     Every SDF journey here is GLSL ES 1.00 and gains nothing from WebGL2, so
//     the shell keeps 'webgl' as its default and this opts out of it.
//   • **depth: true**. A raymarch resolves visibility analytically along the ray
//     and needs no depth buffer at all — which is why the shell's default is
//     `depth: false`. A rasterizer without one draws its rooms in submission
//     order, and you see straight through the walls.
//
// `antialias: false` stays: the scene renders into its own multisampled
// renderbuffer and resolves that itself, so multisampling the default
// framebuffer as well would be paid for twice and used once.
//
// Usage:
//   'use client';
//   import { withGeometryJourney } from '@/components/withGeometryJourney';
//   import { createLoopLineScene } from './scene';
//   export default withGeometryJourney(createLoopLineScene);

import { withJourneyShell } from './withJourneyShell'
import type { JourneyRenderer, ShaderJourneyOptions } from './withJourneyShell'


export type GeometrySceneFactory = (
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
) => JourneyRenderer | null

export function withGeometryJourney (
  createScene: GeometrySceneFactory,
  options: ShaderJourneyOptions = {},
) {
  return withJourneyShell(
    (gl, canvas) => createScene(gl as WebGL2RenderingContext, canvas),
    {
      ...options,
      contextType:       'webgl2',
      contextAttributes: { depth: true, antialias: false },
    },
  )
}

export default withGeometryJourney
