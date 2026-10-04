// THE LOOP LINE — furnishing the bays.
//
// Where every prop goes, every lamp hangs and every headwall stands, as plain
// data for scene.ts to upload once. Nothing here touches GL.
//
// Placement is always relative to the curve's transported frame at an arc
// length: (s, right, up), so a prop sits square to the track wherever the
// track goes and the same dressing code serves a straight and a curve. An
// instance is sixteen floats — position and three scales, forward, up, and
// (s, bay, seed, tint) — because a building needs its own width, height and
// depth, and because the fog in the shader is looked up by arc length, not by
// distance from anything.
//
// Lamps are returned rather than drawn, because one list feeds two things: the
// instanced fittings and the light uniforms. Those two disagreeing is how you
// get a pool of light thrown by nothing.

import { cloneFrame, newFrame } from '@wjh/geometry/curve'
import { mulberry32 } from '@wjh/math/rng'
import type { ClosedCurve, Frame, Vec3 } from '@wjh/geometry/curve'
import { BAYS, Theme } from './stations'
import type { BaySpan, Circuits } from './stations'
import { TIE_PITCH, portalFor } from './geometry'
import type { SurfaceKey } from './geometry'


/** Floats per instance: (pos, sx), (fwd, sy), (up, sz), (s, bay, seed, tint). */
export const INSTANCE_FLOATS = 16

export interface Lamp {
  x: number;
  y: number;
  z: number;

  /** Radiant intensity, linear HDR — colour times power. */
  r: number;
  g: number;
  b: number;

  /** Range: the light is windowed to zero here. */
  range: number;

  /** Failure order: a lamp is dead once the lap's lightFail passes this. */
  roll: number;
}

export interface Headwall {
  bay:   number;
  s:     number;
  frame: Frame;

  /** The wall's extent in its own (right, up) plane. */
  rect:    [ number, number, number, number ];
  surface: SurfaceKey;

  /** Openings, as polygons in the same plane. */
  holes: [ number, number ][][];
}

export interface Dressing {

  /** Unit name -> instance floats. */
  instances: Map<string, number[]>;
  lamps:     Lamp[];
}

interface PutOpts {
  yaw?:  number;
  sx?:   number;
  sy?:   number;
  sz?:   number;
  tint?: number;
  seed?: number;

  /** Extra offset along the track, metres. */
  dz?: number;

  /** World y to stand on, overriding the track-relative `u`. */
  y?: number;
}

class Dresser {
  readonly out = new Map<string, number[]>()
  readonly lamps: Lamp[] = []
  private readonly f = newFrame()

  constructor (
    readonly curve: ClosedCurve,
    readonly bay: number,
    readonly rand: () => number,
  ) {}

  frame (s: number): Frame {
    return this.curve.frameAtDistance(s, this.f)
  }

  /** Place `unit` at (s, r, u) in the track's frame. */
  put (unit: string, s: number, r: number, u: number, o: PutOpts = {}): Vec3 {
    const f  = this.frame(s)
    const dz = o.dz ?? 0
    const x  = f.pos.x + f.right.x * r + f.up.x * u + f.forward.x * dz
    let y    = f.pos.y + f.right.y * r + f.up.y * u + f.forward.y * dz
    const z  = f.pos.z + f.right.z * r + f.up.z * u + f.forward.z * dz
    if (o.y !== undefined)
      y = o.y

    // Yaw about up. Left is up x forward, which is -right.
    const yaw = o.yaw ?? 0
    const c   = Math.cos(yaw),
      sn      = Math.sin(yaw)
    const fx  = f.forward.x * c - f.right.x * sn
    const fy  = f.forward.y * c - f.right.y * sn
    const fz  = f.forward.z * c - f.right.z * sn

    let arr = this.out.get(unit)
    if (!arr) {
      arr = []
      this.out.set(unit, arr)
    }
    arr.push(
      x, y, z, o.sx ?? 1,
      fx, fy, fz, o.sy ?? 1,
      f.up.x, f.up.y, f.up.z, o.sz ?? 1,
      s, this.bay, o.seed ?? this.rand(), o.tint ?? 0,
    )
    return { x, y, z }
  }

  lamp (s: number, r: number, u: number, rgb: [ number, number, number ], power: number, range: number): Lamp {
    const f          = this.frame(s)
    const lamp: Lamp = {
      x:    f.pos.x + f.right.x * r + f.up.x * u,
      y:    f.pos.y + f.right.y * r + f.up.y * u,
      z:    f.pos.z + f.right.z * r + f.up.z * u,
      r:    rgb[0] * power,
      g:    rgb[1] * power,
      b:    rgb[2] * power,
      range,
      roll: this.rand(),
    }
    this.lamps.push(lamp)
    return lamp
  }
}

// Lamp colours, linear, before power.
const WARM_WHITE: [ number, number, number ] = [ 1, 0.86, 0.68 ]
const TUNGSTEN: [ number, number, number ]   = [ 1, 0.62, 0.3 ]
const SODIUM: [ number, number, number ]     = [ 1, 0.52, 0.16 ]
const GREENISH: [ number, number, number ]   = [ 0.7, 1, 0.84 ]
const COLD: [ number, number, number ]       = [ 0.52, 0.74, 1 ]
const RED: [ number, number, number ]        = [ 1, 0.1, 0.06 ]

/**
 * Track for one stretch of one circuit: sleepers, rails, conductor rail.
 * `skip` lets the chord's track hold off until it has diverged far enough not
 * to stand in the main line's sleepers.
 */
function layTrack (
  d: Dresser, s0: number, s1: number, wood: boolean,
  skip?: (s: number) => { sleepers: boolean; rails: boolean },
): void {
  for (let s = s0; s < s1; s += TIE_PITCH) {
    const k = skip?.(s) ?? { sleepers: true, rails: true }
    if (k.sleepers)
      d.put(wood ? 'sleeperWood' : 'sleeperConcrete', s, 0, 0,
            { yaw: (d.rand() - 0.5) * 0.03, dz: (d.rand() - 0.5) * 0.04 })
    if (k.rails) {
      d.put('rail', s, 0, 0, { seed: 0.5 })
      d.put('conductor', s, 0, 0, { seed: 0.5 })
    }
  }
}

/** Is this world point clear of every track by `gap` metres? */
function clearOfTracks (c: Circuits, p: Vec3, s: number, gap: number): boolean {
  for (const curve of [ c.main, c.alt ])
    for (let k = -14; k <= 14; k++) {
      const q = curve.pointAtDistance(s + k * 2)
      if (Math.hypot(q.x - p.x, q.z - p.z) < gap && Math.abs(q.y - p.y) < 6)
        return false
    }
  return true
}

/**
 * Furnish one bay of the main circuit (or the chord, on alt). Everything is
 * placed from the bay's own frames, so it lands where the shell was swept.
 */
export function dressBay (c: Circuits, span: BaySpan, onAlt: boolean, seed: number): Dressing {
  const curve      = onAlt ? c.alt : c.main
  const bay        = span.bay
  const d          = new Dresser(curve, bay.id, mulberry32(seed))
  const { s0, s1 } = span
  const R          = d.rand

  const woodTrack = bay.theme === Theme.CUT || bay.theme === Theme.DEPOT ||
    bay.theme === Theme.TRESTLE || bay.theme === Theme.CHORD || bay.theme === Theme.VIADUCT

  if (bay.theme !== Theme.CHORD)
    layTrack(d, s0, s1, woodTrack)

  switch (bay.theme) {
    case Theme.STATION: {
      for (let s = s0 + 4.5; s < s1 - 3; s += 9) {
        d.put('column', s, 4.7, 0.92)
        d.put('columnCap', s, 4.7, 0.92)
      }
      for (let s = s0 + 9; s < s1 - 6; s += 9) {
        d.put('benchSlats', s, 7.4, 0.92)
        d.put('benchLegs', s, 7.4, 0.92)
      }
      for (let s = s0 + 13.5; s < s1 - 9; s += 27) {
        d.put('roundelRing', s, 9.56, 3.9, { yaw: Math.PI / 2 })
        d.put('roundelDisc', s, 9.56, 3.9, { yaw: Math.PI / 2 })
        d.put('roundelBar', s, 9.53, 3.9, { yaw: Math.PI / 2 })
      }
      for (let s = s0 + 5; s < s1 - 3; s += 5.5) {
        const tint = Math.floor(R() * 8)
        d.put('posterFrame', s, -3.69, 2.4)
        d.put('poster', s, -3.67, 2.4, { tint })
      }
      // Every glowing fitting carries its own lamp's roll as its seed, so the
      // tube and the light it throws fail on the same lap.
      for (let s = s0 + 3; s < s1 - 1; s += 6.2)
        for (const [ r, ds ] of [[ 1.6, 0 ], [ 6.6, 3.1 ]]) {
          const lamp = d.lamp(s + ds, r, 5.9, WARM_WHITE, 7, 16)
          d.put('fluoroBody', s + ds, r, 6.2)
          d.put('fluoroTube', s + ds, r, 6.2, { seed: lamp.roll })
        }
      break
    }

    case Theme.TUBE: {
      for (let s = s0 + 0.6; s < s1; s += 1.25)
        d.put('rib', s, 0, 0)
      for (let s = s0 + 7; s < s1 - 2; s += 16) {
        const lamp = d.lamp(s, -2.4, 2.3, TUNGSTEN, 2.4, 12)
        d.put('bulkBody', s, -2.72, 2.3)
        d.put('bulkGlass', s, -2.72, 2.3, { seed: lamp.roll })
      }
      break
    }

    case Theme.CONCOURSE: {
      for (let s = s0 + 3; s < s1 - 3; s += 5.6) {
        d.put('shutter', s, 23.92, 1)
        d.put('shopSign', s, 23.8, 1, { tint: Math.floor(R() * 8) })
        d.put('shutter', s + 2.8, -11.92, 1)
        d.put('shopSign', s + 2.8, -11.8, 1, { tint: Math.floor(R() * 8) })
      }
      for (let s = s0 + 1; s < s1; s += 2.1) {
        d.put('railPost', s, 20.85, 5.6)
        d.put('railTop', s, 20.85, 5.6)
        d.put('railPost', s, -8.85, 5.6)
        d.put('railTop', s, -8.85, 5.6)
      }
      for (let s = s0 + 7; s < s1; s += 15)
        for (const r of [ -1.5, 13.5 ]) {
          const lamp = d.lamp(s, r, 9.9, WARM_WHITE, 26, 36)
          d.put('pendantRod', s, r, 10.3)
          d.put('pendantShade', s, r, 10.3)
          d.put('pendantGlobe', s, r, 10.3, { seed: lamp.roll })
        }
      // The points, and the machine that throws them, where you can see it.
      d.put('pointMachine', c.junctionS, -2.1, -0.38)
      d.put('signalPost', c.junctionS - 14, -2.4, -0.38)
      d.put('signalLens', c.junctionS - 14, -2.4, -0.38, { tint: 1 })
      break
    }

    case Theme.CUT: {
      for (let s = s0 + 40; s < s1 - 30; s += 86)
        d.put('overbridge', s, 0, 0)
      for (let s = s0 + 1; s < s1; s += 1.6) {
        d.put('fencePost', s, -9.3, 0)
        d.put('fencePost', s, 9.3, 0)
      }
      for (let s = s0 + 60; s < s1; s += 130) {
        d.put('signalPost', s, -3.6, -0.38)
        d.put('signalLens', s, -3.6, -0.38, { tint: 2 })
      }
      break
    }

    case Theme.ANNEX: {
      for (let s = s0 + 3.5; s < s1; s += 7.5) {
        d.put('beam', s, 6, 0)
        for (const r of [ -5.4, 5.6, 15.2 ]) {
          const f = d.frame(s)
          const p = { x: f.pos.x + f.right.x * r, y: f.pos.y, z: f.pos.z + f.right.z * r }
          if (clearOfTracks(c, p, s, 2.6))
            d.put('annexColumn', s, r, -0.38)
        }
        for (const r of [ 0.2, 11 ]) {
          const lamp = d.lamp(s, r, 4, GREENISH, 3.2, 13)
          d.put('tubeLight', s, r, 0, { seed: lamp.roll })
        }
      }
      break
    }

    case Theme.VIADUCT: {
      for (let s = s0 + 6; s < s1 - 4; s += 12) {
        d.put('pier', s, 0, 0)
        d.put('arch', s + 6, 0, 0)
      }
      for (let s = s0 + 10; s < s1; s += 26) {
        const side = Math.round((s - s0) / 26) % 2 ? 1 : -1
        const lamp = d.lamp(s, side * 2.75, 6.1, SODIUM, 9, 26)
        d.put('lampPost', s, side * 3.8, 1.15, { yaw: side > 0 ? 0 : Math.PI })
        d.put('lampHead', s, side * 3.8, 1.15, { yaw: side > 0 ? 0 : Math.PI, seed: lamp.roll })
      }
      buildCity(d, c, span)
      break
    }

    case Theme.STACKS: {
      for (let s = s0 + 1.5; s < s1 - 1; s += 0.62) {
        // A rack's face is local +x, which is left: so the right-hand row
        // faces the aisle as placed and the left-hand row turns round.
        d.put('rack', s, -6.55, -0.38, { yaw: Math.PI, seed: R() })
        d.put('rack', s, 6.55, -0.38, { seed: R() })
      }
      for (let s = s0 + 2; s < s1; s += 4) {
        const lamp = d.lamp(s, 0, 4.3, COLD, 1.8, 9)
        d.put('coldStrip', s, 0, 0, { seed: lamp.roll })
      }
      break
    }

    case Theme.DEPOT: {
      const sidings = [ -16, -10.5, 6.5, 12, 17.5 ]
      for (const r of sidings)
        for (let s = s0 - 6; s < s1 + 6; s += TIE_PITCH * 1.4) {
          d.put('sleeperWood', s, r, -0.04)
          d.put('rail', s, r, -0.04, { seed: 0.5, sz: 1.4 })
        }
      // Parked sets, two to four cars, on some of the sidings.
      for (const r of sidings) {
        let s = s0 + R() * 30
        while (s < s1 - 20) {
          const cars = 2 + Math.floor(R() * 3)
          if (R() < 0.62)
            for (let k = 0; k < cars; k++) {
              const sc = s + k * 18.4
              d.put('carriage', sc, r, -0.04, { seed: R(), tint: R() })
              d.put('bogie', sc, r, -0.04)
            }
          s += cars * 18.4 + 14 + R() * 26
        }
      }
      for (let s = s0 + 14; s < s1; s += 48)
        for (const r of [ -24, 26 ]) {
          const lamp = d.lamp(s, r * 0.94, 21.5, SODIUM, 120, 80)
          d.put('mast', s, r, -0.42)
          d.put('floodHead', s, r, -0.42, { seed: lamp.roll })
        }
      for (let s = s0 + 20; s < s1 - 30; s += 20.4) {
        d.put('shed', s, 46, -0.42, { sx: 26, sz: 20.4 })
        d.put('shedRoof', s, 46, -0.42, { sx: 26, sz: 20.4 })
      }
      break
    }

    case Theme.TRESTLE: {
      for (let s = s0 + 3; s < s1; s += 6.5)
        d.put('bent', s, 0, -0.95)
      for (let s = s0 + 0.75; s < s1; s += 1.5) {
        d.put('trestleRailPost', s, 2.32, -0.3)
        d.put('trestleRailPost', s, -2.32, -0.3)
      }
      for (let s = s0 + 1.5; s < s1; s += 3) {
        d.put('trestleRail', s, 2.32, -0.3)
        d.put('trestleRail', s, -2.32, -0.3)
      }
      for (let s = s0 + 12; s < s1; s += 28) {
        const r    = Math.round((s - s0) / 28) % 2 ? 2.9 : -2.9
        const lamp = d.lamp(s, r, 2.3, RED, 3.4, 16)
        d.put('redPost', s, r, -0.3)
        d.put('redLamp', s, r, -0.3, { seed: lamp.roll })
      }
      break
    }
    case Theme.CHORD:
    default: {
      // Dead fittings: housings with nothing in them, every thirty metres.
      for (let s = s0 + 12; s < s1 - 6; s += 30)
        d.put('bulkBody', s, -3.05, 2.2)
      break
    }
  }

  return { instances: d.out, lamps: d.lamps }
}

/**
 * The city under the viaduct: blocks on both sides out to a hundred-odd metres
 * at a common street level, a skyline beyond, and street lamps in rows. The
 * blocks are unit cubes scaled per instance; their windows are drawn in the
 * shader from the instance seed, so the city is a few hundred boxes.
 */
function buildCity (d: Dresser, c: Circuits, span: BaySpan): void {
  const R = d.rand
  let low = Infinity
  for (let s = span.s0; s < span.s1; s += 10)
    low = Math.min(low, d.frame(s).pos.y)

  const street = low - 15

  const s0 = span.s0 - 120
  const s1 = span.s1 + 60
  for (const side of [ -1, 1 ])
    for (const [ near, far, step, hMin, hMax ] of [
      [ 13, 34, 15, 6, 22 ],
      [ 38, 72, 19, 10, 38 ],
      [ 80, 140, 26, 16, 60 ],
      [ 170, 320, 40, 30, 110 ],
    ] as const)
      for (let s = s0; s < s1; s += step * (0.7 + R() * 0.6)) {
        const r   = side * (near + R() * (far - near))
        const f   = d.frame(s)
        const p   = { x: f.pos.x + f.right.x * r, y: street, z: f.pos.z + f.right.z * r }
        const w   = 9 + R() * (step * 0.9)
        const dep = 9 + R() * 14
        if (!clearOfTracks(c, p, s, Math.max(w, dep) * 0.75 + 7))
          continue

        const h = hMin + R() * R() * (hMax - hMin)
        d.put(R() < 0.45 ? 'buildingBrick' : 'building', s, r, 0,
              { y: street, sx: w, sy: h, sz: dep, yaw: (R() - 0.5) * 0.3, seed: R() })
      }

  // Street lamps: two rows along the streets either side of the viaduct.
  for (let s = s0; s < s1; s += 22)
    for (const r of [ -9.5, 9.5, -46, 46 ])
      d.put('streetLamp', s, r, 0, { y: street + 6 })
}

/**
 * The headwalls: where a bay ends against a smaller mouth, or where an open
 * bay runs into a facade, a cliff, or a building. Hand-authored, because which
 * boundaries need one is a matter of what can be seen from where.
 */
export function buildHeadwalls (c: Circuits): Headwall[] {
  const L               = c.main.length
  const out: Headwall[] = []
  const wall            = (fromId: number, toId: number, rect: Headwall['rect'], surface: SurfaceKey,
    extraHoles: [ number, number ][][] = []): Headwall => {
    const s            = BAYS[toId].u0 * L
    const frame        = cloneFrame(c.main.frameAtDistance(s))
    const portal       = portalFor(BAYS[toId].theme)
    const hw: Headwall = {
      bay:   fromId,
      s,
      frame,
      rect,
      surface,
      holes: [ ...portal ? [ portal ] : [], ...extraHoles ],
    }
    out.push(hw)
    return hw
  }

  wall(0, 1, [ -3.7, -0.38, 9.6, 6.3 ], 'tile')

  // The concourse end wall carries both portals: daylight, and the chord.
  const chordHole = projectPortal(c, c.chordStartAltS, c.main.frameAtDistance(BAYS[3].u0 * L))
  wall(2, 3, [ -12, -0.38, 24, 16.1 ], 'plaster', [ chordHole ])

  wall(3, 4, [ -8.7, -0.38, 8.7, 11.7 ], 'panel')
  wall(4, 5, [ -10, -0.38, 22, 4.9 ], 'plasterDamp')
  wall(5, 6, [ -26, -18, 26, 13 ], 'concreteDim')

  // The turnback ends in a cliff, and the station is a hole in it.
  const cliff = wall(8, 0, [ -110, -80, 110, 70 ], 'rock')
  cliff.s     = L
  return out
}

/**
 * The chord's mouth, as it lands on the concourse end wall. The chord crosses
 * the wall at an angle, so its own portal outline is pushed along its own
 * direction of travel onto the wall plane — stretched across, exactly as a
 * skewed tunnel mouth is in a real wall.
 */
function projectPortal (c: Circuits, altS: number, plane: Frame): [ number, number ][] {
  const f      = c.alt.frameAtDistance(altS)
  const portal = portalFor(Theme.CHORD) ?? []
  return portal.map(([ r, u ]) => {
    const px = f.pos.x + f.right.x * r + f.up.x * u
    const py = f.pos.y + f.right.y * r + f.up.y * u
    const pz = f.pos.z + f.right.z * r + f.up.z * u
    // Ray along the chord's forward to the wall plane.
    const dn = f.forward.x * plane.forward.x + f.forward.y * plane.forward.y + f.forward.z * plane.forward.z
    const t  = -((px - plane.pos.x) * plane.forward.x + (py - plane.pos.y) * plane.forward.y +
      (pz - plane.pos.z) * plane.forward.z) / (dn || 1)
    const qx = px + f.forward.x * t - plane.pos.x
    const qy = py + f.forward.y * t - plane.pos.y
    const qz = pz + f.forward.z * t - plane.pos.z
    return [
      qx * plane.right.x + qy * plane.right.y + qz * plane.right.z,
      qx * plane.up.x + qy * plane.up.y + qz * plane.up.z,
    ] as [ number, number ]
  })
}

/**
 * The chord's own track, from the points to the rejoin on ALT, holding off its
 * sleepers until it has diverged far enough not to stand in the main line's,
 * and its rails until they have parted at all.
 */
export function chordTrack (c: Circuits, seed: number): Dressing {
  const d     = new Dresser(c.alt, 9, mulberry32(seed))
  const p     = { x: 0, y: 0, z: 0 }
  const q     = { x: 0, y: 0, z: 0 }
  const apart = (s: number): number => {
    c.alt.pointAtDistance(s, p)

    // Before the chord's own span the circuits share arc length; after it they
    // share the distance back from the seam.
    const mainS = s <= c.chordStartAltS ? s : c.rejoinMainS - (c.rejoinAltS - s)
    c.main.pointAtDistance(mainS, q)
    return Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z)
  }
  layTrack(d, c.junctionS + 1, c.rejoinAltS - 1, true, s => {
    const a = apart(s)
    return { sleepers: a > 2.75, rails: a > 0.1 }
  })
  return { instances: d.out, lamps: d.lamps }
}
