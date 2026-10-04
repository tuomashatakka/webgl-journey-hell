import { useEffect, useState } from 'react'
import useLatestRef from './use-latest-ref'


/** Sample a getter on a slow interval: for readouts a frame loop must not re-render per frame. */
export function useSampled<T> (read: () => T, everyMs: number): T | null {
  const [ value, setValue ] = useState<T | null>(null)
  const readRef             = useLatestRef(read)

  useEffect(() => {
    const tick = () => setValue(readRef.current())
    tick()

    const id = window.setInterval(tick, everyMs)
    return () => window.clearInterval(id)
  }, [ readRef, everyMs ])

  return value
}
