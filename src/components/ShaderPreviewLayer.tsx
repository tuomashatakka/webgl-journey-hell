'use client'

// Owns the ONE shared WebGL canvas for the whole landing grid. Cards call
// activate()/deactivate() on hover/focus; the single canvas is moved into the
// hovered card's mount slot and renders that journey's previewShader. Programs
// are compiled once per journey and cached in the shared context, so switching
// previews is just a useProgram — never more than one GL context exists.

import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import { usePreviewCanvas } from '✦/hooks/use-preview-canvas'
import type { PreviewAPI } from '✦/hooks/use-preview-canvas'


const PreviewCtx = createContext<PreviewAPI | null>(null)

type PreviewProviderProps = { children: ReactNode }

/** Hook for cards to drive the shared preview. Null outside a PreviewProvider. */
export function usePreview (): PreviewAPI | null {
  return useContext(PreviewCtx)
}

export function PreviewProvider ({ children }: PreviewProviderProps) {
  const { hostRef, api } = usePreviewCanvas()

  return <PreviewCtx.Provider value={ api }>
    <div
      ref={ hostRef }
      style={{
        position:      'fixed',
        left:          -9999,
        top:           0,
        width:         1,
        height:        1,
        overflow:      'hidden',
        pointerEvents: 'none',
      }}
      aria-hidden />

    {children}
  </PreviewCtx.Provider>
}
