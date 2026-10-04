import { ACES } from '@wjh/glsl/color'


export const skyAndMaterialsGlsl = `// --- sky, air, cloud -------------------------------------------------------------

// Both skies are looked up for every pixel, in uniform control flow, and the
// owner only selects between the results: skyTexel takes derivatives, and a
// derivative inside a branch on whether a ray hit something is undefined.
vec3 skyOf (float owner, vec3 rd) {
  vec3 a = skyRadiance(skyTexel(uSkyA, rd, uSkyInfoA.y), uSkyInfoA.x);
  vec3 b = skyRadiance(skyTexel(uSkyB, rd, uSkyInfoB.y), uSkyInfoB.x);
  vec3 f = skyRadiance(skyTexel(uSkyC, rd, uSkyInfoC.y), uSkyInfoC.x);
  vec3 c = owner < 0.5 ? a : owner < 1.5 ? b : f;
  // The rift: a horizontal slit of light along the floor of the world.
  float rift = exp(-abs(rd.y + 0.05 + sin(rd.x * 8.0) * 0.05) * 55.0);
  c += vec3(0.20, 0.55, 1.0) * rift * uRupture * (0.25 + uFinale * 2.0);
  return c;
}

// The air's colour is the sky's own horizon in that direction, so the haze
// matches the photograph rather than a constant someone picked.
vec3 hazeOf (float owner, vec3 rd) {
  vec3 h = normalize(vec3(rd.x, max(rd.y, 0.0) * 0.4 + 0.04, rd.z));
  vec3 c = owner < 0.5
    ? textureLod(uSkyA, equirectUv(h, uSkyInfoA.y), 5.5).rgb * uSkyInfoA.x
    : owner < 1.5
    ? textureLod(uSkyB, equirectUv(h, uSkyInfoB.y), 5.5).rgb * uSkyInfoB.x
    : textureLod(uSkyC, equirectUv(h, uSkyInfoC.y), 5.5).rgb * uSkyInfoC.x;
  vec3 sun = owner < 0.5 ? uSunA : owner < 1.5 ? uSunB : uSunC;
  float si = owner < 0.5 ? uSkyInfoA.z : owner < 1.5 ? uSkyInfoB.z : uSkyInfoC.z;
  c += vec3(1.0, 0.82, 0.62) * pow(max(dot(rd, sun), 0.0), 9.0) * si * 0.12;
  return c;
}

float hazeDensity (float a) {
  if (a > 5.5) return 0.022;
  if (a < 0.5) return 0.0055;
  if (a < 1.5) return 0.011;
  if (a < 2.5) return 0.004;
  if (a < 3.5) return 0.0045;
  if (a < 4.5) return 0.0055;
  return 0.005;
}

float cloudField (vec3 p) {
  p *= 0.17;
  float sum = 0.0, amp = 0.58;
  for (int i = 0; i < 4; i++) {
    vec3 warp = sin(p.yzx * 1.37 + gTime * vec3(0.19, 0.13, 0.16));
    sum += abs(dot(sin(p + warp * 0.45), cos(p.zxy * 1.11))) * amp;
    p.xy *= rot(0.82 + float(i) * 0.17);
    p.yz *= rot(-0.54 + float(i) * 0.11);
    p = p * 1.68 + vec3(1.7, -1.1, 0.8);
    amp *= 0.52;
  }
  return sum;
}

// The weather bridge's cloud deck, only inside act II's span (in whichever
// coordinates it currently has), lit by that act's sun.
vec4 marchClouds (vec3 ro, vec3 rd, float maxD) {
  // The deck lies along act II's own descent, in act II's own coordinates,
  // wherever act II is in view — this act, the next, or framed in the next
  // one's far bore: the same cloud in the same place either side of every
  // seam. Like the scenery it stops at the walls' faces; it used to run on
  // into the tunnels, and vanish from them at the switch.
  vec3 off, sun;
  if (gA > 0.5 && gA < 1.5) { off = vec3(0.0); sun = uSunA; }
  else if (gB > 0.5 && gB < 1.5) { off = gOffB; sun = uSunB; }
  else if (gC > 0.5 && gC < 1.5) { off = gOffC; sun = uSunC; }
  else return vec4(0.0);
  float len = actLen(1.0);
  float live = max(1.0 - uPurgatory, 0.0);
  vec4 acc = vec4(0.0);
  float t = 2.0;
  for (int i = 0; i < 56; i++) {
    if (uHeavy < 0.5 && i >= 28) break;
    if (t > maxD || acc.a > 0.97) break;
    vec3 p = ro + rd * t;
    vec3 q = p - off;
    if (q.z > SEAM && q.z < len - SEAM) {
      q.x += sin(q.z * 0.025 + gTime * 0.11) * 5.0;
      float layer = abs(q.y - (pathY(1.0, q.z) - 3.5));
      float envelope = 1.0 - smoothstep(1.5, 8.0, layer);
      float shape = cloudField(q) - 0.80 + envelope * 0.12 + sin(q.x * 0.16 + q.z * 0.07) * 0.2;
      float dens = smoothstep(0.02, 0.5, shape) * envelope * live;
      if (dens > 0.01) {
        float l = saturate((shape - cloudField(q + sun * 1.4)) * 1.6 + 0.4);
        vec3 c = mix(vec3(0.16, 0.22, 0.26), vec3(1.0, 0.95, 0.88), l) * (0.35 + l * 1.4);
        c = mix(c, vec3(0.62, 0.22, 0.13), uRupture * 0.5);
        float a = dens * 0.09;
        acc.rgb += c * a * (1.0 - acc.a);
        acc.a += a * (1.0 - acc.a);
      }
      t += mix(0.8, 0.22, dens);
    }
    else t += 1.5;
  }
  return acc;
}

// --- materials -----------------------------------------------------------------

// Which Δ layer a hit is drawn from, and how it is tinted, by material and act.
void materialOf (float m, float a, out float layer, out vec3 tint, out float rough) {
  rough = 1.0;
  tint = vec3(1.0);
  if (m < 1.5) {                       // concrete
    layer = a > 3.5 && a < 4.5 ? MAT_PANEL : MAT_CONCRETE;
    tint = a < 0.5 ? vec3(0.82, 0.84, 0.86) : a > 3.5 && a < 4.5 ? vec3(1.0, 0.98, 0.95) : vec3(0.78);
  } else if (m < 2.5) {                // structural steel
    layer = a > 2.5 && a < 3.5 ? MAT_CORRUGATED : MAT_STEEL;
    tint = a > 2.5 && a < 3.5 ? vec3(0.78, 0.55, 0.36) : vec3(0.62, 0.66, 0.68);
  } else if (m < 3.5) {                // machine
    layer = a > 2.5 && a < 3.5 ? MAT_HAZARD : MAT_STEEL;
    tint = a < 2.5 ? vec3(0.42, 0.58, 0.58) : a > 2.5 && a < 3.5 ? vec3(0.9) : vec3(0.85, 0.5, 0.26);
  } else if (m < 5.5) {                // rock
    layer = a > 2.5 && a < 3.5 ? MAT_DIRT : MAT_ROCK;
    tint = a > 4.5 ? vec3(0.32, 0.30, 0.36) : a > 2.5 && a < 3.5 ? vec3(0.95, 0.78, 0.6) : vec3(0.85, 0.76, 0.68);
  } else if (m < 6.5) {                // treads
    layer = (a > 0.5 && a < 1.5) || a > 4.5 ? MAT_STEEL : MAT_CONCRETE;
    tint = vec3(0.72);
  } else {                             // the barrier walls
    layer = (a > 1.5 && a < 3.5) || a > 4.5 ? MAT_ROCK : MAT_PANEL;
    tint = a > 4.5 ? vec3(0.3) : vec3(0.8);
  }
}

${ACES}

void main () {
  vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
  gTime = mod(iTime, 3600.0);
  // The neighbours come from the simulation, which knows that the fourth
  // shear horizon opens on the residue rather than on the spillway.
  gA = uSection;
  gB = uNextSection;
  gC = uFarSection;
  gP = uPrevSection;
  gLenA = actLen(gA);
  gLenB = actLen(gB);
  gLenC = actLen(gC);
  gLenP = actLen(gP);
  // The far seam's rail height and the next act's origin. railJ reads gJL in
  // its far branch, but the value is only needed there and is computed from
  // the near branches, so the order here is safe.
  {
    float sP = slopeOf(gP), sX = slopeOf(gA), sN = slopeOf(gB);
    float T = SEAM;
    float JT = -(sP * T + 0.8125 * T * (sX - sP));
    gJL = JT - sX * (gLenA - 2.0 * T) - sX * T - 0.1875 * T * (sN - sX);
    // The same again from the next act's origin, one act further on.
    float sF = slopeOf(gC);
    gJLB = gJL - (sX * T + 0.8125 * T * (sN - sX)) - sN * (gLenB - 2.0 * T) - sN * T -
           0.1875 * T * (sF - sN);
  }
  gOffB = vec3(wiggle(gA, gLenA) - wiggle(gB, 0.0), gJL, gLenA);
  gOffC = vec3(gOffB.x + wiggle(gB, gLenB) - wiggle(gC, 0.0), gJLB, gLenA + gLenB);
  gCamZ = uSectionProgress * gLenA;
  gZ0 = uPlayerZ - gCamZ;

  float bob = sin(gTime * 5.2) * 0.035 * (1.0 - uFinale * 0.65);
  vec3 ro = vec3(pathXJ(gCamZ), railJ(gCamZ) + 1.68 + bob, gCamZ);
  float lookZ = gCamZ + 10.0;
  vec3 target = vec3(pathXJ(lookZ), railJ(lookZ) + 1.35, lookZ);
  vec3 forward = normalize(target - ro);
  forward.y -= uFinale * 0.62;
  forward = normalize(forward);
  vec3 right = normalize(cross(forward, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, forward);
  right.xy *= rot(uFinale * 0.18 * sin(gTime * 0.43));
  up = cross(right, forward);
  vec3 rd = normalize(uv.x * right + uv.y * up + mix(1.28, 0.78, uFinale) *
                      (forward + right * uPointer.x * 0.42 + up * uPointer.y * 0.32));

  float t = 0.0;
  vec2 hit = vec2(0.0);
  bool found = false;
  for (int i = 0; i < MAX_STEPS; i++) {
    if (uHeavy < 0.5 && i >= 80) break;
    vec2 h = mapScene(ro + rd * t);
    if (h.x < HIT_EPSILON * (1.0 + t * 0.02)) { hit = h; found = true; break; }
    t += h.x * 0.75;
    if (t > FAR_CLIP) break;
  }
  if (!found) t = FAR_CLIP;

  // Which side of the far seam the ray ends on; for a ray that escapes, it is
  // the far side only if it went *through* the wall, below its top.
  float tSeam = rd.z > 1e-4 ? (gLenA - ro.z) / rd.z : 1e9;
  float tSeamB = rd.z > 1e-4 ? (gLenA + gLenB - ro.z) / rd.z : 1e9;
  // Everything else about a hit follows from where it is. owner, whose sun,
  // sky and air: the stretch's past each wall's midline; a ray that escapes
  // takes the sky beyond a wall only if it went *through* it, below its top.
  // zone, whose coordinates and material: the stretch the hit is in. A wall is drawn in
  // the coordinates of the act beyond it, which become the current ones as
  // the camera passes through, so a tunnel does not change pattern under it,
  // and in the material of the act it closes.
  vec3 pAll = ro + rd * t;
  float owner = 0.0;
  if (found) owner = pAll.z < gLenA ? 0.0 : pAll.z < gLenA + gLenB ? 1.0 : 2.0;
  else if (tSeam < FAR_CLIP && ro.y + rd.y * tSeam < railJ(gLenA) + WALL_TOP) {
    owner = 1.0;
    if (tSeamB < FAR_CLIP && ro.y + rd.y * tSeamB < railJ(gLenA + gLenB) + WALL_TOP) owner = 2.0;
  }
  float zone = zoneOf(pAll.z);
  float act = zoneAct(zone);
  if (found && hit.y > 7.5) {
    zone = pAll.z < 0.5 * gLenA ? 0.0 : pAll.z < gLenA + 0.5 * gLenB ? 1.0 : 2.0;
    act = zoneAct(zone - 1.0);
  }
  vec3 sun = owner < 0.5 ? uSunA : owner < 1.5 ? uSunB : uSunC;
  vec4 info = owner < 0.5 ? uSkyInfoA : owner < 1.5 ? uSkyInfoB : uSkyInfoC;

  // Everything that needs a derivative is taken here, before the branch.
  vec3 skyCol = skyOf(owner, rd);
  vec3 dpx = dFdx(pAll);
  vec3 dpy = dFdy(pAll);

  vec3 col;
  if (found) {
    vec3 p = ro + rd * t;
    vec3 n = calcNormal(p);
    vec3 V = -rd;
    float m = hit.y;

    if (m > 3.5 && m < 4.5) {
      // Emissive: tunnel strips warm, everything else the rift's cold light.
      bool tunnel = abs(p.z - gLenA) < SEAM + 1.0 || abs(p.z) < SEAM + 1.0 ||
                    abs(p.z - gLenA - gLenB) < SEAM + 1.0;
      col = tunnel ? vec3(3.2, 2.6, 1.9)
                   : vec3(0.06, 0.42, 0.9) * (1.0 + sin(gTime * 4.0 + p.z + gZ0) * 0.25);
    } else {
      Surface s;
      // Purgatory is one material and no colour.
      if (m > 6.5 && m < 7.5) {
        // Water: a dark, rippled mirror of its own sky.
        s.albedo = vec3(0.02, 0.03, 0.03);
        vec3 wp = p - zoneOffset(zone);
        s.normal = normalize(n + vec3(sin(wp.x * 2.1 + gTime * 1.3), 0.0, cos(wp.z * 1.7 - gTime)) * 0.025);
        s.rough = 0.06;
        s.metal = 0.0;
        s.ao = 1.0;
        s.height = 0.5;
      } else {
        float layer; vec3 tint; float rmul;
        materialOf(m, act, layer, tint, rmul);
        // Coordinates for the texture: this act's own, so a pattern does not
        // slide when the camera changes act.
        vec3 tp = p - zoneOffset(zone);
        s = sampleTriplanarGrad(layer, tp, n, 4.0, dpx, dpy);
        s.albedo *= tint;
        // The displacement map does two jobs here: crevices hold dirt and
        // shadow (height-weighted occlusion), and on rock and ground it
        // decides where the second material shows through.
        s.ao *= mix(0.55, 1.0, s.height);
        if (m > 4.5 && m < 5.5) {
          float dirt = smoothstep(0.42, 0.25, s.height + (n.y - 0.6) * 0.4);
          s.albedo = mix(s.albedo, s.albedo * vec3(0.62, 0.54, 0.46), dirt);
        }
        s.rough = clamp(s.rough * rmul, 0.04, 1.0);
      }
      if (uPurgatory > 0.8) s.albedo = vec3(dot(s.albedo, vec3(0.3, 0.59, 0.11)));

      float ao = ambientOcclusion(p, n);
      float sh = softShadow(p + n * 0.03, sun, 9.0);
      float sunI = info.z * (1.0 - uPurgatory * 0.85);

      col = shadeBrdf(s, V, sun) * vec3(1.0, 0.93, 0.82) * sunI * sh;
      // Sky fill: a fifth of the sun on a clear day, as it is outdoors; what
      // makes an overcast act soft is that its sun term is small, not that
      // its sky term is large.
      vec3 irr = (owner < 0.5 ? skyIrradiance(uSkyA, s.normal, info.y, info.x)
                : owner < 1.5 ? skyIrradiance(uSkyB, s.normal, info.y, info.x)
                              : skyIrradiance(uSkyC, s.normal, info.y, info.x)) * 0.8;
      // Bounce from the sunlit ground below.
      irr += vec3(0.32, 0.28, 0.22) * sunI * 0.08 * saturate(-s.normal.y * 0.5 + 0.5);
      vec3 R = reflect(rd, s.normal);
      vec2 ruv = equirectUv(R, info.y);
      float rlod = 1.0 + s.rough * 7.0;
      vec3 refl = (owner < 0.5 ? textureLod(uSkyA, ruv, rlod).rgb
                 : owner < 1.5 ? textureLod(uSkyB, ruv, rlod).rgb
                               : textureLod(uSkyC, ruv, rlod).rgb) * info.x;
      col += shadeAmbient(s, V, irr, refl, ao);

      // Inside a seam's tunnel, the strip lights are what you see by.
      float inTunnel = 1.0 - smoothstep(SEAM - 1.0, SEAM + 3.0,
        min(min(abs(p.z - gLenA), abs(p.z)), abs(p.z - gLenA - gLenB)));
      if (inTunnel > 0.0) {
        float ry = railJ(p.z);
        vec3 L = normalize(vec3(pathXJ(p.z), ry + 4.4, p.z) - p);
        float d = length(vec3(pathXJ(p.z), ry + 4.4, p.z) - p);
        col += shadeBrdf(s, V, L) * vec3(3.2, 2.6, 1.9) * inTunnel / (d * d * 0.35 + 1.0) * ao;
      }

      // Cracks: cold rift blue on the first traversal, crossfading to
      // liminal's furnace core as the decay climbs. Mixed in, never added.
      vec3 cp = p - zoneOffset(zone);
      float fracture = abs(sin(cp.x * 2.8 + sin(cp.z * 0.7)) * cos(cp.y * 2.2 + cp.z));
      float crack = smoothstep(0.02 + uRupture * 0.035, 0.0, fracture) * uRupture;
      float heat = saturate(uDecay * 0.28);
      vec3 crackHot = vec3(1.5, 0.12, 0.02) * (1.0 + 2.0 * heat);
      col += mix(vec3(0.05, 0.3, 0.7), crackHot * 0.5, heat) * crack * (0.1 + uFinale * 0.6);
      col = mix(col, crackHot * 0.5, saturate(crackField(cp, uDecay) * 0.55));
    }
  } else {
    col = skyCol;
  }

  // The air, in two pieces: this act's up to the far seam, the next act's past it.
  float dA = owner < 0.5 ? t : min(t, tSeam);
  float dB = owner < 0.5 ? 0.0 : max((owner < 1.5 ? t : min(t, tSeamB)) - tSeam, 0.0);
  float dC = owner < 1.5 ? 0.0 : max(t - tSeamB, 0.0);
  float denA = hazeDensity(gA) + uPurgatory * 0.03;
  float denB = hazeDensity(gB) + uPurgatory * 0.03;
  float denC = hazeDensity(gC) + uPurgatory * 0.03;
  // Height falloff: the haze lies in the low ground, so a ray climbing
  // toward the sky passes through less of it than one looking down the flight.
  float lift = exp(-max(rd.y, 0.0) * 3.0);
  float trA = exp(-denA * dA * lift);
  float trB = exp(-denB * dB * lift);
  float trC = exp(-denC * dC * lift);
  if (!found) { trA = mix(1.0, trA, 0.25); trB = mix(1.0, trB, 0.25); trC = mix(1.0, trC, 0.25); }
  col = ((col * trC + hazeOf(2.0, rd) * (1.0 - trC)) * trB + hazeOf(1.0, rd) * (1.0 - trB)) * trA +
        hazeOf(0.0, rd) * (1.0 - trA);

  vec4 clouds = marchClouds(ro, rd, min(t, FAR_CLIP));
  col = col * (1.0 - clouds.a) + clouds.rgb;

  // The residue takes the whole image with it: colour drains, blacks close.
  if (uPurgatory > 0.001) {
    float luma = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, vec3(luma), uPurgatory * 0.88);
    vec3 c = clamp(col, 0.0, 1.0);
    col = mix(col, c * c * (3.0 - 2.0 * c), uPurgatory * 0.6);
    col *= 1.0 - uPurgatory * 0.20;
  }

  col *= 1.0 - uFinale * 0.18 + sin(gTime * 19.0) * uFinale * 0.025;
  col = max(col, 0.0);
  if (uEncode > 0.5) col = col / (1.0 + col);
  fragColor = vec4(col, 1.0);
}
`
