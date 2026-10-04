// Turn an asset reference into a URL fit for a runtime request.
//
// The app is deployed under a sub-path (next.config.ts `basePath`, for GitHub
// Pages). Next applies that prefix to next/link, next/image and imported static
// assets, but a plain string handed to `new Image().src`, `fetch()` or a CSS
// `url()` is left alone — so `/journeys/x.png` 404s in every environment where
// basePath is non-empty. Route every such URL through this helper.

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

/**
 * Prefix a root-relative path with the deployment basePath.
 *
 * Absolute URLs, data/blob URIs and paths that already carry the prefix are
 * returned untouched, so this is safe to apply at a shared boundary where the
 * caller's URL form isn't known.
 */
function assetUrl (path: string): string {
  if (!BASE_PATH)
    return path
  if (!path.startsWith('/'))
    return path // relative or scheme-qualified
  if (path.startsWith('//'))
    return path // protocol-relative
  if (path === BASE_PATH || path.startsWith(`${BASE_PATH}/`))
    return path
  return BASE_PATH + path
}

/**
 * The URL of an imported static file. The bundler owns the file: under Next an
 * import is a StaticImageData whose `src` already carries the basePath, under
 * bun's file loader (the bare harness) it is the URL string itself. Either way
 * this returns a URL that is safe to hand to a runtime request.
 */
export function staticUrl (imported: string | { src: string }): string {
  return assetUrl(typeof imported === 'string' ? imported : imported.src)
}
