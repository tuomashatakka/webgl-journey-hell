import { CONFIG } from '@wjh/config/config'
import type { Metadata } from 'next'
import './styles/base.css'
import './styles/debug.css'
import './styles/settings.css'
import './styles/index.css'
import './styles/toolbar.css'
import './styles/transport.css'
import './styles/assets.css'
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
