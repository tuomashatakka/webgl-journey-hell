import type { NextConfig } from 'next'


const nextConfig: NextConfig = {
  basePath:        '/webgl-journey-hell',
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
