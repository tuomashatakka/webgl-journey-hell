// Δ — the asset manifest. Pure data: no imports, no GL, no DOM.
//
// Everything visual the journeys borrow from the real world is listed here,
// and only here. `delta/build.mjs` reads this table to fetch and pack the
// files; the shaders read it (through `MATERIAL_GLSL`) to know which layer is
// which; the asset page reads it to show them. One table, so the three cannot
// disagree.
//
// Every asset is a CC0 scan from ambientCG (https://ambientcg.com). CC0 asks
// for nothing; the asset ids are kept so each one can be traced to its source.

export interface MaterialAsset {

  /** Stable name. Becomes `MAT_<ID>` in GLSL. Append-only: it is also the layer index. */
  id: string;

  /** ambientCG asset id. */
  asset: string;

  /** Human label for the asset page. */
  label: string;

  /** Physical width of one repeat, metres. Shaders divide world UVs by this. */
  metres: number;

  /**
   * Relief depth of the displacement map, metres, at full scale. Drives
   * parallax occlusion in the rasterized journeys and the height blend in the
   * raymarched one. Zero for a surface that is flat in reality.
   */
  depth: number;
}

/**
 * The material layers, in strip order. Three strips are built from each
 * ambientCG set — every map it ships is used:
 *
 *   color.jpg    Color                                   sRGB
 *   normal.jpg   NormalGL.r, NormalGL.g, Roughness       linear
 *   detail.jpg   Displacement, AmbientOcclusion, Metalness   linear
 *
 * A set without AO gets white there, one without metalness gets black.
 */
export const MATERIALS: readonly MaterialAsset[] = [
  { id: 'TILE', asset: 'Tiles010', label: 'subway tile', metres: 1.0, depth: 0.012 },
  { id: 'FLOOR', asset: 'Tiles141', label: 'quarry floor tile', metres: 2.0, depth: 0.008 },
  { id: 'TERRAZZO', asset: 'Terrazzo005', label: 'terrazzo', metres: 1.2, depth: 0.002 },
  { id: 'PANEL', asset: 'Concrete031', label: 'shuttered concrete', metres: 2.6, depth: 0.03 },
  { id: 'CONCRETE', asset: 'Concrete044D', label: 'spalled concrete', metres: 3.0, depth: 0.04 },
  { id: 'BRICK', asset: 'Bricks097', label: 'engineering brick', metres: 1.4, depth: 0.03 },
  { id: 'BALLAST', asset: 'Gravel023', label: 'track ballast', metres: 1.5, depth: 0.06 },
  { id: 'STEEL', asset: 'Metal024', label: 'weathered steel', metres: 2.0, depth: 0.004 },
  { id: 'CORRUGATED', asset: 'CorrugatedSteel005', label: 'corrugated sheet', metres: 1.6, depth: 0.03 },
  { id: 'WOOD', asset: 'Wood035', label: 'creosoted timber', metres: 1.4, depth: 0.01 },
  { id: 'ROCK', asset: 'Rock051', label: 'stratified rock', metres: 5.0, depth: 0.25 },
  { id: 'PLASTER', asset: 'PaintedPlaster016', label: 'failed plaster', metres: 2.4, depth: 0.02 },
  { id: 'HAZARD', asset: 'PaintedMetal016', label: 'hazard plate', metres: 0.9, depth: 0.003 },
  { id: 'DIRT', asset: 'Ground110', label: 'spoil', metres: 2.1, depth: 0.08 },
]

export interface SkyAsset {

  /** Stable name, used by the journeys to ask for a sky. */
  id: string;

  /** ambientCG HDRI id. Only the tonemapped equirectangular JPEG is shipped. */
  asset: string;
  label: string;

  /**
   * Linear multiplier from the tonemapped JPEG back to scene radiance. The
   * JPEG is display-referred; a journey's lighting is not. Picked per sky so a
   * night sky is dim and a hazy noon is bright without every shader having to
   * know which is which.
   */
  exposure: number;

  /**
   * Where the sun (or moon) is in the map, as (u, v) — measured from the
   * brightest region of the image. A journey turns this into a light direction
   * with `sunDirection`, so the light that falls on a wall comes from where the
   * photograph says it does.
   */
  sun?: [ number, number ];
}

/**
 * Sky maps. The B variants of ambientCG's sky series are sky-only, with an
 * empty lower hemisphere, which is what a journey with its own ground wants.
 * Why tonemapped JPEG and not the EXR: the EXR is 3.5 MB at 2K and needs a
 * PIZ decoder in the page; the JPEG is a tenth of that and decodes natively.
 * The lost highlight range is put back approximately in the shader
 * (`skyRadiance`), which is enough for a sky that is mostly cloud.
 */
export const SKIES: readonly SkyAsset[] = [
  { id: 'DAY', asset: 'DaySkyHDRI070B', label: 'cumulus noon', exposure: 1.6, sun: [ 0.50, 0.33 ]},
  { id: 'HAZE', asset: 'DaySkyHDRI071B', label: 'hazy noon', exposure: 1.5, sun: [ 0.49, 0.30 ]},
  { id: 'DUSK', asset: 'EveningSkyHDRI046B', label: 'pink dusk', exposure: 0.9, sun: [ 0.49, 0.48 ]},
  { id: 'OVERCAST', asset: 'EveningSkyHDRI045B', label: 'grey front', exposure: 0.8, sun: [ 0.50, 0.47 ]},
  { id: 'EVENING', asset: 'EveningSkyHDRI047B', label: 'pale evening', exposure: 1.0, sun: [ 0.33, 0.36 ]},
  { id: 'DAWN', asset: 'MorningSkyHDRI011B', label: 'cold dawn', exposure: 1.0, sun: [ 0.50, 0.48 ]},
  { id: 'FOG', asset: 'MorningSkyHDRI007B', label: 'fog morning', exposure: 1.1, sun: [ 0.52, 0.45 ]},
  { id: 'NIGHT', asset: 'NightSkyHDRI003', label: 'moonlit night', exposure: 0.35, sun: [ 0.49, 0.23 ]},
  { id: 'DEEP', asset: 'NightSkyHDRI008', label: 'deep field', exposure: 0.25 },
  { id: 'AURORA', asset: 'NightSkyHDRI007', label: 'aurora', exposure: 0.45 },
]

/** Pixel size of one material layer. Strips are this wide and N times as tall. */
export const MATERIAL_SIZE = 512

/** Sky maps are 2:1 equirectangular at this width. */
export const SKY_WIDTH = 2048

/** Layer index by id. */
export const MAT: Readonly<Record<string, number>> = Object.fromEntries(
  MATERIALS.map((m, i) => [ m.id, i ]),
)


/**
 * The light direction for a sky's sun, given the yaw the journey samples the
 * map with. Must agree with `equirectUv` in glsl.ts: u = atan(z, x)/2π + ½ + yaw,
 * v = acos(y)/π.
 */
export function sunDirection (sky: SkyAsset, yaw: number): [ number, number, number ] {
  const [ u, v ] = sky.sun ?? [ 0.5, 0.25 ]
  const phi      = (u - 0.5 - yaw) * Math.PI * 2
  const theta    = v * Math.PI
  return [ Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi) ]
}

export function skyAsset (id: string): SkyAsset {
  const sky = SKIES.find(s => s.id === id)
  if (!sky)
    throw new Error(`Δ: no sky "${id}"`)
  return sky
}
