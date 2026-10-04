import { PURGATORY_LENGTH, STAIRWELL_SECTIONS } from '../kinematics'

// The act lengths, from the route table: the shader must agree with the
// simulation about where every seam is, to the unit.
const ACT_LENGTH_GLSL = [
  'float actLen (float a) {',
  `  if (a > 5.5) return ${PURGATORY_LENGTH.toFixed(1)};`,
  ...STAIRWELL_SECTIONS.map(s => `  if (a < ${s.id}.5) return ${(s.end - s.start).toFixed(1)};`),
  `  return ${(STAIRWELL_SECTIONS.at(-1)!.end - STAIRWELL_SECTIONS.at(-1)!.start).toFixed(1)};`,
  '}',
].join('\n')

export const shapeGlsl = `// --- the acts' shape -----------------------------------------------------------

${ACT_LENGTH_GLSL}

// The stair pitches over as the traversals pile up: rise grows, run shortens,
// so the first traversal walks a ~13 degree flight and the fourth falls down
// something near 48.
float riseScale () { return 1.0 + uDecay * 0.45; }
float runScale () { return 1.0 / (1.0 + uDecay * 0.18); }
vec2 treadOf (float a) {
  if (a > 0.5 && a < 1.5) return vec2(0.17, 1.2);
  if (a > 1.5 && a < 2.5) return vec2(0.28, 1.55);
  if (a > 2.5 && a < 3.5) return vec2(0.31, 1.35);
  if (a > 3.5 && a < 4.5) return vec2(0.24, 1.3);
  if (a > 4.5) return vec2(0.22, 1.1);
  return vec2(0.34, 1.45);
}
float slopeOf (float a) { vec2 t = treadOf(a); return t.x * riseScale() / (t.y * runScale()); }
float runOf (float a) { return treadOf(a).y * runScale(); }

float wiggle (float a, float z) {
  if (a < 0.5) return sin(z * 0.032) * 1.2;
  if (a < 1.5) return sin(z * 0.055) * 2.1;
  if (a < 2.5) return sin(z * 0.041) * 1.5;
  if (a < 3.5) return sin(z * 0.072) * 4.4;
  if (a < 4.5) return sin(z * 0.052) * 4.8;
  return sin(z * 0.038 + uFinale * 2.0) * (2.4 + uFinale * 3.0);
}

float pathWidth (float a) {
  if (a < 0.5) return 2.6;
  if (a < 1.5) return 1.6;
  if (a < 2.5) return 2.1;
  if (a < 3.5) return 1.9;
  if (a < 4.5) return 1.8;
  return 1.7;
}

// The joined path, in this act's coordinates. See the header: slopes blend
// through each seam's tunnel by smoothstep, and the rail is that integrated.
float H (float u) { return u * u * u - 0.5 * u * u * u * u; }

float railJ (float z) {
  float sP = slopeOf(gP), sX = slopeOf(gA), sN = slopeOf(gB);
  float T = SEAM;
  float L = gLenA;
  if (z < -T) return (sP * T + 0.1875 * T * (sX - sP)) - sP * (z + T);
  if (z < T) {
    float u = (z + T) / (2.0 * T);
    return -(sP * z + (sX - sP) * 2.0 * T * (H(u) - 0.09375));
  }
  float JT = -(sP * T + 0.8125 * T * (sX - sP));
  if (z < L - T) return JT - sX * (z - T);
  float zn = z - L;
  if (zn < T) {
    float u = (zn + T) / (2.0 * T);
    return gJL - (sX * zn + (sN - sX) * 2.0 * T * (H(u) - 0.09375));
  }
  if (zn < gLenB - T) return gJL - (sX * T + 0.8125 * T * (sN - sX)) - sN * (zn - T);
  // The seam after that: the next act's far wall has to stand where it will
  // stand once the camera is in the next act, bore and all.
  float sF = slopeOf(gC);
  float zf = zn - gLenB;
  if (zf < T) {
    float u = (zf + T) / (2.0 * T);
    return gJLB - (sN * zf + (sF - sN) * 2.0 * T * (H(u) - 0.09375));
  }
  return gJLB - (sN * T + 0.8125 * T * (sF - sN)) - sF * (zf - T);
}

float pathXJ (float z) {
  float xa = wiggle(gA, z);
  float xb = wiggle(gB, z - gLenA) + gOffB.x;
  float xp = wiggle(gP, z + gLenP) - wiggle(gP, gLenP) + wiggle(gA, 0.0);
  float xc = wiggle(gC, z - gLenA - gLenB) + gOffC.x;
  float x = mix(xp, xa, smoothstep(-SEAM, SEAM, z));
  x = mix(x, xb, smoothstep(gLenA - SEAM, gLenA + SEAM, z));
  return mix(x, xc, smoothstep(gLenA + gLenB - SEAM, gLenA + gLenB + SEAM, z));
}

// An act's own straight rail and wiggle, in its own coordinates: what its
// scenery is placed against.
float pathX (float a, float z) { return wiggle(a, z); }
float pathY (float a, float z) { return -z * slopeOf(a); }

// Which act's stretch a point is in, split at the walls' midlines: -1 the act
// behind (never looked at), 0 this one, 1 the next, 2 the one after. Anything
// sampled by position is sampled in its stretch's own coordinates, which do
// not change when the camera changes act.
float zoneOf (float z) { return z < 0.0 ? -1.0 : z < gLenA ? 0.0 : z < gLenA + gLenB ? 1.0 : 2.0; }
float zoneAct (float k) { return k < -0.5 ? gP : k < 0.5 ? gA : k < 1.5 ? gB : gC; }
vec3 zoneOffset (float k) { return k < 0.5 ? vec3(0.0) : k < 1.5 ? gOffB : gOffC; }

// --- the rupture, in the field -------------------------------------------------

// liminal's getFloorCrack: a signed vein noise widened by decay and gated by a
// much lower-frequency mask so the breakage arrives in patches.
float crackField (vec3 p, float decay) {
  float d = clamp(decay * 0.15, 0.0, 0.72) * (1.0 - uPurgatory * 0.45);
  if (d < 0.05) return 0.0;
  float veins = sin(p.x * 3.5 + cos(p.z * 4.5)) * cos(p.z * 3.1 + sin(p.y * 4.0));
  float edge = smoothstep(mix(0.003, 0.045, d), 0.0, abs(veins));
  float mask = smoothstep(0.25, 0.6, sin(p.x * 0.35) * cos(p.z * 0.45) * sin(p.y * 0.25) + d * 0.3);
  return edge * mask * d;
}

// Corruption of the field itself, bounded well under the step factor.
float fieldBoil (vec3 p) {
  float amount = uRupture * (1.0 - uPurgatory * 0.8);
  if (amount < 0.02) return 0.0;
  return sin(p.x * 24.0 + gTime * 32.0) * sin(p.y * 36.0) * sin(p.z * 16.0) * 0.03 * amount;
}

// --- the stair -----------------------------------------------------------------

// A real flight, not a solid ramp: stepped treads with a nosing, a soffit a
// little under the rail line, steel stringers either side, and a balustrade of
// posts and a round top rail. Treads use the joined rail, so the steps follow
// the landing through every seam.
vec2 stair (vec3 p) {
  float px = pathXJ(p.z);
  float dx = p.x - px;
  // Each stretch keeps its own tread: run, width and step grid restart at the
  // walls' midlines, wherever the camera is.
  float k0 = zoneOf(p.z);
  float a = zoneAct(k0);
  float z0 = k0 < -0.5 ? -gLenP : zoneOffset(k0).z;
  float run = runOf(a);
  float width = pathWidth(a);
  float k = floor((p.z - z0) / run);
  float zq = z0 + run * (k + 1.0);
  float top = railJ(zq);

  // The fall's broken path: treads stop being where the eye expects them.
  if (a > 4.5 && a < 5.5) {
    float j = (hash11(k * 7.3) - 0.5) * uFinale;
    top += j * 1.2 + sin((p.z - z0) * 0.18) * uFinale * 1.4 * (1.0 - uPurgatory);
    dx -= j * 1.5;
  }

  float rail = railJ(p.z);
  float tread = max(p.y - top, abs(dx) - width);
  float soffit = (rail - 0.75) - p.y;
  float flight = max(tread, soffit);
  // Nosing: a lip proud of each riser, which is what catches the light.
  float zl = (p.z - z0) - run * (k + 1.0);
  float nose = sdBox(vec3(dx, p.y - top + 0.03, zl + 0.02), vec3(width, 0.03, 0.04));
  flight = min(flight, nose);

  // Noise is sampled in the coordinates of whichever act owns this stretch,
  // so the cracks are where they were when the camera's act changes.
  vec3 pc = p - zoneOffset(k0);
  float near = saturate(1.0 - abs(flight) * 2.6);
  flight -= crackField(pc, uDecay) * 0.16 * near;
  flight += fieldBoil(pc) * near;

  float stringer = sdBox(vec3(abs(dx) - width - 0.06, p.y - rail + 0.45, 0.0), vec3(0.06, 0.32, 1e4));
  // Posts on the stretch's own grid: on this act's they jumped at the switch
  // by however far the act's length is from a multiple of their spacing.
  vec3 postP = vec3(abs(dx) - width - 0.12, p.y - rail - 0.5, mod(p.z - z0, 1.6) - 0.8);
  float posts = sdBox(postP, vec3(0.025, 0.5, 0.025));
  float handrail = length(vec2(abs(dx) - width - 0.12, p.y - rail - 1.02)) - 0.035;
  float steel = min(stringer, min(posts, handrail));

  return steel < flight ? vec2(steel, M_STEEL) : vec2(flight, M_TREAD);
}

`
