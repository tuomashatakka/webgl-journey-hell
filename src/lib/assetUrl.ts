// Resolve a /public asset path for use in a runtime request.
//
// The app is deployed under a sub-path (next.config.ts `basePath`, for GitHub
// Pages). Next applies that prefix to next/link, next/image and imported static
// assets, but a plain string handed to `new Image().src`, `fetch()` or a CSS
// `url()` is left alone — so `/journeys/x.png` 404s in every environment where
// basePath is non-empty. Route every such URL through this helper.

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

/**
 * Prefix a root-relative public path with the deployment basePath.
 *
 * Absolute URLs, data/blob URIs and paths that already carry the prefix are
 * returned untouched, so this is safe to apply at a shared boundary where the
 * caller's URL form isn't known.
 */
export function assetUrl (path: string): string {
  if (!BASE_PATH) return path
  if (!path.startsWith('/')) return path // relative or scheme-qualified
  if (path.startsWith('//')) return path // protocol-relative
  if (path === BASE_PATH || path.startsWith(`${BASE_PATH}/`)) return path
  return BASE_PATH + path
}
