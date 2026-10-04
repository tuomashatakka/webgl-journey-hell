import { useSyncExternalStore } from 'react'


const subscribe = () => () => undefined

/** False in the prerender and on the first client render, true afterwards: for client-only facts. */
export function useMounted (): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false)
}
