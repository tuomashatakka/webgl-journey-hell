import type { NextConfig } from 'next'
import pkg from './package.json'
import { CONFIG } from './src/packages/config/config'


const { basePath } = CONFIG.site

const nextConfig: NextConfig = {
  basePath,
  env:               { NEXT_PUBLIC_BASE_PATH: basePath },
  output:            'export',
  reactStrictMode:   true,

  // The workspace packages ship TypeScript source, not a build.
  transpilePackages: Object.keys(pkg.dependencies).filter(name => name.startsWith('@wjh/')),

  // Dev-only overlay, and it sits in the bottom-left corner — which is exactly
  // where tools/shoot-posters.mjs and `journey.mjs shot --hud=0` are trying to
  // capture a clean plate of the running route. Off, so a poster is the picture
  // and nothing else.
  devIndicators:     false,

  // Static export (output: 'export') ships no server to run the default image
  // optimizer, so next/image throws at runtime. Emit images unoptimized to make
  // next/image compatible with the export.
  images:            { unoptimized: true },
}

export default nextConfig
