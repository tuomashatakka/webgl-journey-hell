'use client';

import { JOURNEYS } from '@/app/journeys/registry';
import { PreviewProvider } from './ShaderPreviewLayer';
import JourneyCard from './JourneyCard';

export default function JourneyGrid() {
  return (
    <PreviewProvider>
      <div className="journey-grid">
        {JOURNEYS.map((journey) => (
          <JourneyCard key={journey.slug} journey={journey} />
        ))}
      </div>
    </PreviewProvider>
  );
}
