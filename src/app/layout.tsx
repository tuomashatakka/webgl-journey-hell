import { CONFIG } from '@wjh/config/config'
import type { Metadata } from 'next'
import './globals.css' // Global styles
import { SettingsProvider } from '✦/components/SettingsProvider'


export const metadata: Metadata = {
  title:       CONFIG.site.title,
  description: CONFIG.site.description,
}

type RootLayoutProps = { children: React.ReactNode }

export default function RootLayout ({ children }: RootLayoutProps) {
  return <html lang="en">
    <body suppressHydrationWarning>
      {/* App-wide graphics settings + shared frame loop (see components/SettingsProvider). */}
      <SettingsProvider>{children}</SettingsProvider>
    </body>
  </html>
}
