// The bare harness: one journey's renderer and simulation on a plain canvas,
// with none of the app around it.
//
// `tools/harness/serve.mjs` bundles this file with bun and serves it at
// /journeys/<slug>, so every URL tools/journey.mjs builds for the dev server
// works against it unchanged: same `?t=&w=&h=&pointer=&dt=` query, same
// `window.__journeyDebug`, same `html[data-journey-ready="1"]` handshake. What
// it skips is everything that is not the picture — React, Next's dev compiler,
// the settings, the HUD, the title card, the CRT pass (which the shell skips
// under `?t=` anyway). Cold start is a bun build rather than a Next dev server
// compiling the route: a second rather than a minute.
//
// Every journey is here, because every journey is a definition
// (app/journeys/<slug>/journey.ts) and the harness runs definitions exactly as
// the shell does: same context, same renderer factory, same seek, same frame
// evaluation (lib/journey). A harness that disagreed with the shell would lie.
//
// /journeys/previews compiles every landing-page preview shader in one WebGL 1
// context and reports any that fail.

import { JOURNEY_DEFINITIONS } from '✦/journeys/definitions'
import { JOURNEYS } from '✦/journeys/registry'
import { publishDebugState, readDebugParams } from '@wjh/web/debugParams'
import { createContext } from '@wjh/gl/context'
import { createShaderQuad } from '@wjh/gl/shaderQuad'
import { evaluateFrame } from '@wjh/journey/frame'
import { seekSimulation } from '@wjh/journey/seek'


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

function publishStatus (journey: string, label: string, width = 0, height = 0): void {
  publishDebugState({ journey, time: 0, label, seeking: true, ready: true, width, height, fps: 0, paused: false, speed: 1, pan: [ 0, 0 ], uniforms: {}})
}

/** Compile every registry preview shader; one error line per failure. */
function checkPreviews (): void {
  const canvas  = document.createElement('canvas')
  canvas.width  = 64
  canvas.height = 64
  document.body.appendChild(canvas)

  const gl = createContext(canvas, 'webgl', { preserveDrawingBuffer: true })
  if (!gl) {
    errors.push('no webgl context')
    return publishStatus('previews', 'BROKEN')
  }
  for (const j of JOURNEYS) {
    const quad = createShaderQuad(gl, j.previewShader)
    if (!quad) {
      errors.push(`preview ${j.slug} failed to compile`)
      continue
    }
    quad.draw({ time: 1.5, pointer: { x: 0, y: 0 }, heavy: 1 })
    quad.dispose()
  }
  gl.finish()
  publishStatus('previews', `PREVIEWS · ${JOURNEYS.length}`, 64, 64)
}

/**
 * ?u.uName=1.5 (or =1,2,3 for a vector) overrides one uniform after the seek —
 * for bisecting a frame: hold everything else, change one input.
 */
function withOverrides (custom: Record<string, number | number[]>): Record<string, number | number[]> {
  for (const [ key, value ] of new URLSearchParams(location.search))
    if (key.startsWith('u.')) {
      const v              = value.split(',').map(Number)
      custom[key.slice(2)] = v.length === 1 ? v[0] : v
    }
  return custom
}

/**
 * Assets load asynchronously (Δ). The shell holds its frozen frame on the
 * same flag, so a plate is never of the placeholder.
 */
type RendererType = { ready?(): boolean }

async function whenReady (renderer: RendererType): Promise<void> {
  const deadline = performance.now() + 20_000
  while (renderer.ready && !renderer.ready() && performance.now() < deadline)
    await new Promise(r => setTimeout(r, 30))
}

async function main (): Promise<void> {
  window.__harnessErrors = errors

  const slug = location.pathname.split('/').filter(Boolean)
    .pop() ?? ''
  if (slug === 'previews')
    return checkPreviews()

  const journey = JOURNEY_DEFINITIONS[slug]
  if (!journey) {
    document.body.textContent = `no journey "${slug}" — see app/journeys/definitions.ts`
    errors.push(`unknown journey ${slug}`)
    return publishStatus(slug, 'UNKNOWN')
  }

  const d       = readDebugParams()
  const canvas  = document.createElement('canvas')
  canvas.width  = d.w ?? 640
  canvas.height = d.h ?? 360
  document.body.appendChild(canvas)

  const gl = createContext(canvas, journey.renderer.context, {
    ...journey.renderer.attributes,
    preserveDrawingBuffer: true,
  })
  if (!gl) {
    errors.push(`no ${journey.renderer.context} context`)
    return publishStatus(slug, 'BROKEN')
  }

  const renderer = journey.renderer.create(gl, canvas)
  if (!renderer) {
    errors.push('renderer factory returned null (a program failed to compile or link)')
    return publishStatus(slug, 'BROKEN', canvas.width, canvas.height)
  }

  const t   = d.t ?? 0
  const sim = journey.createSimulation?.() ?? null
  seekSimulation(sim, t, d.dt)

  const frame  = evaluateFrame(journey, sim, t)
  const custom = withOverrides(frame.custom ?? {})
  await whenReady(renderer)

  // heavyEffects defaults on for a desktop in lib/settings, so the harness
  // does too; ?heavy=0 renders the phone path.
  const heavy   = new URLSearchParams(location.search).get('heavy') === '0' ? 0 : 1
  const pointer = d.pointer ? { x: d.pointer[0], y: d.pointer[1] } : { x: 0, y: 0 }
  renderer.draw({ time: t, pointer, heavy, custom })
  gl.finish()

  publishDebugState({
    journey:  slug,
    time:     t,
    label:    frame.label,
    seeking:  true,
    ready:    true,
    width:    canvas.width,
    height:   canvas.height,
    fps:      0,
    paused:   false,
    speed:    1,
    pan:      [ 0, 0 ],
    uniforms: custom,
  })
}

main().catch(err => {
  errors.push(String(err?.stack ?? err))
  publishStatus('?', 'CRASHED')
})
