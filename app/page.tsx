import type { Metadata } from 'next';
import JourneyGrid from '@/components/JourneyGrid';
import SettingsButton from '@/components/SettingsButton';

export const metadata: Metadata = {
  title: 'webgl-journey-hell — index',
  description: 'An index of WebGL shader journeys into the abyss.',
};

export default function IndexPage() {
  return (
    <main className="index-page">
      <SettingsButton />
      <header className="index-header">
        <p className="index-sigil" aria-hidden>
          𖤐𖤐𖤐𖤐𖤐
        </p>
        <h1 className="index-title">[∳void ∂t]₂ ∩ [hell]ˣ ∉ [⦰∞]</h1>
        <p className="index-subtitle">
          shader journeys // select a descent
        </p>
      </header>

      <JourneyGrid />

      <footer className="index-footer">
        <span>{`// ${process.env.NODE_ENV === 'production' ? 'live' : 'dev'} — hover a tile to wake it`}</span>
      </footer>
    </main>
  );
}
