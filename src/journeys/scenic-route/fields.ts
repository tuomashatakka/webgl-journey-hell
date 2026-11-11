// THE SCENIC ROUTE — the fields.
//
// The valley is farmed: a patchwork of fields on a rotated grid, columns of
// one width cut into rows of their own heights, every border wobbled so the
// lines read as hedges that grew rather than as a survey. The layout is one
// function, written twice from the same constants: once here for the CPU,
// which lays the hedgerow geometry along the borders (props.ts), and once in
// GLSL for the terrain, which paints the crops between them (shader/world.ts).
// The hash is the same arithmetic in both and only ever sees small integers,
// so the two agree to well under a centimetre on where a border runs.
//
// Farmland is gentle ground on the valley side of the ridge, below the
// heath; `farmWeight` is that mask, shared the same way.

import { smoothstep } from '@wjh/math/scalar'

/** Rotation of the field grid against the world axes, radians. */
const FIELD_ROT = 0.38

/** Width of a column of fields, metres. */
const FIELD_W = 88

/** Row heights within a column run from this... */
const ROW_MIN = 55

/** ...to this much more. */
const ROW_SPAN = 75

/** Amplitude and frequency of the column borders' wobble. */
const WOB_U  = 6
const WOB_UK = 0.021

/** Amplitude and frequency of the row borders' wobble. */
const WOB_V  = 9
const WOB_VK = 0.017

/** Farmland stops climbing here (world y), and stops east of here (world x). */
const FARM_TOP  = 62
const FARM_EAST = 320

const COS = Math.cos(FIELD_ROT)
const SIN = Math.sin(FIELD_ROT)

/** The same layout and mask for the terrain's fragment shader. */
export const fieldsChunk = /* glsl */`
float fieldHash (float n) {
  float p = fract(n * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
float farmWeight (vec3 p, float ny) {
  return (1.0 - smoothstep(${(FARM_TOP - 32).toFixed(1)}, ${FARM_TOP.toFixed(1)}, p.y)) * smoothstep(0.9, 0.965, ny)
       * (1.0 - smoothstep(${(FARM_EAST - 90).toFixed(1)}, ${FARM_EAST.toFixed(1)}, p.x));
}
// x, y: the field's id (column, row). z: distance to its nearest border, in
// metres. w: which way it is worked, a coordinate along its furrows.
vec4 fieldAt (vec2 xz) {
  const float C = ${COS.toFixed(8)};
  const float S = ${SIN.toFixed(8)};
  float u   = C * xz.x + S * xz.y;
  float v   = -S * xz.x + C * xz.y;
  float uw  = u + ${WOB_U.toFixed(1)} * sin(v * ${WOB_UK} + 1.3);
  float col = floor(uw / ${FIELD_W.toFixed(1)});
  float h   = ${ROW_MIN.toFixed(1)} + ${ROW_SPAN.toFixed(1)} * fieldHash(col);
  float off = fieldHash(col + 31.7) * h;
  float vw  = v + off + ${WOB_V.toFixed(1)} * sin(uw * ${WOB_VK} + col);
  float row = floor(vw / h);
  float fu  = uw - col * ${FIELD_W.toFixed(1)};
  float fv  = vw - row * h;
  float edge = min(min(fu, ${FIELD_W.toFixed(1)} - fu), min(fv, h - fv));
  float along = fieldHash(col * 7.3 + row * 13.1 + 2.0) < 0.5 ? u : v;
  return vec4(col, row, edge, along);
}
`

function fract (x: number): number {
  return x - Math.floor(x)
}

/** The fields' hash: small-integer input, the same arithmetic as the GLSL. */
function fieldHash (n: number): number {
  let p = fract(n * 0.1031)
  p *= p + 33.33
  p *= p + p
  return fract(p)
}

function rowHeight (col: number): number {
  return ROW_MIN + ROW_SPAN * fieldHash(col)
}

function rowOffset (col: number): number {
  return fieldHash(col + 31.7) * rowHeight(col)
}

/** 0..1, how much of (x, z) at height y with up-normal ny is farmland. */
export function farmWeight (x: number, y: number, ny: number): number {
  return smoothstep(FARM_TOP, FARM_TOP - 32, y) * smoothstep(0.9, 0.965, ny) * (1 - smoothstep(FARM_EAST - 90, FARM_EAST, x))
}

function toWorld (u: number, v: number): [ number, number ] {
  return [ COS * u - SIN * v, SIN * u + COS * v ]
}

/**
 * Every field border crossing the box, as polylines in world (x, z) sampled
 * every `step` metres. Each polyline is one border of one column: the column's
 * western edge, or the edge between two of its rows.
 */
export function fieldBorders (x0: number, z0: number, x1: number, z1: number, step: number): number[][] {
  // The box's extent in the rotated frame, padded by the wobble.
  const corners = [[ x0, z0 ], [ x1, z0 ], [ x0, z1 ], [ x1, z1 ]]
  let u0 = Infinity
  let u1 = -Infinity
  let v0 = Infinity
  let v1 = -Infinity
  for (const [ x, z ] of corners) {
    const u = COS * x + SIN * z
    const v = -SIN * x + COS * z
    u0 = Math.min(u0, u)
    u1 = Math.max(u1, u)
    v0 = Math.min(v0, v)
    v1 = Math.max(v1, v)
  }

  const inBox           = (x: number, z: number) => x >= x0 && x <= x1 && z >= z0 && z <= z1
  const out: number[][] = []
  const push            = (line: number[]) => {
    if (line.length >= 4)
      out.push(line)
  }

  const c0 = Math.floor((u0 - WOB_U) / FIELD_W)
  const c1 = Math.ceil((u1 + WOB_U) / FIELD_W)
  for (let col = c0; col <= c1; col++) {
    // The column's western border: wobbled u is col * W, so the raw u is
    // that less the wobble at each v.
    let line: number[] = []
    for (let v = v0; v <= v1; v += step) {
      const u        = col * FIELD_W - WOB_U * Math.sin(v * WOB_UK + 1.3)
      const [ x, z ] = toWorld(u, v)
      if (inBox(x, z))
        line.push(x, z)
      else {
        push(line)
        line = []
      }
    }
    push(line)

    // The rows' borders inside the column: parametrised by the wobbled u
    // across the column, the row border's v follows, and the raw u is the
    // wobbled one less its wobble at that v.
    const h   = rowHeight(col)
    const off = rowOffset(col)
    const r0  = Math.floor((v0 + off - WOB_V) / h)
    const r1  = Math.ceil((v1 + off + WOB_V) / h)
    for (let row = r0; row <= r1; row++) {
      line = []
      for (let uw = col * FIELD_W; uw <= (col + 1) * FIELD_W; uw += step) {
        const v        = row * h - off - WOB_V * Math.sin(uw * WOB_VK + col)
        const u        = uw - WOB_U * Math.sin(v * WOB_UK + 1.3)
        const [ x, z ] = toWorld(u, v)
        if (inBox(x, z))
          line.push(x, z)
        else {
          push(line)
          line = []
        }
      }
      push(line)
    }
  }
  return out
}
