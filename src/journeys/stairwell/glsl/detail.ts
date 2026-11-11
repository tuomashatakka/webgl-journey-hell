export const detailGlsl = `// --- surface detail --------------------------------------------------------------

// Everything here is analytic and evaluated once per pixel, at the hit: the
// field and its march are untouched. Every pattern is sampled in the stretch's
// own coordinates, like the textures, so nothing slides at a switch, and every
// pattern finer than a few pixels fades to its own average by the pixel's
// footprint (fp, world metres), so the distance does not shimmer.

float vnoise (vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm2 (vec2 p) { return vnoise(p) * 0.65 + vnoise(p * 2.7 + 5.3) * 0.35; }

// A line every period, half-width w: 1 on the line. Beyond the footprint it
// becomes the fraction of the surface the lines cover.
float groove (float x, float period, float w, float fp) {
  float d = abs(fract(x / period + 0.5) - 0.5) * period;
  float l = 1.0 - smoothstep(w, w + fp, d);
  return mix(l, 2.0 * w / period, smoothstep(period * 0.08, period * 0.35, fp));
}

// A dot of radius r on a grid; o is the offset from the dot's centre.
float dots (vec2 uv, vec2 period, float r, float fp, out vec2 o) {
  o = (fract(uv / period) - 0.5) * period;
  float c = 1.0 - smoothstep(r, r + fp, length(o));
  return mix(c, 3.14159 * r * r / (period.x * period.y), smoothstep(r * 0.6, r * 2.5, fp));
}

// A face's own uv, its axes, and which way is down it: walls get (horizontal,
// vertical) so streaks run down them; tops and soffits get (x, z).
void faceFrame (vec3 n, vec3 p, out vec2 uv, out vec3 tu, out vec3 tv) {
  vec3 a = abs(n);
  if (a.y > a.x && a.y > a.z) { uv = p.xz; tu = vec3(1.0, 0.0, 0.0); tv = vec3(0.0, 0.0, 1.0); }
  else if (a.x > a.z) { uv = p.zy; tu = vec3(0.0, 0.0, 1.0); tv = vec3(0.0, 1.0, 0.0); }
  else { uv = p.xy; tu = vec3(1.0, 0.0, 0.0); tv = vec3(0.0, 1.0, 0.0); }
}

// Run-off: long vertical streaks, darker and browner where water has run down
// a face for years.
float streaks (vec2 uv, float density) {
  float s = vnoise(vec2(uv.x * 2.6, uv.y * 0.11)) * 0.7 + vnoise(vec2(uv.x * 7.0, uv.y * 0.3)) * 0.3;
  return smoothstep(1.0 - density, 1.0 - density * 0.35, s);
}

// Mass concrete: board-formed lifts with their joints and tie holes, run-off
// streaks, efflorescence bleeding out under each lift line, and damp and algae
// toward the water.
void concreteDetail (inout Surface s, vec3 tp, vec3 n, float act, float fp, float wetY) {
  vec2 uv; vec3 tu, tv;
  faceFrame(n, tp, uv, tu, tv);
  float vertical = smoothstep(0.35, 0.75, 1.0 - abs(n.y));
  bool shell = act > 3.5 && act < 4.5;
  float liftH = shell ? 1.0 : 1.5;
  float lift = groove(uv.y, liftH, 0.014, fp);
  float joint = groove(uv.x + floor(uv.y / liftH) * 1.2, 2.4, 0.01, fp) * (shell ? 0.0 : 1.0);
  vec2 o;
  float ties = dots(uv + vec2(0.3, liftH * 0.5), vec2(0.6, liftH * 0.5), 0.022, fp, o) * (shell ? 0.0 : 1.0);
  // The boards the shutter was made of print faintly in each lift.
  float board = vnoise(vec2(uv.x * 0.35, floor(uv.y / 0.15) * 3.1)) - 0.5;
  float run = streaks(uv, 0.42) * vertical;
  float within = fract(uv.y / liftH);
  float bloom = smoothstep(0.55, 0.98, within) * smoothstep(0.55, 0.85, vnoise(vec2(uv.x * 1.6, uv.y * 0.7))) * vertical;
  float mottle = fbm2(tp.xz * 0.35 + tp.y * 0.2);

  float seams = max(lift, joint * 0.35) * vertical;
  s.albedo *= 1.0 + board * 0.12 * vertical;
  s.albedo *= mix(0.86, 1.08, mottle);
  s.albedo = mix(s.albedo, s.albedo * vec3(0.5, 0.47, 0.43), run * 0.65);
  s.albedo = mix(s.albedo, vec3(0.88, 0.87, 0.83), bloom * 0.32);
  s.albedo *= 1.0 - seams * 0.38 - ties * 0.45;
  s.ao *= 1.0 - seams * 0.3 - ties * 0.5;
  // A groove is a small step in the face: tilt the normal across it.
  s.normal = normalize(s.normal - tv * (lift - 2.0 * 0.014 / liftH) * vertical * 0.35);

  // Tops weather differently: dust and dark puddle-stains, no run-off.
  float top = smoothstep(0.6, 0.9, n.y);
  float stain = smoothstep(0.55, 0.8, fbm2(tp.xz * 0.6));
  s.albedo = mix(s.albedo, s.albedo * 0.62, stain * top);
  s.rough = mix(s.rough, 0.45, stain * top * 0.6);

  // Damp below the tide line, algae in it (the spillway's basin).
  float damp = smoothstep(1.4, 0.0, wetY) * step(-60.0, wetY);
  float line = smoothstep(0.12, 0.0, abs(wetY - 0.35 - vnoise(vec2(uv.x * 0.8, 1.0)) * 0.25));
  s.albedo *= mix(1.0, 0.55, damp);
  s.albedo = mix(s.albedo, vec3(0.07, 0.10, 0.05), damp * smoothstep(0.45, 0.75, vnoise(uv * vec2(1.3, 3.0))) * 0.8);
  s.albedo = mix(s.albedo, vec3(0.78, 0.77, 0.72), line * 0.25);
  s.rough = mix(s.rough, 0.3, damp * 0.7);
}

// Steel: plate seams, bolt rows with domed heads, rust run from every joint
// and patches where the coat has gone. paint > 0 is a coated member, with
// chips back to the steel.
void steelDetail (inout Surface s, vec3 tp, vec3 n, float fp, vec3 paint, float paintAmt, float rust, float fixings) {
  vec2 uv; vec3 tu, tv;
  faceFrame(n, tp, uv, tu, tv);
  float vertical = smoothstep(0.3, 0.7, 1.0 - abs(n.y));
  float chips = smoothstep(0.72, 0.78, fbm2(uv * 9.0)) + smoothstep(0.8, 0.86, fbm2(uv * 1.3 + 4.0)) * 0.6;
  chips = saturate(chips);
  s.albedo = mix(s.albedo, paint * (0.85 + 0.3 * vnoise(uv * 0.7)), paintAmt * (1.0 - chips));
  s.rough = mix(s.rough, 0.5, paintAmt * (1.0 - chips));
  s.metal = mix(s.metal, 0.0, paintAmt * (1.0 - chips));

  float seam = max(groove(uv.x, 2.2, 0.008, fp), groove(uv.y, 1.6, 0.008, fp)) * fixings;
  vec2 o;
  // Bolts in pairs of rows either side of each seam, not strung everywhere.
  float bolt = dots(uv + vec2(0.0, 0.07), vec2(0.2, 0.8), 0.02, fp, o);
  vec2 o2;
  float bolt2 = dots(uv + vec2(0.07, 0.0), vec2(1.1, 0.2), 0.02, fp, o2);
  if (bolt2 > bolt) { bolt = bolt2; o = o2; }
  bolt *= fixings;
  s.normal = normalize(s.normal + (tu * o.x + tv * o.y) * 12.0 * bolt);
  s.albedo *= 1.0 - seam * 0.55;
  s.albedo *= 1.0 - bolt * 0.3;
  s.ao *= 1.0 - bolt * 0.3;
  s.ao *= 1.0 - seam * 0.5;

  float rs = streaks(uv + 3.7, 0.5) * vertical;
  float under = smoothstep(0.75, 1.0, fract(uv.y / 1.6)) * vertical;
  float patchR = smoothstep(0.55, 0.85, fbm2(uv * 0.9 + 11.0));
  float r = saturate((rs * 0.7 + under * 0.5 * rs + patchR * 0.6) * rust);
  vec3 rustCol = mix(vec3(0.30, 0.13, 0.05), vec3(0.52, 0.27, 0.10), vnoise(uv * 6.0));
  s.albedo = mix(s.albedo, rustCol, r * 0.8);
  s.rough = mix(s.rough, 0.95, r);
  s.metal = mix(s.metal, 0.0, r);
}

// The flight: a worn path down the middle, grime in the back corner of every
// tread, the anti-slip nosing that is what makes steps read from above, bar
// grating on the steel flights. The tread grid is recomputed exactly as stair()
// lays it, so a nosing stripe is on its nosing.
void treadDetail (inout Surface s, vec3 p, vec3 n, float act, float fp) {
  float k0 = zoneOf(p.z);
  float z0 = k0 < -0.5 ? -gLenP : zoneOffset(k0).z;
  float run = runOf(act);
  float width = pathWidth(act);
  float zf = fract((p.z - z0) / run);
  float dx = p.x - pathXJ(p.z);
  float ax = abs(dx) / width;
  float top = smoothstep(0.5, 0.8, n.y);
  bool steelFlight = (act > 0.5 && act < 1.5) || act > 4.5;
  vec2 tuv = vec2(dx, p.z - z0);

  // Bar grating: bearing bars along the run, cross bars every 10 cm.
  if (steelFlight) {
    float bars = groove(dx, 0.045, 0.012, fp);
    float cross = groove(p.z - z0, 0.1, 0.006, fp);
    float open = (1.0 - bars) * (1.0 - cross);
    s.albedo *= mix(1.0, 0.18, open * top);
    s.ao *= mix(1.0, 0.35, open * top);
    s.metal = mix(s.metal, 0.7, top * (1.0 - open));
  }

  // The worn path: the middle third polished pale, the margins dirty.
  float worn = (1.0 - smoothstep(0.15, 0.55, ax)) * top;
  float margin = smoothstep(0.7, 0.98, ax);
  s.albedo = mix(s.albedo, s.albedo * 1.28 + 0.02, worn * 0.6);
  s.rough = mix(s.rough, s.rough * 0.62, worn);
  s.albedo *= 1.0 - margin * 0.35;

  // Grime collects against the riser behind; the nosing carries a gritty
  // stripe, signal yellow worn back to grey where feet land.
  float back = 1.0 - smoothstep(0.0, 0.22, zf);
  s.albedo *= 1.0 - back * 0.45 * top;
  s.ao *= 1.0 - back * 0.5;
  float noseW = 0.075 / run;
  float stripe = smoothstep(1.0 - noseW - 0.02, 1.0 - noseW, zf) * top;
  float scuff = smoothstep(0.35, 0.8, vnoise(tuv * vec2(6.0, 2.0)) + worn * 0.4);
  vec3 stripeCol = steelFlight ? vec3(0.55, 0.53, 0.48) : vec3(0.62, 0.47, 0.10);
  s.albedo = mix(s.albedo, mix(stripeCol, s.albedo * 1.2, scuff * 0.65), stripe);
  s.rough = mix(s.rough, 0.85, stripe);
  // The arris itself catches the light: a thin bright edge right at the lip.
  float lip = smoothstep(0.985, 1.0, zf) * top;
  s.albedo = mix(s.albedo, vec3(0.7, 0.68, 0.64), lip * 0.5);

  // Chips on the arris and a few cracks across the concrete treads.
  if (!steelFlight) {
    float chip = smoothstep(0.7, 0.8, vnoise(tuv * vec2(3.0, 1.0) + 7.0)) * smoothstep(0.9, 1.0, zf);
    s.albedo *= 1.0 - chip * 0.4;
  }
}

// Rock: strata in the colour as well as the shape, a desert varnish run down
// the faces, and in the shear horizon fissures glowing with the rift's light.
vec3 rockDetail (inout Surface s, vec3 tp, vec3 n, float act, float fp) {
  vec2 uv; vec3 tu, tv;
  faceFrame(n, tp, uv, tu, tv);
  float band = vnoise(vec2(tp.y * 1.1 + vnoise(tp.xz * 0.05) * 3.0, 0.5));
  float band2 = vnoise(vec2(tp.y * 4.2, tp.x * 0.05 + tp.z * 0.05));
  s.albedo *= mix(0.78, 1.18, band) * mix(0.92, 1.06, band2);
  float vertical = smoothstep(0.3, 0.7, 1.0 - abs(n.y));
  float varnish = streaks(uv * 0.6, 0.45) * vertical;
  s.albedo = mix(s.albedo, s.albedo * vec3(0.42, 0.36, 0.32), varnish * 0.55);
  // Bedding planes: thin dark partings every few metres.
  float parting = groove(tp.y + vnoise(uv * 0.2) * 1.5, 2.3, 0.03, fp) * vertical;
  s.albedo *= 1.0 - parting * 0.45;
  s.ao *= 1.0 - parting * 0.4;
  if (act < 4.5) return vec3(0.0);
  // Sparse: a vein only where a much broader mask lets it, so the rock is
  // rock with a few lit faults, not a lit net.
  // Stretched along the strata, so a fault runs with the bedding.
  vec2 fu = vec2(uv.x * 0.16 + tp.z * 0.01, uv.y * 0.8 + vnoise(uv * 0.3) * 0.6);
  float f = abs(vnoise(fu) - 0.5);
  float fissure = 1.0 - smoothstep(0.0, 0.012 + fp * 0.6, f);
  fissure *= smoothstep(0.7, 0.85, vnoise(uv * 0.05 + 3.0));
  float glow = fissure * (0.12 + uRupture * 0.7 + uFinale * 1.0);
  s.albedo *= 1.0 - fissure * 0.6;
  return vec3(0.12, 0.5, 1.0) * glow * (0.75 + 0.25 * sin(gTime * 1.7 + tp.z * 0.3)) * (1.0 - uPurgatory);
}

// Machine detail by act: the turbines' housings have riveted panel rings,
// the conveyor's machinery is hazard-banded, the cooling field's pipes are
// lagged in clad sections with strap bands.
void machineDetail (inout Surface s, vec3 tp, vec3 n, float act, float fp) {
  if (act > 3.5 && act < 4.5) {
    // Aluminium lagging: a seam and two straps every metre along the pipe.
    float strap = groove(tp.z, 1.2, 0.02, fp);
    float lap = groove(tp.z + 0.6, 1.2, 0.005, fp);
    s.albedo = mix(s.albedo, vec3(0.62, 0.62, 0.6), 0.35);
    s.albedo *= 1.0 - lap * 0.5;
    s.albedo = mix(s.albedo, vec3(0.42, 0.43, 0.44), strap * 0.5);
    s.metal = mix(s.metal, 0.6, 0.4);
    s.rough = mix(s.rough, 0.45, 0.5);
  }
  steelDetail(s, tp, n, fp, vec3(0.0), 0.0, act > 2.5 && act < 3.5 ? 0.55 : 0.85, 1.0);
}

vec3 surfaceDetail (inout Surface s, float m, float act, vec3 p, vec3 tp, vec3 n, float fp) {
  bool rockWall = m > 7.5 && ((act > 1.5 && act < 3.5) || act > 4.5);
  if (m > 4.5 && m < 5.5 || rockWall) return rockDetail(s, tp, n, act, fp);
  if (m < 1.5 || m > 7.5) {
    // Height over the water or the ground the concrete stands in.
    float wetY = act < 0.5 ? tp.y - (pathY(0.0, tp.z) - 2.55)
               : act > 3.5 && act < 4.5 ? tp.y - (pathY(4.0, tp.z) - 3.4) : -100.0;
    if (m > 7.5) wetY = -100.0;
    concreteDetail(s, tp, n, act, fp, wetY);
    return vec3(0.0);
  }
  if (m > 5.5 && m < 6.5) { treadDetail(s, p, n, act, fp); return vec3(0.0); }
  if (m > 2.5 && m < 3.5) { machineDetail(s, tp, n, act, fp); return vec3(0.0); }
  // Structural steel. The stair's own: a top rail in worn signal yellow, the
  // stringers in dark oxide, the posts and the knee rail galvanised.
  float dx = abs(p.x - pathXJ(p.z)) - pathWidth(act);
  float hy = p.y - railJ(p.z);
  bool onStair = dx > -0.1 && dx < 0.3 && hy > -0.95 && hy < 1.15;
  if (onStair) {
    if (hy > 0.95) steelDetail(s, tp, n, fp, vec3(0.70, 0.52, 0.10), 0.9, 0.3, 0.0);
    else if (hy < -0.1) steelDetail(s, tp, n, fp, vec3(0.20, 0.21, 0.22), 0.85, 0.6, 1.0);
    else steelDetail(s, tp, n, fp, vec3(0.0), 0.0, 0.25, 0.0);
  } else {
    // The bridge's members carry a dark coat that the weather is winning, so
    // they stand against the bright weather as they do in the preview; its
    // side decks are open bar grating over the drop.
    bool bridge = act > 0.5 && act < 1.5;
    steelDetail(s, tp, n, fp, vec3(0.11, 0.12, 0.13), bridge ? 0.85 : 0.0, act > 2.5 && act < 3.5 ? 0.35 : 0.8, 1.0);
    if (bridge && n.y > 0.7) {
      float bars = groove(tp.x, 0.05, 0.012, fp);
      float cross = groove(tp.z, 0.12, 0.007, fp);
      float open = (1.0 - bars) * (1.0 - cross);
      s.albedo *= mix(1.0, 0.15, open);
      s.ao *= mix(1.0, 0.4, open);
    }
  }
  return vec3(0.0);
}

// --- the weather bridge's rupture -------------------------------------------

// The faults drawn as the preview draws them: hashes joined straight, so a
// fault turns at angles, broken into runs. Returns the distance to the fault.
float jagged (float x, float seed, float coarse, float fine) {
  float c1 = floor(x * coarse);
  float j = mix(hash12(vec2(c1, seed)), hash12(vec2(c1 + 1.0, seed)), fract(x * coarse)) - 0.5;
  float c2 = floor(x * fine);
  return j + (mix(hash12(vec2(c2, seed + 9.0)), hash12(vec2(c2 + 1.0, seed + 9.0)), fract(x * fine)) - 0.5) * 0.25;
}

// How far the rupture has got: nothing on the first traversal, growing on
// every one after it, gone in the residue.
float bridgeRupture () { return saturate(uDecay * 0.45) * (1.0 - uPurgatory); }

// On the deck and the flight: a split every 13 units, a dark gap with a lit
// core and a halo, cold at first and hot as the decay climbs.
vec3 bridgeFaults (inout Surface s, vec3 tp, vec3 n, float fp) {
  float amt = bridgeRupture();
  if (amt < 0.001 || n.y < 0.5) return vec3(0.0);
  float cell = floor(tp.z / 13.0);
  float zl = tp.z - cell * 13.0 - 6.5;
  float x = tp.x - pathX(1.0, tp.z);
  float lean = (hash12(vec2(cell, 3.0)) - 0.5) * 1.2;
  float df = abs(zl - x * lean - jagged(x + cell * 7.0, cell, 1.3, 5.0) * 1.4);
  float run = step(0.3, hash12(vec2(cell, 5.0)));
  float core = 1.0 - smoothstep(0.012, 0.012 + fp, df);
  s.albedo *= 1.0 - exp(-df * 18.0) * 0.8 * run * amt;
  vec3 c = mix(vec3(0.25, 0.72, 1.0), vec3(1.6, 0.42, 0.08), saturate(uDecay * 0.28));
  return c * (core * 2.5 + exp(-df * 7.0) * 0.25) * run * amt;
}

// The weather bridge's sky: the photograph's sun as a veiled disc where the
// light comes from, with a broad warm glow round it.
vec3 bridgeSky (vec3 c, vec3 rd, vec3 sun) {
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float g = max(dot(rd, sun), 0.0);
  return c + vec3(1.0, 0.8, 0.58) * lum * (pow(g, 900.0) * 5.0 + pow(g, 60.0) * 0.45 + pow(g, 8.0) * 0.16);
}

// Once the rupture has begun, two faults torn through the air itself, drawn
// in direction space over whatever lies beyond the bridge's own steel: from
// inside act II the far wall fills the view and the sky is above the frame,
// so a tear only in the sky would never be seen. Near things stand in front
// of it. A dark lip, a white core, a cold halo.
vec3 bridgeTear (vec3 col, vec3 rd, float t) {
  float amt = bridgeRupture() * smoothstep(18.0, 45.0, t);
  if (amt < 0.001) return col;
  float lum = max(dot(col, vec3(0.2126, 0.7152, 0.0722)), 0.3);
  float az = atan(rd.x, rd.z);
  float el = rd.y / max(length(rd.xz), 1e-3);
  for (int i = 0; i < 2; i++) {
    float fi = float(i);
    float fx = az * 1.6 + fi * 2.3;
    float df = abs(el - (0.16 + fi * 0.2 - az * (0.5 - fi * 0.9)) - jagged(fx, fi + 20.0, 5.0, 19.0) * 0.12);
    float run = step(0.25, hash12(vec2(floor(fx * 2.0), fi + 4.0)));
    float core = 1.0 - smoothstep(0.0012, 0.0035, df);
    float halo = exp(-df * 90.0) * 0.5 + exp(-df * 18.0) * 0.1;
    col = mix(col, col * 0.35, exp(-df * 250.0) * run * amt);
    col += (vec3(1.0, 0.97, 0.92) * core * 3.0 + vec3(0.25, 0.72, 1.0) * halo * 2.0) * run * amt * lum;
  }
  return col;
}

// --- the cooling towers' plumes ------------------------------------------------

// The vapour each tower breathes out, in closed form rather than marched: for
// each tower a column of Gaussian density, leaning downwind and widening as it
// climbs, integrated across the ray at its closest approach to the column.
// Twelve evaluations at most, in act V's own coordinates wherever act V is in
// view, and like the clouds it starts and stops with the act's scenery.
vec4 coolingPlumes (vec3 ro, vec3 rd, float maxD, vec3 haze) {
  vec3 off;
  if (gA > 3.5 && gA < 4.5) off = vec3(0.0);
  else if (gB > 3.5 && gB < 4.5) off = gOffB;
  else if (gC > 3.5 && gC < 4.5) off = gOffC;
  else return vec4(0.0);
  float live = max(1.0 - uPurgatory, 0.0);
  float len = actLen(4.0);
  vec3 o = ro - off;
  vec2 r2 = rd.xz;
  float rr = max(dot(r2, r2), 1e-4);
  float trans = 1.0;
  vec3 acc = vec3(0.0);
  for (int j = 0; j < 3; j++) {
    float zc = 42.0 * float(j);
    if (zc < SEAM + 6.0 || zc > len - SEAM - 6.0) continue;
    for (int side = 0; side < 2; side++) {
      float sx = side == 0 ? -1.0 : 1.0;
      float y0 = pathY(4.0, zc) + 18.0;
      vec2 c = vec2(pathX(4.0, zc) + sx * 15.0, zc);
      // Lean downwind: use the lean at the height the ray is at.
      float s0 = dot(c - o.xz, r2) / rr;
      float h = max(o.y + rd.y * s0 - y0, 0.0);
      c.x += h * 0.55;
      c.y += h * 0.12;
      float s = dot(c - o.xz, r2) / rr;
      if (s < 0.0 || s > maxD) continue;
      float y = o.y + rd.y * s;
      h = y - y0;
      if (h < -1.0) continue;
      float R = 4.6 + max(h, 0.0) * 0.32;
      vec2 cp = o.xz + r2 * s - c;
      float d2 = dot(cp, cp);
      float billow = vnoise(vec2(atan(cp.y, cp.x) * 1.5 + h * 0.08, h * 0.22 - gTime * 0.35));
      float body = smoothstep(-1.0, 3.0, h) * exp(-max(h, 0.0) / 34.0);
      float od = 1.77 * R / sqrt(rr) * exp(-d2 / (R * R)) * body * (0.6 + billow * 0.8) * 0.09 * live;
      float a = 1.0 - exp(-od);
      vec3 lit = haze * (1.05 + 0.25 * billow) + vec3(0.06, 0.055, 0.05) * smoothstep(0.0, 20.0, h);
      acc += lit * a * trans;
      trans *= 1.0 - a;
    }
  }
  return vec4(acc, 1.0 - trans);
}

`
