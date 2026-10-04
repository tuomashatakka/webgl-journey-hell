// The bare harness: one journey's renderer and simulation on a plain canvas,
// with none of the app around it.
//
// `tools/harness/serve.mjs` bundles this file with bun and serves it at
// /journeys/<slug>, so every URL tools/journey.mjs builds for the dev server
// works against it unchanged: same `?t=&w=&h=&pointer=&dt=` query, same
// `window.__journeyDebug`, same `html[data-journey-ready="1"]` handshake. What
// it skips is everything that is not the picture — React, Next's dev compiler,
// the settings provider, the HUD, the CRT pass (which the shell suppresses
// under `?t=` anyway). Cold start is a bun build of a few hundred kilobytes
// rather than a Next dev server compiling the route, which is the difference
// between a second and a minute.
//
// The draw is the shell's frozen path, line for line: seek the simulation in
// fixed steps, attach uSignalLoss if the journey has ended, draw once, publish.
// Anything that disagreed with withJourneyShell here would make the harness
// lie, so it imports the same seek and the same signal model rather than
// re-deriving them.

import type { JourneyRenderer, JourneySimulation } from '✦/components/withJourneyShell'
import { publishDebugState, readDebugParams, seekSimulation } from '✦/lib/debugParams'
import { signalLossAt } from '✦/lib/signalLoss'
import { createLoopLineScene } from '✦/app/journeys/loop-line/scene'
import { createLoopLineSimulation } from '✦/app/journeys/loop-line/kinematics'
import { createStairwellRenderer } from '✦/app/journeys/stairwell/renderer'
import { createStairwellSimulation } from '✦/app/journeys/stairwell/kinematics'


type AnyGl = WebGLRenderingContext | WebGL2RenderingContext

interface HarnessJourney {
  context:    'webgl' | 'webgl2';
  depth:      boolean;
  renderer:   (gl: AnyGl, canvas: HTMLCanvasElement) => JourneyRenderer | null;
  simulation: () => JourneySimulation;
}

// Journeys the harness can drive. Mirrors each page.tsx's HOC options — the
// context type and depth are the only part of the shell a renderer can tell
// apart. Add a line here to bring another journey under the bare tools.
const JOURNEYS: Record<string, HarnessJourney> = {
  'loop-line': {
    context:    'webgl2',
    depth:      true,
    renderer:   (gl, c) => createLoopLineScene(gl as WebGL2RenderingContext, c),
    simulation: createLoopLineSimulation,
  },
  'stairwell': {
    context:    'webgl2',
    depth:      false,
    renderer:   createStairwellRenderer,
    simulation: createStairwellSimulation,
  },
}

const errors: string[] = []
const origError        = console.error
console.error          = (...args: unknown[]) => {
  errors.push(args.map(String).join(' '))
  origError(...args)
}

declare global {
  interface Window {
    __harnessErrors?: string[];
  }
}

async function main (): Promise<void> {
  window.__harnessErrors = errors

  const slug    = location.pathname.split('/').filter(Boolean)
    .pop() ?? ''
  const journey = JOURNEYS[slug]
  if (!journey) {
    document.body.textContent = `no harness entry for "${slug}" — add it to tools/harness/entry.ts`
    errors.push(`unknown journey ${slug}`)
    publishDebugState({ journey:  slug,
      time:     0,
      label:    'UNKNOWN',
      seeking:  true,
      ready:    true,
      width:    0,
      height:   0,
      fps:      0,
      uniforms: {}})
    return
  }

  const d       = readDebugParams()
  const canvas  = document.createElement('canvas')
  canvas.width  = d.w ?? 640
  canvas.height = d.h ?? 360
  document.body.appendChild(canvas)

  const gl = canvas.getContext(journey.context, {
    alpha:                 false,
    antialias:             false,
    depth:                 journey.depth,
    preserveDrawingBuffer: true,
  }) as AnyGl | null
  if (!gl) {
    errors.push(`no ${journey.context} context`)
    return
  }

  const renderer = journey.renderer(gl, canvas)
  if (!renderer) {
    errors.push('renderer factory returned null (a program failed to compile or link)')
    publishDebugState({ journey:  slug,
      time:     0,
      label:    'BROKEN',
      seeking:  true,
      ready:    true,
      width:    canvas.width,
      height:   canvas.height,
      fps:      0,
      uniforms: {}})
    return
  }

  const t   = d.t ?? 0
  const sim = journey.simulation()
  seekSimulation(sim, t, d.dt)

  const marks  = sim.marks?.()
  const custom = sim.uniforms()
  if (marks?.signalAge)
    custom.uSignalLoss = signalLossAt(marks.signalAge).level

  // ?u.uName=1.5 (or =1,2,3 for a vector) overrides one uniform after the
  // seek — for bisecting a frame: hold everything else, change one input.
  for (const [ key, value ] of new URLSearchParams(location.search))
    if (key.startsWith('u.')) {
      const v              = value.split(',').map(Number)
      custom[key.slice(2)] = v.length === 1 ? v[0] : v
    }

  // Assets load asynchronously (lib/materialLibrary). The shell holds its
  // frozen frame on the same flag, so a plate is never of the placeholder.
  const deadline = performance.now() + 20_000
  while (renderer.ready && !renderer.ready() && performance.now() < deadline)
    await new Promise(r => setTimeout(r, 30))

  // heavyEffects defaults on in lib/settings, so the harness does too.
  const heavy   = new URLSearchParams(location.search).get('heavy') === '0' ? 0 : 1
  const pointer = d.pointer ? { x: d.pointer[0], y: d.pointer[1] } : { x: 0, y: 0 }
  renderer.draw({ time: t, pointer, heavy, custom })
  gl.finish()

  publishDebugState({
    journey:  slug,
    time:     t,
    label:    sim.label?.() ?? '',
    seeking:  true,
    ready:    true,
    width:    canvas.width,
    height:   canvas.height,
    fps:      0,
    uniforms: custom,
  })
}

main().catch(err => {
  errors.push(String(err?.stack ?? err))
  publishDebugState({ journey:  '?',
    time:     0,
    label:    'CRASHED',
    seeking:  true,
    ready:    true,
    width:    0,
    height:   0,
    fps:      0,
    uniforms: {}})
})
