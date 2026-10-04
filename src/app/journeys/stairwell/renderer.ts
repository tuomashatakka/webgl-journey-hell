// THE STAIRWELL — the renderer.
//
// Two passes on WebGL2: the scene is raymarched into a half-float target (or
// an encoded RGBA8 one where float targets are unavailable), its mip chain is
// rebuilt, and the post pass takes bloom from those mips, grades, tonemaps and
// tears the picture as the rupture demands. The shared CRT pass then goes over
// the top without either knowing about the other.
//
// Each act stands under its own photographed sky from Δ, and its sun comes
// from where that photograph puts it: the sky's sun position plus a per-act
// yaw that turns the map so the light rakes across the stair rather than
// sitting behind the camera. The current act's sky and the next act's are both
// bound, because the next act is visible through the portal at the far seam.

import type { JourneyRenderer } from '✦/lib/journey'
import { QUAD_VS_300, createFullscreenQuad, createGlProgram, createRenderTarget, sceneFormat } from '✦/lib/gl'
import type { FrameUniforms, RenderTarget } from '✦/lib/gl'
import { createMaterialArrays, createSkyTexture } from 'Δ/gl'
import type { SkyTexture } from 'Δ/gl'
import { skyAsset, sunDirection } from 'Δ'
import { fsPost, fsScene } from './shaders'
import { PURGATORY_LENGTH, SEAM_HALF, STAIRWELL_SECTIONS } from './kinematics'
import { smoothstep } from '✦/lib/math'


interface ActLight {
  sky:      string;
  yaw:      number;
  sun:      number;
  exposure: number;
}

/** Index 6 is purgatory. */
const ACTS: ActLight[] = [
  { sky: 'DAWN', yaw: -0.30, sun: 5.0, exposure: 0.95 },
  { sky: 'OVERCAST', yaw: -0.20, sun: 0.8, exposure: 1.35 },
  { sky: 'DAY', yaw: -0.38, sun: 7.0, exposure: 0.8 },
  { sky: 'EVENING', yaw: -0.36, sun: 6.0, exposure: 0.85 },
  { sky: 'HAZE', yaw: -0.24, sun: 5.0, exposure: 0.75 },
  { sky: 'AURORA', yaw: 0.0, sun: 0.0, exposure: 2.4 },
  { sky: 'OVERCAST', yaw: 0.35, sun: 0.0, exposure: 1.3 },
]

const LENGTHS = [ ...STAIRWELL_SECTIONS.map(s => s.end - s.start), PURGATORY_LENGTH ]
const SEAM    = SEAM_HALF

/**
 * The light comes from the sun's bearing in the photograph, but never from
 * lower than eighteen degrees. A dawn sun at four degrees is true to the map
 * and lights nothing but the faces turned square to it — every floor and
 * every tread goes flat — so the light is lifted, and the glow on the horizon
 * stays where the photograph put it.
 */
function lightFrom (d: [ number, number, number ]): [ number, number, number ] {
  const minY = Math.sin(18 * Math.PI / 180)
  if (d[1] >= minY)
    return d

  const h = Math.hypot(d[0], d[2]) || 1
  const c = Math.cos(Math.asin(minY))
  return [ d[0] / h * c, minY, d[2] / h * c ]
}


export function createStairwellRenderer (
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
): JourneyRenderer | null {
  const g2 = gl as WebGL2RenderingContext
  if (typeof g2.texImage3D !== 'function') {
    console.error('[stairwell] needs WebGL2')
    return null
  }

  const scene = createGlProgram(g2, QUAD_VS_300, fsScene, 'stairwell')
  const post  = createGlProgram(g2, QUAD_VS_300, fsPost, 'stairwell')
  if (!scene || !post) {
    scene?.dispose()
    post?.dispose()
    return null
  }

  const materials = createMaterialArrays(g2)
  const skies     = new Map<string, SkyTexture>()
  for (const act of ACTS)
    if (!skies.has(act.sky))
      skies.set(act.sky, createSkyTexture(g2, act.sky))

  // One act's sky, sun and light as uSky<k>, uSun<k> and uSkyInfo<k>, its map
  // on texture unit `unit`.
  const bindAct = (k: string, act: ActLight, unit: number) => {
    const sky = skies.get(act.sky)!
    const sun = lightFrom(sunDirection(skyAsset(act.sky), act.yaw))
    sky.bind(g2, unit)
    scene.uniform1i(`uSky${k}`, unit)
    scene.uniform3f(`uSun${k}`, sun[0], sun[1], sun[2])
    scene.uniform4f(`uSkyInfo${k}`, sky.exposure, act.yaw, act.sun, 0)
  }

  // The scene target carries a full mip chain: the post pass takes its bloom
  // from the wider levels instead of from a separate blur chain.
  const format = sceneFormat(g2)
  const quad   = createFullscreenQuad(g2)
  let target: RenderTarget | null = null

  const resize = () => {
    if (target && target.width === canvas.width && target.height === canvas.height)
      return
    target?.dispose()
    target = createRenderTarget(g2, canvas.width, canvas.height, format, { mips: true })
  }

  const num = (frame: FrameUniforms, name: string): number => {
    const v = frame.custom?.[name]
    return typeof v === 'number' ? v : 0
  }

  return {
    ready () {
      return materials.ready && [ ...skies.values() ].every(s => s.ready)
    },

    draw (frame) {
      resize()

      const section  = Math.round(num(frame, 'uSection'))
      const progress = num(frame, 'uSectionProgress')
      const a        = ACTS[section] ?? ACTS[0]
      const b        = ACTS[Math.round(num(frame, 'uNextSection'))] ?? a
      const c        = ACTS[Math.round(num(frame, 'uFarSection'))] ?? b
      const p        = ACTS[Math.round(num(frame, 'uPrevSection'))] ?? a

      // Exposure is blended across each seam by where the camera is, exactly
      // as the slope is: half-and-half at the middle of the tunnel, from
      // either side, so the switch of act changes nothing.
      const len      = LENGTHS[section] ?? 70
      const z        = progress * len
      const exposure = (p.exposure + (a.exposure - p.exposure) * smoothstep(-SEAM, SEAM, z)) *
        (1 - smoothstep(len - SEAM, len + SEAM, z)) + b.exposure * smoothstep(len - SEAM, len + SEAM, z)

      // --- scene ---
      g2.disable(g2.BLEND)
      g2.disable(g2.DEPTH_TEST)
      target!.bind()
      scene.use()
      scene.frame(frame, canvas.width, canvas.height, 1)
      materials.bind(g2, 0)
      scene.uniform1i('uMatColor', 0)
      scene.uniform1i('uMatNormal', 1)
      scene.uniform1i('uMatDetail', 2)
      // This act, the next, and the one framed in the next one's far bore.
      bindAct('A', a, 3)
      bindAct('B', b, 4)
      bindAct('C', c, 5)
      scene.uniform1f('uEncode', format.hdr ? 0 : 1)
      quad.draw()

      g2.bindTexture(g2.TEXTURE_2D, target!.tex)
      g2.generateMipmap(g2.TEXTURE_2D)

      // --- post ---
      g2.bindFramebuffer(g2.FRAMEBUFFER, null)
      g2.viewport(0, 0, canvas.width, canvas.height)
      post.use()
      post.frame(frame, canvas.width, canvas.height, 1)
      g2.activeTexture(g2.TEXTURE0)
      g2.bindTexture(g2.TEXTURE_2D, target!.tex)
      post.uniform1i('uTexture', 0)
      post.uniform1f('uDecode', format.hdr ? 0 : 1)
      post.uniform1f('uExposure', exposure)
      quad.draw()
    },

    dispose () {
      quad.dispose()
      target?.dispose()
      materials.dispose(g2)
      skies.forEach(s => s.dispose(g2))
      scene.dispose()
      post.dispose()
    },
  }
}

// perf: one raymarch pass, a mip rebuild, one post pass; nothing allocated per frame.
