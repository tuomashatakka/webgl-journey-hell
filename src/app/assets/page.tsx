import type { Metadata } from 'next'
import AssetBrowser from '✦/components/AssetBrowser'


export const metadata: Metadata = {
  title:       'webgl-journey-hell — Δ assets',
  description: 'Every material and sky the journeys borrow from the real world: CC0 scans from ambientCG.',
}

export default function AssetsPage () {
  return <AssetBrowser />
}
