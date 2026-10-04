import { MAT } from '@wjh/delta/manifest'

// --- surfaces ----------------------------------------------------------------

/** How the fragment shader treats a draw. Mirrored as `MODE_*` in shader.ts. */
const enum Mode {
  TEXTURED = 0,
  PAINT = 1,
  EMISSIVE = 2,
  WINDOWS = 3,
  RACK = 4,
  CARRIAGE = 5,
  SIGNAL = 6,
  POSTER = 7,
  RAIL = 8,
}

export interface Surface {

  /** Δ material layer, or -1 for flat paint. */
  layer: number;

  /** Albedo multiplier (linear), or the paint colour. */
  tint: [ number, number, number ];

  /** Roughness multiplier for a layer, absolute roughness for paint. */
  rough: number;
  metal: number;
  mode:  Mode;

  /** Self-illumination, linear HDR. */
  glow: [ number, number, number ];

  /** Parallax occlusion on this surface. Off for anything thin or far. */
  pom: boolean;
}

const tex = (layer: number, tint: [ number, number, number ] = [ 1, 1, 1 ], o: Partial<Surface> = {}): Surface =>
  ({ layer, tint, rough: 1, metal: 0, mode: Mode.TEXTURED, glow: [ 0, 0, 0 ], pom: true, ...o })

const paint = (tint: [ number, number, number ], rough = 0.6, o: Partial<Surface> = {}): Surface =>
  ({ layer: -1, tint, rough, metal: 0, mode: Mode.PAINT, glow: [ 0, 0, 0 ], pom: false, ...o })

const glow = (c: [ number, number, number ], mode = Mode.EMISSIVE): Surface =>
  ({ layer: -1, tint: [ 0.9, 0.9, 0.9 ], rough: 0.3, metal: 0, mode, glow: c, pom: false })

/** Every surface on the line, by name. Profiles and props refer to these keys. */
export const SURF = {
  tile:        tex(MAT.TILE, [ 0.96, 0.92, 0.82 ]),
  tileGreen:   tex(MAT.TILE, [ 0.55, 0.72, 0.62 ]),
  floor:       tex(MAT.FLOOR, [ 0.78, 0.76, 0.72 ]),
  terrazzo:    tex(MAT.TERRAZZO, [ 0.86, 0.84, 0.8 ]),
  panel:       tex(MAT.PANEL, [ 0.9, 0.9, 0.88 ]),
  panelDark:   tex(MAT.PANEL, [ 0.42, 0.42, 0.42 ]),
  concrete:    tex(MAT.CONCRETE, [ 0.85, 0.84, 0.82 ]),
  concreteDim: tex(MAT.CONCRETE, [ 0.48, 0.47, 0.45 ]),
  concreteWet: tex(MAT.CONCRETE, [ 0.3, 0.31, 0.3 ], { rough: 0.35 }),
  brick:       tex(MAT.BRICK, [ 0.92, 0.84, 0.8 ]),
  brickSoot:   tex(MAT.BRICK, [ 0.36, 0.32, 0.3 ], { rough: 0.8 }),
  ballast:     tex(MAT.BALLAST, [ 0.72, 0.7, 0.68 ]),
  ballastDark: tex(MAT.BALLAST, [ 0.34, 0.33, 0.32 ]),
  ballastWet:  tex(MAT.BALLAST, [ 0.22, 0.22, 0.22 ], { rough: 0.45 }),
  steel:       tex(MAT.STEEL, [ 0.62, 0.62, 0.64 ], { pom: false }),
  lining:      tex(MAT.STEEL, [ 0.3, 0.29, 0.28 ], { rough: 1.1 }),
  corrugated:  tex(MAT.CORRUGATED, [ 0.75, 0.78, 0.8 ]),
  corrugRust:  tex(MAT.CORRUGATED, [ 0.62, 0.48, 0.4 ]),
  wood:        tex(MAT.WOOD, [ 0.55, 0.48, 0.42 ], { pom: false }),
  rock:        tex(MAT.ROCK, [ 0.62, 0.6, 0.58 ]),
  plaster:     tex(MAT.PLASTER, [ 0.88, 0.86, 0.82 ]),
  plasterDamp: tex(MAT.PLASTER, [ 0.55, 0.62, 0.58 ]),
  hazard:      tex(MAT.HAZARD, [ 1, 1, 1 ], { pom: false }),
  dirt:        tex(MAT.DIRT, [ 0.8, 0.78, 0.74 ]),
  coping:      tex(MAT.CONCRETE, [ 1.1, 1.08, 1.04 ], { pom: false }),

  void:      paint([ 0, 0, 0 ], 1),
  yellow:    paint([ 0.8, 0.56, 0.04 ], 0.55),
  white:     paint([ 0.86, 0.86, 0.84 ], 0.45),
  black:     paint([ 0.018, 0.018, 0.02 ], 0.55),
  darkGrey:  paint([ 0.06, 0.06, 0.065 ], 0.5),
  green:     paint([ 0.04, 0.16, 0.08 ], 0.5),
  red:       paint([ 0.62, 0.04, 0.03 ], 0.45),
  blue:      paint([ 0.02, 0.06, 0.32 ], 0.45),
  greyPaint: paint([ 0.3, 0.31, 0.32 ], 0.5, { metal: 0.3 }),
  cream:     paint([ 0.72, 0.68, 0.58 ], 0.7),

  rail:   { ...tex(MAT.STEEL, [ 0.55, 0.5, 0.46 ], { pom: false }), mode: Mode.RAIL },
  poster: { ...paint([ 1, 1, 1 ], 0.35), mode: Mode.POSTER },

  fluoro:       glow([ 5.5, 5.3, 4.8 ]),
  sodium:       glow([ 9, 4.6, 1.4 ]),
  bulb:         glow([ 7, 4.6, 2.2 ]),
  cold:         glow([ 2.4, 3.6, 6 ]),
  greenTube:    glow([ 3, 5.2, 4.2 ]),
  redLamp:      glow([ 8, 0.7, 0.4 ], Mode.SIGNAL),
  signal:       glow([ 1, 1, 1 ], Mode.SIGNAL),
  sign:         glow([ 2, 2, 2 ]),
  windows:      { ...tex(MAT.PANEL, [ 0.42, 0.4, 0.38 ], { pom: false }), mode: Mode.WINDOWS },
  windowsBrick: { ...tex(MAT.BRICK, [ 0.4, 0.33, 0.3 ], { pom: false }), mode: Mode.WINDOWS },
  rack:         { ...tex(MAT.STEEL, [ 0.1, 0.1, 0.11 ], { pom: false }), mode: Mode.RACK },
  carriage:     { ...paint([ 0.55, 0.56, 0.58 ], 0.4, { metal: 0.4 }), mode: Mode.CARRIAGE },
} satisfies Record<string, Surface>

export type SurfaceKey = keyof typeof SURF
