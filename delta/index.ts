// Δ — the asset library: real surfaces and real skies for the journeys that
// are meant to look like somewhere. A standalone module with no dependency on
// the app; imported everywhere as `Δ` (and `Δ/gl`, `Δ/glsl`, `Δ/manifest`).
//
//   manifest.ts  what the assets are (pure data, safe anywhere)
//   urls.ts      generated static imports — the bundler owns the files
//   gl.ts        WebGL2 loaders: texture arrays for materials, mipmapped skies
//   glsl.ts      GLSL ES 3.00 chunks that sample them
//   build.mjs    fetches everything from ambientCG and rebuilds the files

export * from './manifest'
export { MATERIAL_URLS, SKY_URLS } from './urls'
