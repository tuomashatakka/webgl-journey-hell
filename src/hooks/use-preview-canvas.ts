'use client'

import { CONFIG } from '@wjh/config/config'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { RefObject } from 'react'
import { createShaderQuad } from '@wjh/gl/shaderQuad'
import type { ShaderQuad } from '@wjh/gl/shaderQuad'
import { createPanControl } from '@wjh/web/panControl'
import type { PanControl } from '@wjh/web/panControl'
import type { Journey } from '✦/journeys/registry'


export interface PreviewAPI {
  activate:   (journey: Journey, slot: HTMLElement) => void;
  deactivate: (slug: string) => void;
}

/**
 * The ONE shared preview canvas: created imperatively into the returned host,
 * moved into a card's slot by activate() and parked back by deactivate().
 */
type UsePreviewCanvasReturnType = { hostRef: RefObject<HTMLDivElement | null>; api: PreviewAPI }

export function usePreviewCanvas (): UsePreviewCanvasReturnType {
  const hostRef       = useRef<HTMLDivElement>(null)
  const canvasRef     = useRef<HTMLCanvasElement | null>(null)
  const glRef         = useRef<WebGLRenderingContext | null>(null)
  const quadCache     = useRef<Map<string, ShaderQuad | null>>(new Map())
  const rafRef        = useRef<number>(0)
  const activeSlugRef = useRef<string | null>(null)
  const panRef        = useRef<PanControl | null>(null)
  const lastFrameRef  = useRef(0)

  // Create the canvas + context imperatively so React StrictMode's dev double
  // mount cannot leak a second GL context — cleanup tears everything down.
  useEffect(() => {
    const host = hostRef.current
    if (!host)
      return

    const canvas               = document.createElement('canvas')
    canvas.style.position      = 'absolute'
    canvas.style.inset         = '0'
    canvas.style.width         = '100%'
    canvas.style.height        = '100%'
    canvas.style.display       = 'block'
    canvas.style.pointerEvents = 'none' // keep the card clickable underneath
    host.appendChild(canvas)

    // Card-relative pointer, tweened like the journeys themselves (a cursor
    // arriving from another card is a big delta and would otherwise snap).
    // No gyroscope here — a tilt shouldn't stir every thumbnail on the grid.
    panRef.current = createPanControl({
      gyroscope: false,
      getRect:   () => canvas.getBoundingClientRect(),
    })

    canvasRef.current = canvas
    glRef.current     = canvas.getContext('webgl', {
      antialias: false,
      depth:     false,
      alpha:     false,
    })

    return () => {
      cancelAnimationFrame(rafRef.current)
      panRef.current?.dispose()
      panRef.current = null
      quadCache.current.forEach(q => q?.dispose())
      quadCache.current.clear()
      glRef.current?.getExtension('WEBGL_lose_context')?.loseContext()
      canvas.remove()
      glRef.current         = null
      canvasRef.current     = null
      activeSlugRef.current = null
    }
  }, [])

  const renderLoop = useCallback((now: number) => {
    const gl   = glRef.current
    const slug = activeSlugRef.current
    if (!gl || !slug)
      return

    const dt             = lastFrameRef.current ? (now - lastFrameRef.current) * 0.001 : 0
    lastFrameRef.current = now

    const pointer = panRef.current?.update(dt)
    const quad    = quadCache.current.get(slug)
    quad?.draw({ time: now * 0.001, pointer })
    rafRef.current = requestAnimationFrame(renderLoop)
  }, [])

  const activate = useCallback(
    (journey: Journey, slot: HTMLElement) => {
      const gl     = glRef.current
      const canvas = canvasRef.current
      if (!gl || !canvas)
        return

      slot.appendChild(canvas) // move the single canvas onto the hovered card
      activeSlugRef.current = journey.slug

      const rect    = slot.getBoundingClientRect()
      const dpr     = Math.min(window.devicePixelRatio || 1, CONFIG.runtime.maxDpr)
      canvas.width  = Math.max(1, Math.floor(rect.width * dpr * CONFIG.ui.previewScale))
      canvas.height = Math.max(1, Math.floor(rect.height * dpr * CONFIG.ui.previewScale))

      if (!quadCache.current.has(journey.slug))
        quadCache.current.set(journey.slug, createShaderQuad(gl, journey.previewShader))

      cancelAnimationFrame(rafRef.current)
      lastFrameRef.current = 0 // fresh delta — the canvas may have been parked for minutes
      rafRef.current       = requestAnimationFrame(renderLoop)
    },
    [ renderLoop ],
  )

  const deactivate = useCallback((slug: string) => {
    if (activeSlugRef.current !== slug)
      return // a newer card already took over
    cancelAnimationFrame(rafRef.current)
    activeSlugRef.current = null

    const host   = hostRef.current
    const canvas = canvasRef.current
    if (host && canvas)
      host.appendChild(canvas) // park canvas back off-screen
  }, [])

  const api = useMemo<PreviewAPI>(() => ({ activate, deactivate }), [ activate, deactivate ])

  return { hostRef, api }
}
