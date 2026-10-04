'use client'

import { useEffect, useRef } from 'react'


/**
 * Mirror a changing value into a ref. The journey engine is created once and
 * must not be rebuilt when settings change; it reads them through the ref.
 */
export default function useLatestRef<T> (value: T): React.RefObject<T> {
  const ref = useRef(value)
  useEffect(() => {
    ref.current = value
  }, [ value ])
  return ref
}
