import type { Metadata } from 'next'
import Link from 'next/link'
import CrtIndex from '✦/components/CrtIndex'
import SettingsButton from '✦/components/SettingsButton'


export const metadata: Metadata = {
  title:       'webgl-journey-hell — index',
  description: 'An index of WebGL shader journeys into the abyss.',
}

export default function IndexPage () {
  return <main className="index-page">
    <header className="index-header">
      <p className="index-sigil" aria-hidden>
        𖤐𖤐𖤐𖤐𖤐
      </p>

      <h1 className="index-title">[∳void ∂t]₂ ∩ [hell]ˣ ∉ [⦰∞]</h1>

      <p className="index-subtitle">
        shader journeys // select a descent
      </p>

      <p className="index-assets-link">
        <Link href="/assets">Δ the asset library →</Link>
      </p>
    </header>

    <CrtIndex />

    <footer className="index-footer">
      <span>{`// ${process.env.NODE_ENV === 'production' ? 'live' : 'dev'} — ◀ ▶ change the channel · M the menu · enter goes in`}</span>
      <SettingsButton side="top" />
    </footer>
  </main>
}
