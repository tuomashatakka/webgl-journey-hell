// THE LOOP LINE — the renderer.
//
// The first rasterized journey in this repo. Everything else here resolves
// visibility analytically along a ray inside a fragment shader; this one submits
// triangles and lets the depth buffer sort it out, which is why it asks
// withGeometryJourney for a WebGL2 context with a depth attachment.
//
// ---------------------------------------------------------------------------
// What a frame costs
// ---------------------------------------------------------------------------
//
// The whole circuit — 1.26 km of tunnel, trench, trestle and station, every
// sleeper, every lamp housing, every rack — is built once at construction and
// never rebuilt. A frame is then:
//
//   * one pass over at most three resident bays, each contributing one shell
//     draw and one instanced draw per prop family;
//   * a half-resolution bright pass and two separable blurs;
//   * one composite.
//
// which lands around 30-45 draw calls. Nothing is uploaded per frame except a
// handful of uniforms. The world coming apart costs *nothing* extra: shard
// displacement is a vertex-shader function of one uniform, so the last lap
// renders at exactly the price of the first. That property is the entire reason
// the rupture is authored as vertex maths rather than as geometry swaps.
//
// ---------------------------------------------------------------------------
// Resolving the owning bay — the repo's most repeated bug
// ---------------------------------------------------------------------------
//
// natatorium's `resolveSlot` and switchback's `roomAt` both exist because of one
// mistake made twice: shading a surface with the *camera's* section parameters
// instead of the section the surface actually belongs to. A room seen through a
// doorway then gets lit with the wrong width, the wrong ceiling height and the
// wrong lamp pitch, and the instant the resident window advances every one of
// those numbers changes under a picture that has not moved.
//
// A rasterizer makes this easy to get right and just as easy to get wrong. Right
// is: bay parameters are per-DRAW-CALL uniforms, and a bay's geometry is only
// ever submitted with its own. So looking down the line into the next bay shows
// that bay lit by its own lamps in its own fog, because those triangles were
// submitted by that bay's draw. The camera's own bay is never consulted for
// anything except which draws to issue at all.
//
// The lamp arrays follow the same rule and are the part that would bite: a lamp
// belongs to a bay, and a fragment is lit only by the lamps submitted with it.
// Crossing a bay boundary therefore changes which lamps light which surfaces,
// but never changes how any single surface was lit.
//
// ---------------------------------------------------------------------------
// Where the camera comes from
// ---------------------------------------------------------------------------
//
// The simulation hands over a pose — position, forward, up — and not a matrix.
// That is on purpose. It keeps the ?debug=1 panel readable (three vec3s you can
// sanity-check by eye, against sixteen floats you cannot), it lets the audio
// engine consume exactly the numbers the frame was drawn with, and it keeps the
// projection a property of the renderer, which is the only thing that knows the
// aspect ratio.

import { createGlProgram } from '@/lib/glProgram'
import type { GlProgram } from '@/lib/glProgram'
import { createMesh } from '@/lib/mesh'
import type { Mesh } from '@/lib/mesh'
import { lookAt, multiply, perspective } from '@/lib/mat4'
import type { Mat4 } from '@/lib/mat4'
import { mulberry32 } from '@/lib/rng'
import type { ClosedCurve, Frame } from '@/lib/curve'
import type { JourneyRenderer } from '@/components/withJourneyShell'
import type { QuadFrameUniforms } from '@/lib/shaderQuad'
import { OPEN, Rupture, Theme, getCircuits } from './stations'
import type { BaySpan } from './stations'
import {
  Facing,
  TIE_PITCH,
  buildBench,
  buildBent,
  buildFence,
  buildLamp,
  buildRack,
  buildRailPiece,
  buildShutter,
  buildSleeper,
  buildUnit,
  lampsFor,
  profileFor,
  sweepProfile

} from './geometry'
import type { Lamp, UnitMeshSpec } from './geometry'
import {
  blurFrag,
  brightFrag,
  compositeFrag,
  loopLineFrag,
  loopLineVert,
  postVert

} from './shader'


/** Instance stride: iXform(4) + iParams(4). */
const INSTANCE_FLOATS = 8

/** Hard cap in the fragment shader; the loop is bounded by a constant there. */
const MAX_LAMPS = 24

/** Beyond this the fog has closed and a bay contributes nothing. */
const CULL_DIST = 300

const FOV = 68 * Math.PI / 180

interface PropFamily {
  mesh:      Mesh;
  instances: Float32Array;
  count:     number;
}

interface BayRender {
  span:  BaySpan;
  shell: Mesh;

  /** One instance for the shell, so the shared vertex format needs no branch. */
  shellInstance: Float32Array;
  families:      PropFamily[];
  lamps:         Lamp[];

  /** Bounding sphere, for culling. */
  cx:     number;
  cy:     number;
  cz:     number;
  radius: number;
}

interface CircuitRender {
  curve: ClosedCurve;
  bays:  BayRender[];
}

function newFrame (): Frame {
  return {
    pos:     { x: 0, y: 0, z: 0 },
    forward: { x: 0, y: 0, z: 1 },
    up:      { x: 0, y: 1, z: 0 },
    right:   { x: 1, y: 0, z: 0 },
  }
}

/**
 * Place one instance. `tint` picks between the two albedos the fragment shader
 * blends, `seed` decorrelates a prop family's shard behaviour from its
 * neighbours', and `bayId` is what the rupture weights are indexed by.
 */
function writeInstance (
  out: number[], x: number, y: number, z: number,
  yaw: number, scale: number, tint: number, seed: number, bayId: number,
): void {
  out.push(x, y, z, yaw, scale, tint, seed, bayId)
}

/** Yaw of a frame's forward vector, for orienting a prop along the track. */
function yawOf (f: Frame): number {
  return Math.atan2(f.forward.x, f.forward.z)
}

// --- per-bay dressing -----------------------------------------------------

/**
 * The props a bay is furnished with, as instance data against a shared unit
 * mesh. Everything here walks the bay's own arc-length span and uses the
 * transported frame, so a prop sits square to the track wherever the track goes.
 */
function dressBay (
  curve: ClosedCurve, span: BaySpan, seed: number,
): Map<string, number[]> {
  const bay   = span.bay
  const rand  = mulberry32(seed)
  const frame = newFrame()
  const out   = new Map<string, number[]>()
  const at    = (k: string): number[] => {
    let v = out.get(k)
    if (!v) {
      v = []
      out.set(k, v)
    }
    return v
  }

  // Track: sleepers and rail, the length of every bay without exception. This
  // is the one prop family the whole circuit shares, and it is what makes the
  // route legible as a railway rather than as a series of rooms.
  for (let s = span.s0; s < span.s1; s += TIE_PITCH) {
    curve.frameAtDistance(s, frame)

    const yaw = yawOf(frame)
    writeInstance(at('sleeper'), frame.pos.x, frame.pos.y, frame.pos.z,
                  yaw, 1, 0.75, rand(), bay.id)
    writeInstance(at('rail'), frame.pos.x, frame.pos.y, frame.pos.z,
                  yaw, 1, 1.0, rand(), bay.id)
  }

  // Lamps, as housings. The light itself is a uniform, not geometry.
  let lampS = span.s0 + bay.lampPitch * 0.5
  for (const lamp of lampsFor(curve, span, seed + 7)) {
    curve.frameAtDistance(lampS, frame)
    lampS += bay.lampPitch
    // tint 2.0 = self-lit at strength 1.0, so the housing reads as the source
    // of the pool it throws rather than as a slab floating in the dark.
    writeInstance(at('lamp'), lamp.x, lamp.y, lamp.z,
                  yawOf(frame), 1, 2.0, lamp.roll, bay.id)
  }

  switch (bay.theme) {
    case Theme.TILE:
      // Benches on the platform, facing the track.
      for (let s = span.s0 + 6; s < span.s1 - 6; s += 11) {
        curve.frameAtDistance(s, frame)

        const off = bay.bore * 0.80
        writeInstance(at('bench'),
                      frame.pos.x + frame.right.x * off,
                      frame.pos.y + frame.right.y * off - bay.floorD + 1.0,
                      frame.pos.z + frame.right.z * off,
                      yawOf(frame), 1, 0.4, rand(), bay.id)
      }
      break
    case Theme.VAULT:
      // Shuttered units along both haunches of the vault.
      for (let s = span.s0 + 4; s < span.s1 - 4; s += 4.2)
        for (const side of [ -1, 1 ]) {
          curve.frameAtDistance(s, frame)

          const off = side * bay.bore * 0.93
          writeInstance(at('shutter'),
                        frame.pos.x + frame.right.x * off,
                        frame.pos.y + frame.right.y * off - bay.floorD,
                        frame.pos.z + frame.right.z * off,
                        yawOf(frame) + (side > 0 ? Math.PI : 0),
                        1, 0.85, rand(), bay.id)
        }
      break
    case Theme.CUT:
      // Fence along both crests of the trench.
      for (let s = span.s0 + 2; s < span.s1 - 2; s += 3)
        for (const side of [ -1, 1 ]) {
          curve.frameAtDistance(s, frame)

          const off = side * bay.bore * 0 + side * 10.5
          writeInstance(at('fence'),
                        frame.pos.x + frame.right.x * off,
                        frame.pos.y + frame.right.y * off + 4.2,
                        frame.pos.z + frame.right.z * off,
                        yawOf(frame), 1, 0.6, rand(), bay.id)
        }
      break
    case Theme.MACHINE:
      // Racks lining the cold aisle, tight enough to scrape at full rupture.
      for (let s = span.s0 + 2; s < span.s1 - 2; s += 1.05)
        for (const side of [ -1, 1 ]) {
          curve.frameAtDistance(s, frame)

          const off = side * (bay.bore - 1.5)
          writeInstance(at('rack'),
                        frame.pos.x + frame.right.x * off,
                        frame.pos.y + frame.right.y * off - bay.floorD,
                        frame.pos.z + frame.right.z * off,
                        yawOf(frame) + (side > 0 ? Math.PI : 0),
                        1, 0.95, rand(), bay.id)
        }
      break
    case Theme.TRESTLE:
      // Bents under the deck, at a pitch that reads as structure from above.
      for (let s = span.s0; s < span.s1; s += 6.5) {
        curve.frameAtDistance(s, frame)
        writeInstance(at('bent'), frame.pos.x, frame.pos.y - 0.6, frame.pos.z,
                      yawOf(frame), 1, 1.0, rand(), bay.id)
      }
      break
    default:
      break
  }

  return out
}

/** Rupture weight for a bay, from the four decay channels. */
function ruptureWeight (bay: BaySpan['bay'], decay: Float32Array): number {
  switch (bay.rupture) {
    case Rupture.CROWD: return decay[0] * 0.7
    case Rupture.INVERT: return decay[0] * 1.25
    case Rupture.ERASE: return decay[0] * 0.35
    case Rupture.FLOOD: return decay[0] * 0.55
    case Rupture.ADVANCE: return decay[0] * 0.85
    case Rupture.VANISH: return decay[0] * 1.5
    default: return decay[0]
  }
}

export function createLoopLineScene (
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
): JourneyRenderer | null {
  const geoProg = createGlProgram(gl, loopLineVert, loopLineFrag)
  const brightP = createGlProgram(gl, postVert, brightFrag)
  const blurP   = createGlProgram(gl, postVert, blurFrag)
  const compP   = createGlProgram(gl, postVert, compositeFrag)
  if (!geoProg || !brightP || !blurP || !compP)
    return null

  // --- unit meshes, built once and shared by every bay --------------------
  // `cell` is the fracture cell size. A sleeper breaks in two, a rack sheds
  // panels, a bent loses members; the rail is left whole because a rail that
  // shatters stops reading as the thing holding the train up.
  const specs: UnitMeshSpec[] = [
    { name: 'sleeper', build: buildSleeper, cell: 0.7 },
    { name: 'rail', build: b => buildRailPiece(b, TIE_PITCH), cell: 0 },
    { name: 'lamp', build: buildLamp, cell: 0.3 },
    { name: 'bench', build: buildBench, cell: 0.5 },
    { name: 'shutter', build: buildShutter, cell: 0.8 },
    { name: 'fence', build: buildFence, cell: 1.2 },
    { name: 'rack', build: buildRack, cell: 0.8 },
    { name: 'bent', build: b => buildBent(b, 26), cell: 2.5 },
  ]

  const units = new Map<string, Mesh>()
  specs.forEach((spec, i) => {
    const mesh = createMesh(gl, buildUnit(spec, 1000 + i * 31))
    units.set(spec.name, mesh)
  })

  // --- the circuits ------------------------------------------------------
  const circuits = getCircuits()

  const buildCircuit = (curve: ClosedCurve, spans: BaySpan[], salt: number): CircuitRender => ({
    curve,
    bays: spans.map((span, i) => {
      const { profile, closed, facing } = profileFor(span.bay)

      // The shell is one mesh per bay, swept along that bay's own span. Fractured
      // coarsely: a wall comes apart in slabs, not in gravel.
      const b = buildUnit({
        name:  `shell-${span.bay.name}`,
        cell:  span.bay.theme === Theme.TRESTLE ? 3.0 : 5.0,
        build: bb => sweepProfile(bb, curve, span.s0, span.s1 + 1.2,
                                  span.bay.bore === OPEN ? 3.0 : 2.0,
                                  profile, closed, facing),
      }, salt + i * 97)

      const shell = createMesh(gl, b)

      const dressing               = dressBay(curve, span, salt + i * 131)
      const families: PropFamily[] = []
      for (const [ name, data ] of dressing) {
        const mesh = units.get(name)
        if (!mesh || data.length === 0)
          continue

        const instances = new Float32Array(data)
        mesh.setInstances(gl, instances)
        families.push({ mesh, instances, count: data.length / INSTANCE_FLOATS })
      }

      // Bounding sphere from the span's midpoint and half-length, padded by the
      // bore. Cheap, and a bay is a tube, so it is not a bad fit.
      const mid     = curve.pointAtDistance((span.s0 + span.s1) * 0.5)
      const halfLen = (span.s1 - span.s0) * 0.5

      return {
        span,
        shell,
        shellInstance: new Float32Array([ 0, 0, 0, 0, 1, 0.5, 0.5, span.bay.id ]),
        families,
        lamps:         lampsFor(curve, span, salt + i * 7),
        cx:            mid.x,
        cy:            mid.y,
        cz:            mid.z,
        radius:        halfLen + (span.bay.bore === OPEN ? 30 : span.bay.bore + 6),
      }
    }),
  })

  const main = buildCircuit(circuits.main, circuits.mainBays, 11)
  const alt  = buildCircuit(circuits.alt, circuits.altBays, 4001)

  // --- post-processing targets -------------------------------------------
  const quad = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, quad)
  gl.bufferData(gl.ARRAY_BUFFER,
                new Float32Array([ -1, -1, 1, -1, -1, 1, 1, 1 ]), gl.STATIC_DRAW)

  let width  = 0
  let height = 0

  // The scene is drawn into a multisampled renderbuffer and resolved with
  // blitFramebuffer, which is WebGL2's only route to MSAA when you also need to
  // read the result back as a texture. Asking the *default* framebuffer for
  // antialias instead would multisample the composite, which is already smooth,
  // and leave the geometry edges — the only aliased thing in the frame — exactly
  // as jagged as before.
  let msaaFbo: WebGLFramebuffer | null    = null
  let msaaColor: WebGLRenderbuffer | null = null
  let msaaDepth: WebGLRenderbuffer | null = null
  let sceneFbo: WebGLFramebuffer | null   = null
  let sceneTex: WebGLTexture | null       = null
  const bloomFbo: (WebGLFramebuffer | null)[] = [ null, null ]
  const bloomTex: (WebGLTexture | null)[]     = [ null, null ]

  const makeTex = (w: number, h: number): WebGLTexture | null => {
    const t = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return t
  }

  const releaseTargets = () => {
    if (msaaFbo)
      gl.deleteFramebuffer(msaaFbo)
    if (msaaColor)
      gl.deleteRenderbuffer(msaaColor)
    if (msaaDepth)
      gl.deleteRenderbuffer(msaaDepth)
    if (sceneFbo)
      gl.deleteFramebuffer(sceneFbo)
    if (sceneTex)
      gl.deleteTexture(sceneTex)
    for (let i = 0; i < 2; i++) {
      if (bloomFbo[i])
        gl.deleteFramebuffer(bloomFbo[i])
      if (bloomTex[i])
        gl.deleteTexture(bloomTex[i])
    }
  }

  const resize = (w: number, h: number) => {
    if (w === width && h === height)
      return
    releaseTargets()
    width = w
    height = h

    // Samples are capped at 4: the difference above that is invisible at these
    // resolutions and the bandwidth is not.
    const samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) as number)

    msaaColor = gl.createRenderbuffer()
    gl.bindRenderbuffer(gl.RENDERBUFFER, msaaColor)
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, w, h)
    msaaDepth = gl.createRenderbuffer()
    gl.bindRenderbuffer(gl.RENDERBUFFER, msaaDepth)
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, w, h)

    msaaFbo = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, msaaFbo)
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, msaaColor)
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, msaaDepth)

    sceneTex = makeTex(w, h)
    sceneFbo = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sceneTex, 0)

    const bw = Math.max(1, w >> 1)
    const bh = Math.max(1, h >> 1)
    for (let i = 0; i < 2; i++) {
      bloomTex[i] = makeTex(bw, bh)
      bloomFbo[i] = gl.createFramebuffer()
      gl.bindFramebuffer(gl.FRAMEBUFFER, bloomFbo[i])
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, bloomTex[i], 0)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  // --- reused per-frame scratch ------------------------------------------
  const proj: Mat4                       = new Float32Array(16)
  const view: Mat4                       = new Float32Array(16)
  const viewProj: Mat4                   = new Float32Array(16)
  const lampPos                          = new Float32Array(MAX_LAMPS * 4)
  const lampCol                          = new Float32Array(MAX_LAMPS * 4)
  const decay                            = new Float32Array(4)
  const ride                             = new Float32Array(4)
  const eye: [number, number, number]    = [ 0, 0, 0 ]
  const target: [number, number, number] = [ 0, 0, 1 ]
  const upv: [number, number, number]    = [ 0, 1, 0 ]

  const drawPost = (prog: GlProgram) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)

    const loc = prog.attrib('aPos')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  return {
    draw ({ time, pointer, custom }: QuadFrameUniforms) {
      const w = canvas.width
      const h = canvas.height
      resize(w, h)

      const camPos = (custom?.uCamPos as number[]) ?? [ 0, 0, 0 ]
      const camFwd = (custom?.uCamFwd as number[]) ?? [ 0, 0, 1 ]
      const camUp  = (custom?.uCamUp as number[]) ?? [ 0, 1, 0 ]
      const rideU  = (custom?.uRide as number[]) ?? [ 0, 0, 0, 0 ]
      const decayU = (custom?.uDecay as number[]) ?? [ 0, 0, 0, 0 ]

      decay.set(decayU)
      ride.set(rideU)

      const onAlt   = rideU[3] > 0.5
      const circuit = onAlt ? alt : main

      // Pointer look: yaw the forward vector about world up and pitch it about
      // the camera's right. Applied here rather than in the simulation because
      // where the rider is looking must not change where the train is.
      const px  = pointer?.x ?? 0
      const py  = pointer?.y ?? 0
      const yaw = px * 0.55
      const cy  = Math.cos(yaw)
      const sy  = Math.sin(yaw)
      let fx = camFwd[0] * cy + camFwd[2] * sy
      const fy = camFwd[1] + py * 0.42
      let fz = -camFwd[0] * sy + camFwd[2] * cy
      const flen = Math.hypot(fx, fy, fz) || 1
      fx /= flen
      fz /= flen

      eye[0]    = camPos[0]
      eye[1]    = camPos[1]
      eye[2]    = camPos[2]
      target[0] = camPos[0] + fx
      target[1] = camPos[1] + fy / flen
      target[2] = camPos[2] + fz
      upv[0]    = camUp[0]
      upv[1]    = camUp[1]
      upv[2]    = camUp[2]

      perspective(proj, FOV, w / Math.max(1, h), 0.12, 620)
      lookAt(view, eye, target, upv)
      multiply(viewProj, proj, view)

      // --- geometry pass into the multisampled target ---
      gl.bindFramebuffer(gl.FRAMEBUFFER, msaaFbo)
      gl.viewport(0, 0, w, h)
      gl.enable(gl.DEPTH_TEST)
      gl.depthFunc(gl.LEQUAL)
      gl.enable(gl.CULL_FACE)
      gl.cullFace(gl.BACK)

      // Clear to the camera's own bay fog, which is the one place the camera's
      // bay is legitimately the right answer: the clear colour is what shows
      // where nothing was drawn at all.
      const here = circuit.bays.find(b => {
        const s = (custom?.uLoop as number[])?.[0] ?? 0
        return s >= b.span.s0 && s < b.span.s1
      }) ?? circuit.bays[0]
      const fog = here.span.bay.fog
      gl.clearColor(fog[0], fog[1], fog[2], 1)
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

      geoProg.use()
      geoProg.uniformMatrix4fv('uViewProj', viewProj)
      geoProg.uniform3f('uCamPos', camPos[0], camPos[1], camPos[2])
      geoProg.uniform4f('uDecay', decay[0], decay[1], decay[2], decay[3])
      geoProg.uniform4f('uRide', ride[0], ride[1], ride[2], ride[3])
      geoProg.uniform1f('uTime', time)

      for (const bay of circuit.bays) {
        const dx   = bay.cx - camPos[0]
        const dy   = bay.cy - camPos[1]
        const dz   = bay.cz - camPos[2]
        const dist = Math.hypot(dx, dy, dz)
        if (dist - bay.radius > CULL_DIST)
          continue
        // Behind-the-camera rejection, but only once the whole sphere is behind:
        // a bay you are standing in must never be culled.
        if (dist > bay.radius && (dx * fx + dy * fy + dz * fz) / dist < -0.55)
          continue

        const b = bay.span.bay

        // Per-bay shading parameters. These are the numbers that must come from
        // the surface's own bay, never the camera's.
        geoProg.uniform4f('uBayFog', b.fog[0], b.fog[1], b.fog[2],
                          b.fogDensity * (1 + decay[2] * 0.9))

        // An enclosed bay still bounces a lot of light off its own walls, so the
        // ambient floor is a real value rather than a token one — 0.05 is not
        // "dim", it is "off", and it makes every lamp look like the only lamp.
        const amb = (0.055 + b.sky * 0.42) * (1 - decay[2] * 0.55)
        geoProg.uniform4f('uBayAmb',
                          amb * (0.9 + b.sky * 0.1), amb, amb * (1.05 + b.sky * 0.15), b.sky)

        // The annex floods a fixed step per lap; every other bay is dry.
        const flood = b.rupture === Rupture.FLOOD
          ? bay.cy - b.floorD + Math.min(3.2, ride[1] * 0.75)
          : -1e4
        geoProg.uniform4f('uWater', flood, b.rupture === Rupture.FLOOD ? 1 : 0, 0, 0)
        geoProg.uniform4f('uRupture', ruptureWeight(b, decay), 0, 0, 0)

        // Lamps, and which of them this lap has killed. The roll is fixed per
        // lamp, so failure order is stable and a seek reproduces it exactly.
        // Which 24 is not a detail. THE STACKS carries a lamp every three metres
        // over two hundred, so uploading the FIRST 24 lit the bay's opening and
        // left the rest of it in absolute darkness — a mean-luminance cliff from
        // 111 to 9 halfway through a bay whose geometry had not changed. The
        // nearest 24 is the only defensible choice, since a lamp outside its own
        // attenuation radius contributes nothing anyway.
        //
        // Lamps are stored in arc-length order, so the nearest is found by one
        // linear scan and the window taken around it. No sort, no allocation.
        let best  = 0
        let bestD = Infinity
        for (let i = 0; i < bay.lamps.length; i++) {
          const lp = bay.lamps[i]
          const dd = (lp.x - camPos[0]) ** 2 +
            (lp.y - camPos[1]) ** 2 +
            (lp.z - camPos[2]) ** 2
          if (dd < bestD) {
            bestD = dd
            best  = i
          }
        }

        const from = Math.max(0, Math.min(best - (MAX_LAMPS >> 1),
                                          bay.lamps.length - MAX_LAMPS))
        const to   = Math.min(bay.lamps.length, from + MAX_LAMPS)

        let n = 0
        for (let i = Math.max(0, from); i < to; i++) {
          const lamp     = bay.lamps[i]
          const l        = n * 4
          lampPos[l]     = lamp.x
          lampPos[l + 1] = lamp.y
          lampPos[l + 2] = lamp.z
          lampPos[l + 3] = lamp.r
          lampCol[l]     = lamp.tint[0]
          lampCol[l + 1] = lamp.tint[1]
          lampCol[l + 2] = lamp.tint[2]
          lampCol[l + 3] = lamp.roll < decay[1] ? 1 : 0
          n++
        }
        geoProg.uniform1i('uLampCount', n)
        geoProg.uniform4fv('uLampPos', lampPos)
        geoProg.uniform4fv('uLampCol', lampCol)

        bay.shell.setInstances(gl, bay.shellInstance)
        bay.shell.drawInstanced(gl, 1)
        for (const fam of bay.families) {
          fam.mesh.setInstances(gl, fam.instances)
          fam.mesh.drawInstanced(gl, fam.count)
        }
      }

      // --- resolve MSAA into a sampleable texture ---
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, msaaFbo)
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, sceneFbo)
      gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST)

      // --- bloom ---
      gl.disable(gl.DEPTH_TEST)
      gl.disable(gl.CULL_FACE)

      const bw = Math.max(1, w >> 1)
      const bh = Math.max(1, h >> 1)

      gl.bindFramebuffer(gl.FRAMEBUFFER, bloomFbo[0])
      gl.viewport(0, 0, bw, bh)
      brightP.use()
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, sceneTex)
      brightP.uniform1i('uSrc', 0)
      brightP.uniform1f('uThreshold', 0.88)
      drawPost(brightP)

      blurP.use()
      for (let pass = 0; pass < 2; pass++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, bloomFbo[(pass + 1) % 2])
        gl.viewport(0, 0, bw, bh)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, bloomTex[pass % 2])
        blurP.uniform1i('uSrc', 0)
        if (pass === 0)
          blurP.uniform2f('uDir', 1.6 / bw, 0)
        else
          blurP.uniform2f('uDir', 0, 1.6 / bh)
        drawPost(blurP)
      }

      // --- composite to the screen ---
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, w, h)
      compP.use()
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, sceneTex)
      compP.uniform1i('uScene', 0)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, bloomTex[0])
      compP.uniform1i('uBloom', 1)
      compP.uniform4f('uDecay', decay[0], decay[1], decay[2], decay[3])
      compP.uniform4f('uRide', ride[0], ride[1], ride[2], ride[3])
      compP.uniform1f('uTime', time)
      drawPost(compP)
    },

    dispose () {
      releaseTargets()
      gl.deleteBuffer(quad)
      for (const m of units.values())
        m.dispose(gl)
      for (const c of [ main, alt ])
        for (const bay of c.bays)
          bay.shell.dispose(gl)
      geoProg.dispose()
      brightP.dispose()
      blurP.dispose()
      compP.dispose()
    },
  }
}
