// column-major 4x4 matrix operations for raw-webgl render loops.
//
// matrices are stored as Float32Array(16) in column-major order, matching
// what webgl's uniformMatrix4fv(loc, false, m) expects when transpose is
// false. column-major means the first four elements are column 0, the next
// four are column 1, and so on:
//
//   m[0]  m[4]  m[8]   m[12]       indices by column:
//   m[1]  m[5]  m[9]   m[13]       col 0 = [0..3],  col 1 = [4..7]
//   m[2]  m[6]  m[10]  m[14]       col 2 = [8..11], col 3 = [12..15]
//   m[3]  m[7]  m[11]  m[15]
//
// every function takes an `out` parameter and returns it, so callers own
// the allocation. this is non-negotiable: a per-frame `new Float32Array`
// inside a render loop is a per-frame gc pause that shows up as periodic
// micro-stutters on mobile devices. pre-allocating matrices once and
// passing them through out-params keeps the hot path allocation-free.
//
// the convention mirrors gl-matrix / sailmatrix / every serious webgl math
// library: out-params, Float32Array backing, column-major layout, and
// right-handed [-1,1] NDC depth range (webgl's default).

export type Vec3 = [number, number, number] | Float32Array

export type Mat4 = Float32Array
export type Mat3 = Float32Array


const EPSILON = 1e-6

// scratch buffer for internal operations that need a temporary matrix
const _scratch = new Float32Array(16)


export function create (): Mat4 {
  const out = new Float32Array(16)
  out[0]    = 1
  out[5]    = 1
  out[10]   = 1
  out[15]   = 1
  return out
}


export function identity (out: Mat4): Mat4 {
  out[0]  = 1
  out[1]  = 0
  out[2]  = 0
  out[3]  = 0
  out[4]  = 0
  out[5]  = 1
  out[6]  = 0
  out[7]  = 0
  out[8]  = 0
  out[9]  = 0
  out[10] = 1
  out[11] = 0
  out[12] = 0
  out[13] = 0
  out[14] = 0
  out[15] = 1
  return out
}


/**
 * Right-handed perspective projection, [-1,1] NDC depth range (the webgl
 * default). For infinite far planes, pass Infinity as `far` — the projection
 * collapses to the standard infinite-far limit where out[10] = -1 and
 * out[14] = -2 * near.
 */
export function perspective (
  out:       Mat4,
  fovYRadians: number,
  aspect:    number,
  near:      number,
  far:       number,
): Mat4 {
  const f  = 1 / Math.tan(fovYRadians / 2)
  const nf = 1 / (near - far)

  out[0]  = f / aspect
  out[1]  = 0
  out[2]  = 0
  out[3]  = 0
  out[4]  = 0
  out[5]  = f
  out[6]  = 0
  out[7]  = 0
  out[8]  = 0
  out[9]  = 0
  out[11] = -1
  out[12] = 0
  out[13] = 0
  out[15] = 0

  if (far === Infinity) {
    out[10] = -1
    out[14] = -2 * near
  }
  else {
    out[10] = (far + near) * nf
    out[14] = 2 * far * near * nf
  }

  return out
}


/**
 * Look-at view matrix. Handles the degenerate case where the forward
 * direction is parallel to `up` by falling back to a different up axis,
 * which prevents NaN from a zero-length cross product.
 */
export function lookAt (
  out:    Mat4,
  eye:    Vec3,
  target: Vec3,
  up:     Vec3,
): Mat4 {
  const ex = eye[0],
    ey     = eye[1],
    ez     = eye[2]
  const tx = target[0],
    ty     = target[1],
    tz     = target[2]
  const ux = up[0],
    uy     = up[1],
    uz     = up[2]

  // forward = normalize(target - eye)
  let fx  = tx - ex
  let fy  = ty - ey
  let fz  = tz - ez
  let len = Math.hypot(fx, fy, fz)
  if (len < EPSILON)
    return identity(out)
  len = 1 / len
  fx *= len
  fy *= len
  fz *= len

  // right = normalize(forward × up)
  let rx = fy * uz - fz * uy
  let ry = fz * ux - fx * uz
  let rz = fx * uy - fy * ux
  len = Math.hypot(rx, ry, rz)

  // degenerate: forward is parallel to up — pick a different up axis
  if (len < EPSILON) {
    const altUp: Vec3 = Math.abs(fz) < 0.9
      ? [ 0, 0, 1 ]
      : [ 1, 0, 0 ]
    rx = fy * altUp[2] - fz * altUp[1]
    ry = fz * altUp[0] - fx * altUp[2]
    rz = fx * altUp[1] - fy * altUp[0]
    len = Math.hypot(rx, ry, rz)
  }

  len = 1 / len
  rx *= len
  ry *= len
  rz *= len

  // up = right × forward
  const upx = ry * fz - rz * fy
  const upy = rz * fx - rx * fz
  const upz = rx * fy - ry * fx

  out[0]  = rx
  out[1]  = upx
  out[2]  = -fx
  out[3]  = 0
  out[4]  = ry
  out[5]  = upy
  out[6]  = -fy
  out[7]  = 0
  out[8]  = rz
  out[9]  = upz
  out[10] = -fz
  out[11] = 0
  out[12] = -(rx * ex + ry * ey + rz * ez)
  out[13] = -(upx * ex + upy * ey + upz * ez)
  out[14] = -(-fx * ex + -fy * ey + -fz * ez)
  out[15] = 1

  return out
}


/**
 * Matrix multiplication: out = a × b. Correctly handles out aliasing a or b
 * by reading all inputs into locals before writing any output elements.
 */
export function multiply (out: Mat4, a: Mat4, b: Mat4): Mat4 {
  const a00 = a[0],
    a01     = a[1],
    a02     = a[2],
    a03     = a[3]
  const a10 = a[4],
    a11     = a[5],
    a12     = a[6],
    a13     = a[7]
  const a20 = a[8],
    a21     = a[9],
    a22     = a[10],
    a23     = a[11]
  const a30 = a[12],
    a31     = a[13],
    a32     = a[14],
    a33     = a[15]

  let b0 = b[0],
    b1   = b[1],
    b2   = b[2],
    b3   = b[3]
  out[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30
  out[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31
  out[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32
  out[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33

  b0 = b[4]; b1 = b[5]; b2 = b[6]; b3 = b[7]
  out[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30
  out[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31
  out[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32
  out[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33

  b0 = b[8]; b1 = b[9]; b2 = b[10]; b3 = b[11]
  out[8]  = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30
  out[9]  = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31
  out[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32
  out[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33

  b0 = b[12]; b1 = b[13]; b2 = b[14]; b3 = b[15]
  out[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30
  out[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31
  out[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32
  out[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33

  return out
}


/**
 * Matrix inverse. Returns null when the matrix is singular (determinant
 * near zero). Correctly handles out aliasing a by reading all 16 elements
 * into locals before writing anything.
 */
export function invert (out: Mat4, a: Mat4): Mat4 | null {
  const a00 = a[0],
    a01     = a[1],
    a02     = a[2],
    a03     = a[3]
  const a10 = a[4],
    a11     = a[5],
    a12     = a[6],
    a13     = a[7]
  const a20 = a[8],
    a21     = a[9],
    a22     = a[10],
    a23     = a[11]
  const a30 = a[12],
    a31     = a[13],
    a32     = a[14],
    a33     = a[15]

  const b00 = a00 * a11 - a01 * a10
  const b01 = a00 * a12 - a02 * a10
  const b02 = a00 * a13 - a03 * a10
  const b03 = a01 * a12 - a02 * a11
  const b04 = a01 * a13 - a03 * a11
  const b05 = a02 * a13 - a03 * a12
  const b06 = a20 * a31 - a21 * a30
  const b07 = a20 * a32 - a22 * a30
  const b08 = a20 * a33 - a23 * a30
  const b09 = a21 * a32 - a22 * a31
  const b10 = a21 * a33 - a23 * a31
  const b11 = a22 * a33 - a23 * a32

  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06
  if (Math.abs(det) < EPSILON)
    return null
  det = 1 / det

  out[0]  = (a11 * b11 - a12 * b10 + a13 * b09) * det
  out[1]  = (-a01 * b11 + a02 * b10 - a03 * b09) * det
  out[2]  = (a31 * b05 - a32 * b04 + a33 * b03) * det
  out[3]  = (-a21 * b05 + a22 * b04 - a23 * b03) * det
  out[4]  = (-a10 * b11 + a12 * b08 - a13 * b07) * det
  out[5]  = (a00 * b11 - a02 * b08 + a03 * b07) * det
  out[6]  = (-a30 * b05 + a32 * b02 - a33 * b01) * det
  out[7]  = (a20 * b05 - a22 * b02 + a23 * b01) * det
  out[8]  = (a10 * b10 - a11 * b08 + a13 * b06) * det
  out[9]  = (-a00 * b10 + a01 * b08 - a03 * b06) * det
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det
  out[11] = (-a20 * b04 + a21 * b02 - a23 * b00) * det
  out[12] = (-a10 * b09 + a11 * b07 - a12 * b06) * det
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det
  out[14] = (-a30 * b03 + a31 * b01 - a32 * b00) * det
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det

  return out
}


/**
 * Compose a TRS matrix from Euler angles (yaw/pitch/roll in radians), a
 * translation, and a uniform scale. This covers the common case for
 * placing objects in a scene without allocating separate rotation,
 * translation, and scale matrices only to multiply them together.
 */
export function fromRotationTranslationScale (
  out:          Mat4,
  yawRadians:   number,
  pitchRadians: number,
  rollRadians:  number,
  tx:           number,
  ty:           number,
  tz:           number,
  scale:        number,
): Mat4 {
  const cy = Math.cos(yawRadians),
    sy     = Math.sin(yawRadians)
  const cp = Math.cos(pitchRadians),
    sp     = Math.sin(pitchRadians)
  const cr = Math.cos(rollRadians),
    sr     = Math.sin(rollRadians)

  // combined rotation: Rz(roll) × Rx(pitch) × Ry(yaw)
  const r00 = cy * cr + sy * sp * sr
  const r01 = sr * cp
  const r02 = -sy * cr + cy * sp * sr
  const r10 = -cy * sr + sy * sp * cr
  const r11 = cr * cp
  const r12 = sr * sy + cy * sp * cr
  const r20 = sy * cp
  const r21 = -sp
  const r22 = cy * cp

  out[0]  = r00 * scale
  out[1]  = r10 * scale
  out[2]  = r20 * scale
  out[3]  = 0
  out[4]  = r01 * scale
  out[5]  = r11 * scale
  out[6]  = r21 * scale
  out[7]  = 0
  out[8]  = r02 * scale
  out[9]  = r12 * scale
  out[10] = r22 * scale
  out[11] = 0
  out[12] = tx
  out[13] = ty
  out[14] = tz
  out[15] = 1

  return out
}


/**
 * Extract the normal matrix (transpose of the inverse of the upper-left 3x3)
 * from a model matrix. Used to transform surface normals correctly when the
 * model matrix includes non-uniform scale. The output is a Mat3 (Float32Array
 * of 9 elements, column-major).
 */
export function normalMatrix (out: Mat3, model: Mat4): Mat3 {
  const inv = invert(_scratch, model)
  if (!inv) {
    out[0] = 1; out[1] = 0; out[2] = 0
    out[3]                         = 0; out[4] = 1; out[5] = 0
    out[6]                                                 = 0; out[7] = 0; out[8] = 1
    return out
  }

  // transpose the upper-left 3x3 of the inverse
  out[0] = inv[0]
  out[1] = inv[4]
  out[2] = inv[8]
  out[3] = inv[1]
  out[4] = inv[5]
  out[5] = inv[9]
  out[6] = inv[2]
  out[7] = inv[6]
  out[8] = inv[10]

  return out
}


/**
 * Transform a 3D point by a 4x4 matrix with perspective divide. The input w
 * component defaults to 1 (an ordinary point, not a direction).
 */
export function transformPoint (out: Vec3, m: Mat4, p: Vec3): Vec3 {
  const x = p[0],
    y     = p[1],
    z     = p[2]
  const w = m[3] * x + m[7] * y + m[11] * z + m[15]

  out[0] = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w
  out[1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w
  out[2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w

  return out
}
