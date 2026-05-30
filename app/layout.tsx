import type {Metadata} from 'next';
import './globals.css'; // Global styles
import { SettingsProvider } from '@/components/SettingsProvider';

export const metadata: Metadata = {
  title: 'webgl-journey-hell',
  description: 'An index of WebGL shader journeys into the abyss.',
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        {/* App-wide graphics settings + shared frame loop (see components/SettingsProvider). */}
        <SettingsProvider>{children}</SettingsProvider>
      </body>
    </html>
  );
}
