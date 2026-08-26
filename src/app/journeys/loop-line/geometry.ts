// THE LOOP LINE — the world, as triangles.
//
// Everything here runs once, at construction, on the CPU. Nothing in this file
// is touched again for the rest of the ride: the world does not rebuild when it
// breaks, it is displaced in the vertex shader from buffers that were uploaded
// on the first frame and never re-sent. That is the whole economy of the
// journey, and it is why the frame does not get more expensive as the line
// falls apart.
//
// ---------------------------------------------------------------------------
// Sweeping a profile
// ---------------------------------------------------------------------------
//
// Almost every surface on the circuit is the same operation: take a 2D
// cross-section, drawn in (right, up) as if you were looking down the track,
// and drag it along an arc-length span of the curve. A tiled station bore, an
// open trench, a bare trestle deck and a brick tunnel differ only in the
// polyline you hand it.
//
// Two details matter and neither is obvious:
//
//   * **The profile is swept along the parallel-transported frame**, not a
//     Frenet frame. Frenet's normal flips through an inflection, which would
//     turn a tunnel inside out mid-straight. lib/curve already solves this and
//     even cancels the loop's residual twist, so a swept shell closes on itself
//     exactly at the lap seam.
//   * **The sweep step is arc length, not parameter.** A fixed parameter step
//     puts rings closer together where the spline happens to be slow, which
//     shows up as visibly uneven tiling on the straights.
//
// Winding is the other trap. A tunnel is seen from the *inside*, so its
// triangles must wind the opposite way from a solid object's or backface
// culling removes exactly the surfaces you are standing in. `sweepProfile`
// takes a `facing` flag rather than leaving that to the caller to get wrong
// once per bay.
//
// ---------------------------------------------------------------------------
// Why props are unit meshes
// ---------------------------------------------------------------------------
//
// Every repeated object — sleeper, lamp housing, bench, rack, stanchion — is
// built ONCE at the origin, in its own coordinates, and placed by the instance
// buffer. A bay with 300 sleepers is one draw call and one 9.6 kB instance
// upload, not 300 of anything. It also means a prop's fracture cells are
// computed once in its own frame, so the same shard pattern is shared by every
// copy — which sounds like it would read as repetition and does not, because
// the instances are rotated differently and lit differently.

import { createMeshBuilder, fracture } from '@/lib/mesh'
import type { MeshBuilder } from '@/lib/mesh'
import { mulberry32 } from '@/lib/rng'
import type { ClosedCurve, Frame } from '@/lib/curve'
import { OPEN, Theme } from './stations'
import type { Bay, BaySpan } from './stations'


/** A cross-section, in metres, as (right, up) pairs looking down the track. */
export type Profile = [number, number][]

export const enum Facing {

  /** Seen from outside — a deck, a solid. */
  OUT = 0,

  /** Seen from inside — a bore, a room. */
  IN = 1,
}

/**
 * Drag `profile` along `curve` from arc length s0 to s1, emitting a quad strip
 * per profile edge. `closed` joins the last profile point back to the first,
 * which is what makes a bore a bore rather than three walls and a draught.
 */
export function sweepProfile (
  b: MeshBuilder,
  curve: ClosedCurve,
  s0: number,
  s1: number,
  step: number,
  profile: Profile,
  closed: boolean,
  facing: Facing,
): void {
  const rings        = Math.max(2, Math.ceil((s1 - s0) / step))
  const frame: Frame = {
    pos:     { x: 0, y: 0, z: 0 },
    forward: { x: 0, y: 0, z: 1 },
    up:      { x: 0, y: 1, z: 0 },
    right:   { x: 1, y: 0, z: 0 },
  }

  // One ring of world-space points per station along the span.
  const pts: number[][] = []
  const vs: number[]    = []
  for (let i = 0; i <= rings; i++) {
    const s = s0 + (s1 - s0) * (i / rings)
    curve.frameAtDistance(s, frame)

    const ring: number[] = []
    for (const [ r, u ] of profile)
      ring.push(
        frame.pos.x + frame.right.x * r + frame.up.x * u,
        frame.pos.y + frame.right.y * r + frame.up.y * u,
        frame.pos.z + frame.right.z * r + frame.up.z * u,
      )
    pts.push(ring)
    vs.push(s)
  }

  const edges = closed ? profile.length : profile.length - 1
  for (let i = 0; i < rings; i++) {
    const a = pts[i]
    const c = pts[i + 1]
    // Tile the texture in metres so tiling is consistent between a 9 m bore and
    // a 14 m one — a per-ring 0..1 would stretch the big room's tiles.
    const va = vs[i] * 0.5
    const vb = vs[i + 1] * 0.5

    for (let e = 0; e < edges; e++) {
      const j  = e
      const k  = (e + 1) % profile.length
      const ua = e * 0.5
      const ub = (e + 1) * 0.5

      const p0 = [ a[j * 3], a[j * 3 + 1], a[j * 3 + 2], ua, va ]
      const p1 = [ a[k * 3], a[k * 3 + 1], a[k * 3 + 2], ub, va ]
      const p2 = [ c[k * 3], c[k * 3 + 1], c[k * 3 + 2], ub, vb ]
      const p3 = [ c[j * 3], c[j * 3 + 1], c[j * 3 + 2], ua, vb ]

      // Which way round these go decides whether you are standing in a room or
      // looking at the outside of a box you cannot enter. A profile traced
      // left-to-right along the floor and back along the ceiling, swept forward,
      // produces quads whose front faces point AWAY from the axis — correct for
      // a solid, inside-out for a bore — so the interior case is the flipped one.
      if (facing === Facing.IN)
        b.quad(p0, p1, p2, p3)
      else
        b.quad(p3, p2, p1, p0)
    }
  }
}

/**
 * The cross-section of a bay. This is where a room's character is decided: a
 * station is a wide flat-floored box with a platform lip on one side, a trench
 * has battered walls and no roof at all, and a trestle is a deck three metres
 * wide over nothing.
 */
type ProfileForReturnType = { profile: Profile; closed: boolean; facing: Facing }

export function profileFor (bay: Bay): ProfileForReturnType {
  const w = bay.bore === OPEN ? 4.2 : bay.bore
  const d = bay.floorD
  const h = bay.ceilH

  switch (bay.theme) {
    case Theme.CUT:
      // An open trench: floor, then walls battered outward, ending in air.
      return {
        profile: [
          [ -w * 2.2, d * 2.4 ], [ -w * 1.5, -d ], [ w * 1.5, -d ], [ w * 2.2, d * 2.4 ],
        ],
        closed: false,
        facing: Facing.IN,
      }
    case Theme.TRESTLE:
      // A deck and nothing else. Seen from above and below, so it is a closed
      // thin slab rather than a plane — a plane vanishes when you bank.
      return {
        profile: [
          [ -w, -d * 0.02 ], [ w, -d * 0.02 ], [ w, -d * 0.02 - 0.5 ], [ -w, -d * 0.02 - 0.5 ],
        ],
        closed: true,
        facing: Facing.OUT,
      }
    case Theme.TILE:
      // A station box with a raised platform along the right-hand side, which
      // is what makes it read as a place a person could stand.
      //
      // The order of these points is the whole content of the room, and getting
      // it wrong is not a subtle failure: trace the platform riser outward
      // before coming back inward to climb the wall and you build an interior
      // wall standing in front of the platform, hiding the thing the bay is
      // named for. Walk the section the way a wheel would: left wall foot,
      // across the floor, up the riser, out across the platform, up the far
      // wall, back along the ceiling.
      return {
        profile: [
          [ -w, -d ],
          [ w * 0.72, -d ],
          [ w * 0.72, -d + 1.0 ],
          [ w, -d + 1.0 ],
          [ w, h ],
          [ -w, h ],
        ],
        closed: true,
        facing: Facing.IN,
      }
    case Theme.VAULT: {
      // A vaulted concourse: straight haunches into a segmental arch.
      const p: Profile = [[ -w, -d ], [ w, -d ], [ w, h * 0.45 ]]
      for (let i = 1; i < 7; i++) {
        const a = i / 7 * Math.PI
        p.push([ Math.cos(a) * w, h * 0.45 + Math.sin(a) * h * 0.55 ])
      }
      p.push([ -w, h * 0.45 ])
      return { profile: p, closed: true, facing: Facing.IN }
    }

    case Theme.CHORD: {
      // A bored tunnel: a horseshoe. Segmental crown on straight sides, which
      // is exactly what a brick bore from before the line was a line looks like.
      const p: Profile = [[ -w, -d ], [ w, -d ], [ w, h * 0.3 ]]
      for (let i = 1; i < 9; i++) {
        const a = i / 9 * Math.PI
        p.push([ Math.cos(a) * w, h * 0.3 + Math.sin(a) * h * 0.7 ])
      }
      p.push([ -w, h * 0.3 ])
      return { profile: p, closed: true, facing: Facing.IN }
    }
    case Theme.ANNEX:
      // A wide low interchange with a drainage channel down the middle, which
      // is what the water pools in.
      return {
        profile: [
          [ -w, -d + 0.9 ], [ -1.9, -d + 0.9 ], [ -1.5, -d ], [ 1.5, -d ],
          [ 1.9, -d + 0.9 ], [ w, -d + 0.9 ], [ w, h ], [ -w, h ],
        ],
        closed: true,
        facing: Facing.IN,
      }
    case Theme.MACHINE:
    default:
      // A cold aisle: narrow, square, with a raised floor void under it.
      return {
        profile: [
          [ -w, -d ], [ w, -d ], [ w, h ], [ -w, h ],
        ],
        closed: true,
        facing: Facing.IN,
      }
  }
}

/** A unit sleeper, 2.6 m across the track, lying at the origin. */
export function buildSleeper (b: MeshBuilder): void {
  b.box(0, -0.09, 0, 1.3, 0.09, 0.13)
}

/**
 * A short length of both rails plus the chairs holding them, one sleeper-pitch
 * long. Drawn as its own instanced family so the rails inherit the track's
 * curvature by being placed along it, rather than being one enormous mesh.
 */
export function buildRailPiece (b: MeshBuilder, pitch: number): void {
  const gauge = 0.7175
  for (const side of [ -1, 1 ]) {
    b.box(side * gauge, 0.075, 0, 0.035, 0.075, pitch * 0.52) // web + head
    b.box(side * gauge, 0.005, 0, 0.07, 0.02, pitch * 0.52) // foot
  }
}

/** A lamp: a housing, its bracket, and the diffuser that actually glows. */
export function buildLamp (b: MeshBuilder): void {
  b.box(0, 0, 0, 0.42, 0.10, 0.14) // housing
  b.box(0, -0.11, 0, 0.36, 0.02, 0.10) // diffuser
  b.box(0, 0.19, 0, 0.04, 0.10, 0.04) // stem
}

/** A platform bench: slats on two cast ends. */
export function buildBench (b: MeshBuilder): void {
  for (let i = 0; i < 4; i++)
    b.box(0, 0.44, -0.6 + i * 0.4, 0.28, 0.03, 0.16)
  b.box(0, 0.22, -0.68, 0.24, 0.22, 0.05)
  b.box(0, 0.22, 0.68, 0.24, 0.22, 0.05)
}

/** A server rack: a slab with a vented face. */
export function buildRack (b: MeshBuilder): void {
  b.box(0, 1.0, 0, 0.35, 1.0, 0.30)
  for (let i = 0; i < 8; i++)
    b.box(0.37, 0.28 + i * 0.2, 0, 0.03, 0.06, 0.24)
}

/** A trestle bent: two legs and a cross-brace, hanging below the deck. */
export function buildBent (b: MeshBuilder, depth: number): void {
  const h = depth * 0.5
  for (const side of [ -1, 1 ]) {
    b.box(side * 3.4, -h, 0, 0.16, h, 0.16)
    b.box(side * 1.9, -h * 1.9, 0, 0.12, 0.12, 0.12)
  }
  b.box(0, -h * 0.55, 0, 3.4, 0.10, 0.10)
  b.box(0, -h * 1.4, 0, 2.2, 0.10, 0.10)
}

/** A shuttered retail unit, for the concourse mezzanine. */
export function buildShutter (b: MeshBuilder): void {
  b.box(0, 1.4, 0, 0.12, 1.4, 1.7)
  for (let i = 0; i < 9; i++)
    b.box(0.14, 0.3 + i * 0.28, 0, 0.02, 0.10, 1.6)
}

/** A chain-link fence panel with its posts, for the cut. */
export function buildFence (b: MeshBuilder): void {
  b.box(0, 1.0, 0, 0.06, 1.0, 0.06)
  b.box(0, 1.95, 1.5, 0.04, 0.04, 1.5)
  b.box(0, 0.05, 1.5, 0.04, 0.04, 1.5)
}

export interface UnitMeshSpec {
  name:  string;
  build: (b: MeshBuilder) => void;

  /** Fracture cell size in metres, or 0 to leave the prop whole. */
  cell: number;
}

/**
 * Build one unit prop into a fresh builder, fracturing it if asked. Kept
 * separate from the placement in scene.ts so a prop knows nothing about where
 * it ends up — which is what lets the same bench mesh serve six bays.
 */
export function buildUnit (spec: UnitMeshSpec, seed: number): MeshBuilder {
  const b = createMeshBuilder()
  spec.build(b)
  if (spec.cell > 0)
    fracture(b, spec.cell, mulberry32(seed))
  return b
}

/** Sleeper pitch in metres. Real track is 0.6-0.7; this is a people-mover. */
export const TIE_PITCH = 0.72

/**
 * Where the lamps go in a bay, in world space, with the tint and reach the
 * shader needs. Returned rather than drawn, because the same list feeds both the
 * instanced housings and the light uniforms — and those two disagreeing is how
 * you get a lamp that glows with nothing there.
 */
export interface Lamp {
  x:    number;
  y:    number;
  z:    number;
  r:    number;
  tint: [number, number, number];

  /** Deterministic per-lamp roll, so which lamps fail is stable across seeks. */
  roll: number;
}

export function lampsFor (
  curve: ClosedCurve, span: BaySpan, seed: number,
): Lamp[] {
  const bay = span.bay
  if (bay.lampPitch <= 0)
    return []

  const rand         = mulberry32(seed)
  const out: Lamp[]  = []
  const frame: Frame = {
    pos:     { x: 0, y: 0, z: 0 },
    forward: { x: 0, y: 0, z: 1 },
    up:      { x: 0, y: 1, z: 0 },
    right:   { x: 1, y: 0, z: 0 },
  }

  for (let s = span.s0 + bay.lampPitch * 0.5; s < span.s1; s += bay.lampPitch) {
    curve.frameAtDistance(s, frame)

    // Lamps hang off the side wall in an enclosed bay and off a mast in the
    // open, which is the difference you actually read as "indoors".
    // Enclosed bays hang their lamps near the centreline so both walls get
    // something; only the open bays put them on a mast off to one side.
    const lateral = bay.bore === OPEN ? 3.6 : bay.bore * 0.30
    out.push({
      x:    frame.pos.x + frame.up.x * bay.lampY + frame.right.x * lateral,
      y:    frame.pos.y + frame.up.y * bay.lampY + frame.right.y * lateral,
      z:    frame.pos.z + frame.up.z * bay.lampY + frame.right.z * lateral,
      r:    bay.bore === OPEN ? 26 : Math.max(14, bay.lampPitch * 2.6),
      tint: bay.lampTint,
      roll: rand(),
    })
  }
  return out
}
