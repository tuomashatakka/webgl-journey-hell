'use client'

// withShaderJourney(fragmentShader) — a journey that is one fragment shader.
//
// This is the raymarched path, and it is what six of the seven original
// journeys are: a single-pass GLSL ES 1.00 scene drawn over a full-screen quad.
// Everything that is *not* about the shader — the WebGL context, the resize, the
// pointer, the settings, the frame loop, the ?t= seeking, the HUD — lives in
// components/withJourneyShell, which this file is now a five-line wrapper
// around. ShaderQuad already has exactly the { draw, dispose } shape the shell
// asks a renderer for, so there is no adapter here, only a factory.
//
// The public surface is unchanged, deliberately: several journeys import
// `JourneySimulation` from this path, and the five templated routes call
// `withShaderJourney(frag, options)` exactly as before.
//
// Usage (a journey page is three lines):
//   'use client';
//   import { withShaderJourney } from '@/components/withShaderJourney';
//   import { skybridgesFrag } from './shader';
//   export default withShaderJourney(skybridgesFrag);
//
// For a journey made of actual triangles instead, see withGeometryJourney.

import { createShaderQuad } from '@/lib/shaderQuad'
import { withJourneyShell } from './withJourneyShell'
import type { ShaderJourneyOptions } from './withJourneyShell'


export type {
  JourneyRenderer,
  JourneyRendererFactory,
  JourneyShellOptions,
  JourneySimulation,
  ShaderJourneyOptions

} from './withJourneyShell'

export function withShaderJourney (
  fragmentShader: string,
  options: ShaderJourneyOptions = {},
) {
  // The shell defaults to a WebGL 1.0 context with no depth buffer, which is
  // what a full-screen quad wants, so there is nothing to override here.
  return withJourneyShell(
    gl => createShaderQuad(gl as WebGLRenderingContext, fragmentShader, {
      envUrl: options.envMapUrl,
    }),
    options,
  )
}

export default withShaderJourney
