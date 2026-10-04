'use client'

// The Δ asset library, on one page: every material as a lit sphere you can
// strip down to any one of its maps, and every sky as a slow pan.
//
// One WebGL2 canvas sits fixed behind the whole page and every card's preview
// is a scissored viewport on it — the same trick ShaderPreviewLayer plays for
// the journey cards, and for the same reason: a page of two dozen previews
// with a context each would hit the browser's per-document limit long before
// the bottom of the page. A card only registers the box it wants drawn; the
// one frame loop walks the boxes that are on screen.
//
// The spheres are analytic — a ray–sphere hit per pixel, no mesh — sampled
// triplanar with explicit gradients, because the hit/miss test is a branch and
// implicit derivatives inside it are undefined at exactly the silhouette.

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { MATERIALS, SKIES } from '@wjh/delta/manifest'
import { createMaterialArrays, createSkyTexture } from '@wjh/delta/gl'
import type { SkyTexture } from '@wjh/delta/gl'
import { MATERIAL_GLSL, SKY_GLSL, SURFACE_GLSL } from '@wjh/delta/glsl'
import { createGlProgram } from '@wjh/gl/program'


/** What a material card shows. Index is the shader's uMode. */
const MAP_MODES = [
  { id: 'lit', label: 'Lit' },
  { id: 'color', label: 'Color' },
  { id: 'displacement', label: 'Displacement' },
  { id: 'normal', label: 'Normal' },
  { id: 'roughness', label: 'Roughness' },
  { id: 'ao', label: 'Ambient Occlusion' },
  { id: 'metalness', label: 'Metalness' },
] as const

const VERT = `#version 300 es
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main () {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`

const FRAG = `#version 300 es
precision highp float;
${MATERIAL_GLSL}
${SURFACE_GLSL}
${SKY_GLSL}

in vec2 vUv;
uniform float uKind;       // 0 material sphere, 1 sky pan
uniform float uLayer;
uniform float uMode;
uniform float uTime;
uniform vec2 uSize;
uniform sampler2D uSky;
uniform float uSkyExposure;
uniform vec3 uSun;
out vec4 fragColor;

vec3 aces (vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

mat3 rotY (float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }

void main () {
  vec2 p = (vUv - 0.5) * vec2(uSize.x / uSize.y, 1.0);
  vec3 col;
  if (uKind > 0.5) {
    // A slow pan around the horizon, looking a little up.
    float yaw = uTime * 0.03;
    vec3 fwd = normalize(vec3(cos(yaw), 0.18, sin(yaw)));
    vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, fwd);
    vec3 rd = normalize(fwd + p.x * right * 1.3 + p.y * up * 1.3);
    col = aces(skyRadiance(skyTexel(uSky, rd, 0.0), uSkyExposure));
    fragColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
    return;
  }

  vec3 ro = vec3(0.0, 0.0, 3.2);
  vec3 rd = normalize(vec3(p * 0.82, -1.0));
  float b = dot(ro, rd);
  float c = dot(ro, ro) - 1.0;
  float h = b * b - c;
  float t = h > 0.0 ? -b - sqrt(h) : 1e3;
  vec3 hit = ro + rd * min(t, 6.0);
  // Gradients for the triplanar lookup, taken before the branch.
  mat3 R = rotY(uTime * 0.12);
  vec3 q = R * hit * 1.6;
  vec3 dqx = dFdx(q);
  vec3 dqy = dFdy(q);
  vec3 bg = skyRadiance(skyTexel(uSky, rd, 0.0), uSkyExposure * 0.35);

  if (h <= 0.0) {
    col = aces(bg * 0.6);
  } else {
    vec3 n = normalize(hit);
    vec3 nl = R * n;
    Surface s = sampleTriplanarGrad(uLayer, q, nl, 4.0, dqx, dqy);
    s.normal = transpose(R) * s.normal;
    int mode = int(uMode + 0.5);
    if (mode == 0) {
      vec3 V = -rd;
      vec3 L = normalize(uSun);
      col = shadeBrdf(s, V, L) * vec3(1.0, 0.95, 0.88) * 3.2;
      vec3 irr = skyIrradiance(uSky, s.normal, 0.0, uSkyExposure);
      vec3 refl = textureLod(uSky, equirectUv(reflect(rd, s.normal), 0.0), 1.0 + s.rough * 7.0).rgb * uSkyExposure;
      col += shadeAmbient(s, V, irr, refl, mix(0.5, 1.0, s.height));
      col = aces(col);
    }
    else if (mode == 1) col = s.albedo;
    else if (mode == 2) col = vec3(s.height);
    else if (mode == 3) {
      // The tangent-space map itself, as the file stores it: re-sample the
      // dominant projection rather than show the world-space normal.
      vec3 w = abs(nl);
      float k = matScale(uLayer);
      bool xd = w.x > w.y && w.x > w.z;
      bool yd = !xd && w.y > w.z;
      vec2 uv = xd ? q.zy : yd ? q.xz : q.xy;
      vec2 gx = xd ? dqx.zy : yd ? dqx.xz : dqx.xy;
      vec2 gy = xd ? dqy.zy : yd ? dqy.xz : dqy.xy;
      col = textureGrad(uMatNormal, vec3(uv * k, uLayer), gx * k, gy * k).rgb;
      col = vec3(col.xy, sqrt(max(1.0 - dot(col.xy * 2.0 - 1.0, col.xy * 2.0 - 1.0), 0.0)) * 0.5 + 0.5);
      col = pow(col, vec3(2.2));
    }
    else if (mode == 4) col = vec3(s.rough);
    else if (mode == 5) col = vec3(s.ao);
    else col = vec3(s.metal);
    if (mode != 0 && mode != 1 && mode != 3) col = pow(col, vec3(2.2));
    // Antialias the rim against the backdrop.
    float rim = smoothstep(0.0, 0.0025, h);
    col = mix(aces(bg * 0.6), col, rim);
  }
  fragColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
}
`

type ModeId = typeof MAP_MODES[number]['id']

interface Slot {
  el:    HTMLElement;
  kind:  0 | 1;
  index: number;
}

type PreviewProps = {
  id:       string;
  kind:     0 | 1;
  index:    number;
  register: (key: string, slot: Slot | null) => void;
}

function useAssetCanvas (mode: ModeId, light: string) {
  const canvasRef  = useRef<HTMLCanvasElement | null>(null)
  const slots      = useRef(new Map<string, Slot>())
  const modeRef    = useRef(mode)
  const lightRef   = useRef(light)
  modeRef.current  = mode
  lightRef.current = light

  const register = useCallback((key: string, slot: Slot | null) => {
    if (slot)
      slots.current.set(key, slot)
    else
      slots.current.delete(key)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const gl     = canvas?.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: false })
    if (!canvas || !gl)
      return

    const prog = createGlProgram(gl, VERT, FRAG)
    if (!prog)
      return

    const materials = createMaterialArrays(gl)
    const skies     = new Map<string, SkyTexture>(SKIES.map(s => [ s.id, createSkyTexture(gl, s.id) ]))
    const quad      = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([ -1, -1, 1, -1, -1, 1, 1, 1 ]), gl.STATIC_DRAW)

    let raf = 0
    const t0    = performance.now()
    const frame = () => {
      raf = requestAnimationFrame(frame)

      const dpr = Math.min(1.5, window.devicePixelRatio || 1)
      const w   = Math.round(window.innerWidth * dpr)
      const h   = Math.round(window.innerHeight * dpr)
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width  = w
        canvas.height = h
      }
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
      prog.uniform1f('uMode', MAP_MODES.findIndex(m => m.id === modeRef.current))
      gl.bindBuffer(gl.ARRAY_BUFFER, quad)
      gl.enableVertexAttribArray(0)
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

      for (const slot of slots.current.values()) {
        const r = slot.el.getBoundingClientRect()
        if (r.bottom < 0 || r.top > window.innerHeight || r.width < 2)
          continue

        const x  = Math.round(r.left * dpr)
        const y  = Math.round((window.innerHeight - r.bottom) * dpr)
        const vw = Math.round(r.width * dpr)
        const vh = Math.round(r.height * dpr)
        gl.viewport(x, y, vw, vh)
        gl.scissor(x, y, vw, vh)

        const skyId = slot.kind === 1 ? SKIES[slot.index].id : lightRef.current
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
  }, [])

  return { canvasRef, register }
}

function Preview ({ id, kind, index, register }: PreviewProps) {
  const ref = useCallback((el: HTMLDivElement | null) => {
    register(id, el ? { el, kind, index } : null)
  }, [ id, kind, index, register ])
  return <div ref={ ref } className="asset-card__preview" aria-hidden />
}

export default function AssetBrowser () {
  const [ mode, setMode ]       = useState<ModeId>('lit')
  const [ light, setLight ]     = useState<string>('DAY')
  const { canvasRef, register } = useAssetCanvas(mode, light)

  return <main className="assets-page">
    <canvas ref={ canvasRef } className="assets-canvas" aria-hidden />

    <header className="index-header">
      <p className="index-sigil" aria-hidden>ΔΔΔΔΔ</p>
      <h1 className="index-title">Δ — the asset library</h1>

      <p className="index-subtitle">
        {MATERIALS.length} materials · {SKIES.length} skies · ambientCG · CC0
      </p>

      <p className="assets-back">
        <Link href="/">← back to the journeys</Link>
      </p>
    </header>

    <div className="assets-controls">
      <fieldset className="assets-radio">
        <legend>map</legend>

        {MAP_MODES.map(m =>
          <label key={ m.id } className="assets-radio__option">
            <span>{m.label}</span>

            <input
              type="radio"
              name="map-mode"
              value={ m.id }
              checked={ mode === m.id }
              onChange={ () => setMode(m.id) } />
          </label>
        )}
      </fieldset>

      <fieldset className="assets-radio">
        <legend>lit by</legend>

        {SKIES.filter(s => s.exposure > 0.5).map(s =>
          <label key={ s.id } className="assets-radio__option">
            <span>{s.label}</span>

            <input
              type="radio"
              name="light"
              value={ s.id }
              checked={ light === s.id }
              onChange={ () => setLight(s.id) } />
          </label>
        )}
      </fieldset>
    </div>

    <h2 className="assets-heading">materials</h2>

    <ul className="assets-grid">
      {MATERIALS.map((m, i) =>
        <li key={ m.id } className="asset-card">
          <Preview id={ `m-${m.id}` } kind={ 0 } index={ i } register={ register } />

          <div className="asset-card__body">
            <strong>{m.label}</strong>
            <code>Δ · MAT_{m.id} · layer {i}</code>
            <span>{m.metres} m repeat · {m.depth * 1000} mm relief</span>
            <a href={ `https://ambientcg.com/view?id=${m.asset}` } target="_blank" rel="noreferrer">{m.asset} ↗</a>
          </div>
        </li>
      )}
    </ul>

    <h2 className="assets-heading">skies</h2>

    <ul className="assets-grid assets-grid--wide">
      {SKIES.map((s, i) =>
        <li key={ s.id } className="asset-card">
          <Preview id={ `s-${s.id}` } kind={ 1 } index={ i } register={ register } />

          <div className="asset-card__body">
            <strong>{s.label}</strong>
            <code>Δ · SKY {s.id}</code>
            <span>exposure {s.exposure}{s.sun ? ` · sun at (${s.sun[0]}, ${s.sun[1]})` : ' · no sun'}</span>
            <a href={ `https://ambientcg.com/view?id=${s.asset}` } target="_blank" rel="noreferrer">{s.asset} ↗</a>
          </div>
        </li>
      )}
    </ul>

    <footer className="index-footer">
      <span>{'// every asset CC0 from ambientcg.com — rebuild with `bun delta/build.mjs`'}</span>
    </footer>
  </main>
}
