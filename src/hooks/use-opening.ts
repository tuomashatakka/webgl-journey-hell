import { useEffect, useState } from 'react'
import { CONFIG } from '@wjh/config/config'
import type { JourneyLoading } from '@wjh/journey/engine'


interface OpeningInput {
  staged:       boolean
  hasCard:      boolean
  loading:      JourneyLoading
  sectionKey:   number
  sectionNamed: boolean
}

/**
 * The page's three opening beats as flags: the loading bar, the title card, then
 * a heading for every section change. The bar fades as the card comes up under
 * it, then goes entirely; each beat reports back when it has played out.
 */
export function useOpening ({ staged, hasCard, loading, sectionKey, sectionNamed }: OpeningInput) {
  const [ loaderGone, setLoaderGone ]   = useState(false)
  const [ introDone, setIntroDone ]     = useState(false)
  const [ headingDone, setHeadingDone ] = useState(-1)

  useEffect(() => {
    if (!loading.done)
      return

    const timer = setTimeout(() => setLoaderGone(true), CONFIG.ui.loaderFadeMs)
    return () => clearTimeout(timer)
  }, [ loading.done ])

  const opened = loading.done && (introDone || !staged || !hasCard)

  return {
    opened,
    showLoader:    staged && !loaderGone,
    showIntro:     staged && loading.done && !introDone && hasCard,
    showHeading:   staged && opened && sectionNamed && headingDone !== sectionKey,
    finishIntro:   () => setIntroDone(true),
    finishHeading: () => setHeadingDone(sectionKey),
  }
}
