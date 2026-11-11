import { brdfChunk, deltaChunk, lightingChunk, noiseChunk, shadowChunk, skyLookupChunk } from './chunks'


/**
 * Downtown's towers. A unit box per instance, bent live: lean grows with the
 * square of height along iBend.xy, twist grows linearly, both scaled by the
 * lap gain. Facade coordinates come out in metres so the window grid is real.
 */
export const towerVert = /* glsl */`#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUv;
layout(location = 4) in vec4 iXform;   // pos.xyz, yaw
layout(location = 5) in vec4 iSize;    // w, h, d, seed
layout(location = 6) in vec4 iBend;    // dir.x, dir.z, K, twist
uniform mat4  uViewProj;
uniform float uBendGain;
out vec3 vWorld;
out vec3 vNormal;
out vec2 vFacade;
flat out float vSeed;   // per instance: interpolated, its hash flickered per pixel
out float vRoof;
out float vH;
void main () {
  vec3 lp = aPos * iSize.xyz;
  float h = lp.y;
  float H = iSize.y;
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
  float faceW = abs(aNormal.x) > 0.5 ? iSize.z : iSize.x;
  vFacade = vec2(aUv.x * faceW, h);
  vRoof   = step(0.5, aNormal.y);
  vSeed   = iSize.w;
  vH      = h / H;
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
  float street = 1.0 - smoothstep(4.5, 5.0, vFacade.y);
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
    vec3 tint = mix(vec3(0.3, 0.28, 0.26), vec3(0.46, 0.44, 0.42), hash12(vec2(vSeed, 9.0)));
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
  // Behind the glass: dark rooms, some with the blinds down.
  // Gone while the windows are still a few pixels wide: a random blind per
  // pane at that size is salt and pepper, not offices.
  float blind = step(0.72, hash12(id * 1.3 + vSeed * 3.0)) * (1.0 - smoothstep(0.04, 0.12, max(fw.x, fw.y)));
  vec3 glass = mix(vec3(0.025, 0.04, 0.055), vec3(0.2, 0.19, 0.17), blind);
  glass = mix(glass, vec3(0.05, 0.06, 0.07), far);
  // Street level: shopfronts, glass the whole way along.
  win = mix(win, 0.9, street * (1.0 - glassy));
  vec3 albedo = mix(wall, glass, win);
  rough = mix(rough, mix(0.08, 0.5, blind), win);
  if (vRoof > 0.5) {
    albedo = vec3(0.16, 0.16, 0.15) * (0.8 + 0.4 * vnoise(p.xz * 0.8));
    rough  = 0.9;
    metal  = 0.0;
    win    = 0.0;
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
  col += warm * 1.8 * on * win * (1.0 - street);
  col += vec3(1.0, 0.8, 0.55) * street * (0.25 + 1.2 * dusk) * (1.0 - glassy) * win * (0.7 + 0.3 * hash12(id + 2.0));

  col = applyFog(col, p);
  fragColor = vec4(col, 1.0);
}
`
