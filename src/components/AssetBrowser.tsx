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
import { startAssetBrowser } from '@wjh/delta/browser'
import type { AssetSlot, AssetView } from '@wjh/delta/browser'
import { MAP_MODES } from '@wjh/delta/browserShader'
import useLatestRef from '✦/hooks/use-latest-ref'


type ModeId = typeof MAP_MODES[number]['id']

type PreviewProps = {
  id:       string;
  kind:     0 | 1;
  index:    number;
  register: (key: string, slot: AssetSlot | null) => void;
}

function useAssetCanvas (mode: ModeId, light: string) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const slots     = useRef(new Map<string, AssetSlot>())
  const viewRef   = useLatestRef<AssetView>({ mode, light })

  const register = useCallback((key: string, slot: AssetSlot | null) => {
    if (slot)
      slots.current.set(key, slot)
    else
      slots.current.delete(key)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    return canvas ? startAssetBrowser(canvas, () => viewRef.current, slots.current) ?? undefined : undefined
  }, [ viewRef ])

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
