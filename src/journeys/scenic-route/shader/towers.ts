import { brdfChunk, deltaChunk, lightingChunk, noiseChunk, shadowChunk, skyLookupChunk } from './chunks'


/**
 * Downtown's towers. One massing mesh per instance (city.ts): every vertex
 * names a level and an inset, resolved here in metres from iSize and iMass,
 * then bent live: lean grows with the square of height along iBend.xy, twist
 * grows linearly, both scaled by the lap gain. Facade coordinates come out in
 * metres so the window grid is real.
 */
export const towerVert = /* glsl */`#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;     // x sign, level, z sign
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUv;
layout(location = 3) in vec4 aShard;   // inset, part
layout(location = 4) in vec4 iXform;   // pos.xyz, yaw
layout(location = 5) in vec4 iSize;    // w, h, d, seed
layout(location = 6) in vec4 iBend;    // dir.x, dir.z, K, twist
layout(location = 7) in vec4 iMass;    // podium h, setback h, crown inset, mast + plant / 10
uniform mat4  uViewProj;
uniform float uBendGain;
out vec3 vWorld;
out vec3 vNormal;
out vec2 vFacade;
flat out float vSeed;   // per instance: interpolated, its hash flickered per pixel
flat out float vPart;
flat out vec2  vMass;   // street-level height, roof height
out float vRoof;
out float vH;
out float vTip;         // 1 at the mast's top, 0 at its foot
float levelY (float l, float H) {
  float mast  = floor(iMass.w);
  float plant = fract(iMass.w) * 10.0;
  float top   = plant > 0.5 ? H + plant : H - 0.5;
  if (l < 0.5) return 0.0;
  if (l < 1.5) return iMass.x;
  if (l < 2.5) return iMass.y;
  if (l < 3.5) return H;
  if (l < 4.5) return H + 1.1;
  if (l < 5.5) return top;
  return mast > 0.5 ? top + mast : top - 0.5;
}
float insetOf (float id, float W) {
  float podium = iMass.x > 0.0 ? min(1.6, 0.08 * min(iSize.x, iSize.z)) : 0.0;
  if (id < 0.5) return 0.0;
  if (id < 1.5) return podium;
  if (id < 2.5) return iMass.z;
  if (id < 3.5) return iMass.z + 0.35;
  if (id < 4.5) return mix(iMass.z, 0.5 * W, 0.45);
  return 0.5 * W - 0.35;
}
void main () {
  float H  = iSize.y;
  float ix = insetOf(aShard.x, iSize.x);
  float iz = insetOf(aShard.x, iSize.z);
  vec3 lp  = vec3(aPos.x * (iSize.x - 2.0 * ix), levelY(aPos.y, H), aPos.z * (iSize.z - 2.0 * iz));
  float h  = lp.y;
  float ang = iXform.w + iBend.w * (h / H) * uBendGain;
  mat2 R = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
  vec3 n = aNormal;
  lp.xz = R * lp.xz;
  n.xz  = R * n.xz;
  float lean  = min(iBend.z * h * h * uBendGain, 0.36 * H);
  float slope = 2.0 * iBend.z * h * uBendGain;
  vec2 dir = vec2(iBend.x, iBend.y);
  vec3 w = iXform.xyz + lp;
  w.xz += dir * lean;
  // A leaning wall's normal tips back against the lean.
  n.y -= dot(n.xz, dir) * slope;
  n = normalize(n);
  float faceW = abs(aNormal.x) > 0.5 ? iSize.z - 2.0 * iz : iSize.x - 2.0 * ix;
  vFacade = vec2(aUv.x * faceW, h);
  vRoof   = step(0.5, aNormal.y);
  vSeed   = iSize.w;
  vPart   = aShard.y;
  vMass   = vec2(iMass.x > 0.0 ? iMass.x : 5.0, H);
  vH      = h / H;
  vTip    = step(5.5, aPos.y);
  vWorld  = w;
  vNormal = n;
  gl_Position = uViewProj * vec4(w, 1.0);
}
`

/**
 * Facades: two families by seed — concrete with punched windows, and curtain
 * glass with mullions. Windows light up as the sun goes down, cell by cell.
 */
export const towerFrag = /* glsl */`#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
in vec2 vFacade;
flat in float vSeed;
flat in float vPart;
flat in vec2  vMass;
in float vTip;
in float vRoof;
in float vH;
uniform float uSunEl;      // sun elevation, degrees
uniform vec4  uRide;
out vec4 fragColor;
${brdfChunk}
${noiseChunk}
${skyLookupChunk}
${shadowChunk}
${lightingChunk}
${deltaChunk}
void main () {
  vec3 p = vWorld;
  vec3 n = normalize(vNormal);
  // The masonry is a Δ scan, sampled before any branch so its derivatives hold.
  float lay = hash12(vec2(vSeed, 4.0)) < 0.45 ? MAT_PANEL : hash12(vec2(vSeed, 5.0)) < 0.6 ? MAT_CONCRETE : MAT_BRICK;
  Surface sw = sampleTriplanar(lay, p, n, 4.0);
  float glassy = step(0.45, hash12(vec2(vSeed * 7.1, 3.0)));
  vec2 cell = mix(vec2(3.4, 3.7), vec2(2.2, 3.9), glassy);
  vec2 g  = vFacade / cell;
  vec2 f  = fract(g);
  vec2 id = floor(g);
  // The window grid is filtered by its own footprint on screen: where a pixel
  // covers several windows it shows their average, not whichever one it hit.
  // Unfiltered, every tower past a few hundred metres was a field of
  // speckle, and a lit window in it a white pixel.
  vec2 fw  = fwidth(g);
  float far = smoothstep(0.08, 0.3, max(fw.x, fw.y));
  vec2 aa  = max(fw, vec2(1e-4)) * 1.2;
  float win;
  float cover;
  vec3 wall;
  float rough;
  float metal = 0.0;
  // vFacade.y is metres up the wall (vH is the fraction of the tower's height).
  // Street level is the podium where there is one, five metres where not.
  float street = 1.0 - smoothstep(vMass.x - 0.5, vMass.x, vFacade.y);
  if (glassy > 0.5) {
    // Curtain wall: glass everywhere on a mullion grid, each pane bowed a
    // little its own way so the sky breaks up pane by pane.
    vec2 m = smoothstep(vec2(0.05) - aa, vec2(0.05) + aa, f) * (1.0 - smoothstep(vec2(0.95) - aa, vec2(0.95) + aa, f));
    win   = m.x * m.y;
    cover = 0.81;
    wall  = vec3(0.16, 0.17, 0.19);
    rough = 0.35;
    metal = 0.6;
    vec2 tilt = (vec2(hash12(id + vSeed), hash12(id + vSeed + 5.0)) - 0.5) * 0.08 * (1.0 - far);
    vec3 t1 = normalize(cross(n, vec3(0.0, 1.0, 0.0)) + 1e-4);
    n = normalize(n + (t1 * tilt.x + vec3(0.0, tilt.y, 0.0)) * win);
  } else {
    // Masonry: punched windows, a spandrel band at every floor and a ledge
    // that catches the light.
    vec2 lo = vec2(0.14, 0.2);
    vec2 hi = vec2(0.86, 0.8);
    vec2 m = smoothstep(lo - aa, lo + aa, f) * (1.0 - smoothstep(hi - aa, hi + aa, f));
    win   = m.x * m.y;
    cover = 0.43;
    // A city of real stone, not whitewash: limestone, brick, grey concrete
    // or granite by seed, each a little off its neighbour, darkened in rain
    // streaks under every sill and toward the foot.
    float pick = hash12(vec2(vSeed, 9.0));
    vec3 tint = pick < 0.3 ? vec3(0.36, 0.33, 0.28) : pick < 0.55 ? vec3(0.3, 0.15, 0.1) : pick < 0.85 ? vec3(0.26, 0.26, 0.25) : vec3(0.13, 0.13, 0.14);
    tint *= 0.88 + 0.24 * hash12(vec2(vSeed, 10.0));
    float streak = fbm3(vec3(vFacade.x * 0.9, vFacade.y * 0.06, vSeed)) * (1.0 - far);
    tint *= (0.82 + 0.25 * streak) * mix(0.8, 1.0, smoothstep(0.0, 6.0, vFacade.y));
    // The scan only up close: far off it aliases into the same speckle the
    // unfiltered windows did, so it gives way to the tint's own weathering.
    float scanW = 1.0 - smoothstep(10.0, 35.0, length(p - uCamPos));
    wall = mix(tint * (0.85 + 0.3 * fbm3(p * 0.45)), sw.albedo * 0.62, 0.75 * scanW);
    float ledge = (1.0 - smoothstep(0.0, 0.05 + aa.y, f.y)) * (1.0 - far);
    wall *= 1.0 + 0.25 * ledge;
    n = normalize(mix(n, sw.normal, 0.6 * (1.0 - win) * scanW));
    rough = 0.82;
  }
  win = mix(win, cover, far);
  // The top floor of some towers is plant behind louvres, not offices.
  float plantFloor = step(0.5, hash12(vec2(vSeed, 21.0))) * step(vMass.y - 4.0, vFacade.y);
  float louvre     = 0.5 + 0.5 * (1.0 - far) * sin(vFacade.y * 6.2831 / 0.3);
  wall  = mix(wall, vec3(0.2, 0.21, 0.22) * (0.7 + 0.5 * louvre), plantFloor);
  rough = mix(rough, 0.55, plantFloor);
  // No windows above the roof (the parapet), and none in the plant floor.
  win *= (1.0 - step(vMass.y, vFacade.y)) * (1.0 - plantFloor);
  // Behind the glass: dark rooms, some with the blinds down.
  // Gone while the windows are still a few pixels wide: a random blind per
  // pane at that size is salt and pepper, not offices.
  float blind = step(0.72, hash12(id * 1.3 + vSeed * 3.0)) * (1.0 - smoothstep(0.04, 0.12, max(fw.x, fw.y)));
  vec3 glass = mix(vec3(0.025, 0.04, 0.055), vec3(0.12, 0.115, 0.1), blind);
  glass = mix(glass, vec3(0.05, 0.06, 0.07), far);
  // Street level: shopfronts, glass the whole way along.
  win = mix(win, 0.9, street * (1.0 - glassy));
  vec3 albedo = mix(wall, glass, win);
  rough = mix(rough, mix(0.08, 0.5, blind), win);
  if (vPart > 0.5 && vPart < 1.5) {
    // Parapet: the wall's own material, a coping a shade lighter on top.
    albedo = wall * (1.0 + 0.25 * vRoof);
    rough  = 0.85;
    win    = 0.0;
  } else if (vRoof > 0.5) {
    // Roofs and terraces: gravel ballast over the membrane.
    albedo = vec3(0.16, 0.16, 0.15) * (0.8 + 0.4 * vnoise(p.xz * 0.8));
    rough  = 0.9;
    metal  = 0.0;
    win    = 0.0;
  }
  if (vPart > 1.5) {
    // Plant room in grey cladding with louvre bands; the mast in steel.
    float band = 0.5 + 0.5 * sin(vFacade.y * 6.2831 / 0.4);
    albedo = vPart < 2.5 ? vec3(0.32, 0.33, 0.34) * (0.75 + 0.35 * band * (1.0 - far)) : vec3(0.3, 0.3, 0.31);
    rough  = 0.5;
    metal  = 0.7;
    win    = 1.0;
  }
  float sh = shadowAt(p, n, uSunDir);
  vec3 col = lightSurface(p, n, albedo, rough, metal * win, 1.0, sh);

  // Lights come on with dusk, more of them every lap; by day, only the
  // shopfronts. Far off, the lit share of the windows as a glow, not dots.
  // Ascending edges: smoothstep with edge0 above edge1 is undefined in GLSL,
  // and here it lit half the windows at noon, a white speckle on every tower.
  float dusk  = 1.0 - smoothstep(2.0, 11.0, uSunEl);
  float share = 0.55 * dusk;
  float on    = mix(step(1.0 - share, hash12(id + vSeed * 13.0)), share, far);
  vec3 warm   = mix(vec3(1.0, 0.72, 0.42), vec3(0.85, 0.9, 1.0), step(0.7, hash12(id * 1.7 + vSeed)) * (1.0 - far));
  // Each lit room its own brightness, brighter at the ceiling than the sill;
  // one flat value per window read as a wall of blown white tiles.
  float room = mix((0.35 + 0.65 * hash12(id * 2.3 + vSeed)) * mix(0.55, 1.15, f.y), 0.6, far);
  col += warm * 1.6 * room * on * win * (1.0 - street) * step(vPart, 0.5);
  col += vec3(1.0, 0.8, 0.55) * street * (0.25 + 1.2 * dusk) * (1.0 - glassy) * win * (0.7 + 0.3 * hash12(id + 2.0)) * step(vPart, 0.5);
  // A red obstruction lamp on the top of every mast, slow-blinking at dusk.
  float lamp = step(2.5, vPart) * smoothstep(0.85, 1.0, vTip);
  col += vec3(1.0, 0.05, 0.02) * 8.0 * dusk * lamp * smoothstep(-0.2, 0.2, sin(uTime * 2.4 + vSeed));

  col = applyFog(col, p);
  fragColor = vec4(col, 1.0);
}
`
