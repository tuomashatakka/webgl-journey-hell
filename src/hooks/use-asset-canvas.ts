import { useCallback, useEffect, useRef } from 'react'
import { startAssetBrowser } from '@wjh/delta/browser'
import type { AssetSlot, AssetView } from '@wjh/delta/browser'
import useLatestRef from './use-latest-ref'


/** One shared canvas for the asset page; cards register the element each slot is scissored to. */
export function useAssetCanvas (mode: AssetView['mode'], light: string) {
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
