import type { NextConfig } from 'next'


// Single source of truth for the deployment sub-path. Next rewrites basePath
// into next/link, next/image and imported static assets automatically, but NOT
// into plain URL strings used at runtime (e.g. `new Image().src`), so it is
// also published as a public env var for lib/assetUrl.ts to prepend.
const basePath = '/webgl-journey-hell'

const nextConfig: NextConfig = {
  basePath,
  env:             { NEXT_PUBLIC_BASE_PATH: basePath },
  output:          'export',
  reactStrictMode: true,
  // Allow access to remote image placeholder.
  images:          {
    // Static export (output: 'export') ships no server to run the default image
    // optimizer, so next/image throws at runtime. Emit images unoptimized to make
    // next/image compatible with the export.
    unoptimized:    true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port:     '',
        pathname: '/**', // This allows any path under the hostname
      },
    ],
  },
}

export default nextConfig
