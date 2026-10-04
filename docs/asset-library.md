# Δ — the asset library

`src/packages/delta` is a workspace package (`@wjh/delta`, its own `package.json`) holding
every surface and sky the journeys borrow from the real world: fourteen CC0
material sets and ten HDRI skies from [ambientCG](https://ambientcg.com), packed
for WebGL2.

* **Every map is used.** Each material set ships colour, displacement, normal,
  roughness, ambient occlusion and (for metals) metalness; `bun src/packages/delta/build.mjs`
  downloads them and packs three 512-px strips — colour; normal.xy + roughness;
  displacement + AO + metalness — one layer per material, uploaded as three
  `TEXTURE_2D_ARRAY`s. `@wjh/delta/glsl` samples all of them: normal mapping on a
  derivative-built tangent frame, GGX on the roughness, parallax occlusion on
  the displacement, AO on indirect light only, metalness into the Fresnel.
* **Skies are the HDRIs' tonemapped equirectangulars**, 2048×1024 JPEG, a tenth
  the size of the EXR and decoded natively; the highlight range is lifted back
  approximately in the shader, and irradiance comes from the mip chain. Each
  sky records where its sun is in the photograph, so a journey's light comes
  from where the picture says it does.
* **The files are static imports** (`src/packages/delta/urls.ts`, generated), so the bundler
  owns them: Next emits them hashed under `_next/static/media` with the basePath
  applied; bun's file loader does the same for the bare harness.
* **Loading is asynchronous and renderers cannot wait**, so every loader returns
  a one-texel placeholder at once and swaps the real texture in. A renderer may
  implement `ready()`; the frozen `?t=` path does not raise
  `data-journey-ready` until it is true, so no screenshot is of a placeholder.

`/assets` shows the lot: every material as a lit sphere you can strip down to any
one map, every sky as a slow pan, on one shared canvas.
