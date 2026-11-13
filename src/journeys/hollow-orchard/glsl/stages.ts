export const stagesGlsl = `  // --- the twelve stages ---------------------------------------------------
  // Each returns a distance and leaves gMat / gWet / gGlow describing the surface.

  // 1 · THE NURSERY — rows of pale saplings under a low ceiling.
  float sdNursery(vec3 p) {
    float lod = lodAt(p);
    float d   = p.y;
    if (lod > 0.02)
      d += fbm3(vec3(p.x, 0.0, p.z) * 0.55) * 0.35 * lod;
    gMat = 2.0; gWet = 0.15; gGlow = 0.0;

    vec3 q     = p;
    vec2 cell  = floor((p.xz + 1.5) / 3.0);
    q.x        = repS(q.x, 3.0);
    q.z        = repS(q.z, 3.0);
    float rnd  = hash21(cell);
    float hgt  = mix(2.2, 4.4, rnd);
    float lean = (rnd - 0.5) * 0.55;
    q.xz      += vec2(lean, lean * 0.6) * q.y;

    float trunk = sdVertCone(q, hgt, 0.16, 0.045);
    // Fur only on the sick upper half, only nearby, and only with heavy effects —
    // this is the densest stage in the journey and an fbm tap here costs real frames.
    if (uHeavy > 0.5 && lod > 0.02)
      trunk -= rotDisp(p * 0.9, 0.10) * smoothstep(1.2, 2.4, p.y) * (0.4 + uWalk.w) * lod;
    if (trunk < d) { d = trunk; gMat = 1.0; gWet = 0.1; gGlow = 0.0; }

    // A sick little cap on roughly a third of them.
    if (rnd > 0.62) {
      float cap = sdCap(q - vec3(0.0, hgt, 0.0), mix(0.28, 0.5, rnd), 0.22);
      if (cap < d) { d = cap; gMat = 0.0; gWet = 0.45; gGlow = 0.25 + 0.5 * uWalk.w; }
    }

    // Sagging ceiling. Keep the displacement gentle: this term is min'd into the
    // scene distance, so a gradient over 1 makes it a distance *over*estimate and
    // the march steps straight past the trunks, shredding them into fragments.
    float ceil = 6.2 - p.y;
    if (lod > 0.02)
      ceil += fbm3(p * 0.4) * 0.9 * lod;
    if (ceil < d) { d = ceil; gMat = 2.0; gWet = 0.2; gGlow = 0.0; }
    return d;
  }

  // 2 · SPORE CATHEDRAL — caps as vaulting, stems as columns.
  float sdSporeCathedral(vec3 p) {
    float d = p.y + fbm3(vec3(p.x, 0.0, p.z) * 0.4) * 0.25;
    gMat = 2.0; gWet = 0.2; gGlow = 0.0;

    vec3 q    = p;
    vec2 cell = floor((p.xz + 5.5) / 11.0);
    q.x       = repS(q.x, 11.0);
    q.z       = repS(q.z, 11.0);
    float rnd = hash21(cell + 7.7);

    // Stem: a column that thickens into the floor and flares into the vault.
    float stem = length(q.xz) - (0.55 + 0.22 * sin(q.y * 0.35) + q.y * 0.02);
    stem       = max(stem, -p.y);
    stem       = smin(stem, d + 0.6, 1.4);          // fuse the base into the ground

    float capH = mix(8.5, 11.5, rnd);
    float cap  = sdCap(q - vec3(0.0, capH, 0.0), 6.4, 2.2);
    float vault = smin(stem, cap, 1.1);
    float lod   = lodAt(p);
    if (lod > 0.02)
      vault -= rotDisp(p * 0.5, 0.18) * 0.5 * lod;

    if (vault < d) { d = vault; gMat = 0.0; gWet = 0.3; gGlow = 0.35; }
    return d;
  }

  // 3 · MARROW GROVE — long bones stood on end, knuckled at every joint.
  //
  // A trunk is a stack of bones: a shaft that waists between joints and swells
  // into a pair of condyles at each one, with the cartilage line cut between
  // them. One per 4.5 unit cell, jittered off the grid and moved out of the
  // walked line, so the aisle never carves one into a stump hanging in the air.
  // One in five broke off low, on a slant, and shows its marrow (mat 1.3).
  float sdMarrowGrove(vec3 p) {
    // Dark loam under the bone, not more bone: a white floor under white trunks
    // blew the whole grove out to one flat cream.
    float d = p.y + fbm3(vec3(p.x, 0.0, p.z) * 0.7) * 0.2;
    gMat = 2.0; gWet = 0.25; gGlow = 0.0;

    vec3 q    = p;
    vec2 cell = floor((p.xz + 2.25) / 4.5);
    q.x       = repS(q.x, 4.5);
    q.z       = repS(q.z, 4.5);
    float rnd = hash21(cell + 3.1);
    float rn2 = hash21(cell + 17.7);
    float rn3 = fract(rnd * 41.3 + rn2 * 7.9);

    // Off the grid, then clear of the aisle: 1.75 from the walked line.
    float ox  = (rn2 - 0.5) * 0.8;
    float dx0 = cell.x * 4.5 - trackX(cell.y * 4.5);
    float dx  = dx0 + ox;
    if (abs(dx) < 1.75) ox = (dx0 < 0.0 ? -1.75 : 1.75) - dx0;
    q.x -= ox;
    q.z -= (rn3 - 0.5) * 1.3;
    q.xz -= vec2(rn2 - 0.5, rn3 - 0.5) * 0.09 * p.y;   // each one leans its own way

    q.xz *= rot2(q.y * (0.06 + rnd * 0.09) + rnd * 6.0);   // slow twist up the trunk

    float seg   = mix(2.3, 3.3, rnd);                // one bone of the stack
    float jy    = repS(q.y - rn2 * seg, seg);        // height off the nearest joint
    float aj    = abs(jy);
    float r     = mix(0.17, 0.24, rn2) + 0.09 * smoothstep(0.75, 0.15, aj);
    float trunk = length(q.xz) - r;
    float knob  = length(vec3(abs(q.x) - 0.15, jy * 1.25, q.z)) - (0.21 + 0.06 * rn2);
    trunk       = smin(trunk, knob, 0.14);
    trunk      += 0.035 * smoothstep(0.10, 0.0, aj);  // the joint itself

    float top   = mix(7.0, 12.0, rnd);
    float snap  = 0.0;
    if (rn3 > 0.8) {                                  // broken off low, on a slant
      top   = mix(1.1, 3.2, rn2) + q.x * 0.9 + 0.05 * sin(q.z * 9.0 + q.x * 7.0);
      snap  = 1.0;
    }
    float cut   = p.y - top;
    snap       *= step(trunk, cut);
    trunk       = max(trunk, cut);
    trunk       = max(trunk, -p.y - 0.2);
    trunk       = smin(trunk, d + 0.5, 0.9);        // flare into the floor

    if (trunk < d) { d = trunk; gMat = 1.0 + 0.3 * snap; gWet = 0.02 + 0.5 * snap; gGlow = 0.0; }

    // Fallen litter: a long bone with its two heads on most cells, lying
    // whichever way it fell, and on some a cage of ribs standing out of the loam.
    vec3 l    = p;
    l.x       = repS(l.x, 4.5);
    l.z       = repS(l.z + 2.2, 4.5);
    vec2 lc   = floor(vec2(p.x + 2.25, p.z + 4.45) / 4.5);
    float lr  = hash21(lc + 29.3);
    l.x      += 1.15;
    l.xz     *= rot2(lr * 6.28);
    if (lr < 0.68) {
      float len  = mix(0.55, 0.95, fract(lr * 13.7));
      vec3  e    = vec3(len, 0.0, 0.0);
      float bone = sdCapsule(l, vec3(0.0, 0.10, 0.0) - e, vec3(0.0, 0.12, 0.0) + e, 0.065);
      vec3  hd   = vec3(abs(l.x) - len, l.y - 0.12, abs(l.z) - 0.06);
      bone       = smin(bone, length(hd) - 0.105, 0.07);
      if (bone < d) { d = bone; gMat = 1.0; gWet = 0.05; gGlow = 0.0; }
    } else {
      float cx  = l.x - 0.34 * clamp(floor(l.x / 0.34 + 0.5), -2.0, 2.0);
      float rib = length(vec2(length(l.zy - vec2(0.0, -0.1)) - 0.62 + 0.05 * abs(l.x), cx)) - 0.04;
      rib     = smin(rib, sdCapsule(l, vec3(-0.85, 0.5, 0.0), vec3(0.85, 0.5, 0.0), 0.06), 0.05);
      if (rib < d) { d = rib; gMat = 1.0; gWet = 0.05; gGlow = 0.0; }
    }
    return d;
  }

  // 4 · THE ROOT LABYRINTH — a passage dug through earth, braided shut.
  //
  // Three strands twisting about one axis that runs down z: the braid that
  // roots make when they follow the same crack. The 2D distance to a strand is
  // an overestimate on a helix, so it is divided by the helix's slope; far from
  // the bundle the bound alone is returned, which keeps nine strands cheap.
  float sdBraid(vec2 xy, float z, vec2 axis, float r, float k, float rad, float ph) {
    vec2  o     = xy - axis;
    float bound = length(o) - r - rad * 1.3;
    if (bound > 0.35) return bound;
    float d = 1e4;
    for (int i = 0; i < 3; i++) {
      float a = z * k + ph + float(i) * 2.0944;
      d = min(d, length(o - r * vec2(cos(a), sin(a))) - rad * (1.0 + 0.3 * sin(z * 0.7 + a)));
    }
    return d / sqrt(1.0 + r * r * k * k);
  }

  // Half-width and height of the passage at z. The lanterns hang from it too.
  vec2 rootArch(float z) {
    return vec2(1.75 + 0.35 * sin(z * 0.19) + 0.22 * sin(z * 0.071 + 1.3),
                2.55 + 0.30 * sin(z * 0.13 + 0.4));
  }

  float sdRootLabyrinth(vec3 p) {
    float lod = lodAt(p);

    // The passage is centred on the line actually walked. It used to wander on
    // its own sine, half a sway out of phase with the camera, which put the eye
    // inside the earth for most of the section and showed nothing but the bore
    // of the aisle with the roots wound round it.
    vec3 q = vec3(p.x - trackX(p.z), p.y, p.z);

    // A low dug arch that pinches and swells, with a trodden floor at y = 0.
    vec2  wh   = rootArch(p.z);
    float w    = wh.x;
    float h    = wh.y;
    vec2  e    = abs(vec2(q.x, q.y - 0.5 * h + 0.4)) - vec2(w - 0.8, 0.5 * h + 0.4 - 0.8);
    float arch = 0.8 - length(max(e, 0.0)) - min(max(e.x, e.y), 0.0);
    if (lod > 0.02)
      arch += (fbm3(p * vec3(0.9, 1.6, 0.9)) - 0.45) * 0.5 * lod
            - rotDisp(p * 1.1, 0.14) * (0.3 + 0.5 * uWalk.w) * lod;
    float floorD = q.y;
    if (lod > 0.02)
      floorD += fbm3(vec3(p.x, 0.0, p.z) * 0.8) * 0.12 * lod;
    float room = min(arch, floorD);

    // Braids along both shoulders and down the crown of the ceiling.
    float roots = sdBraid(q.xy, p.z, vec2(-w + 0.3, h - 0.6), 0.16, 0.9, 0.075, 0.0);
    roots = min(roots, sdBraid(q.xy, p.z, vec2(w - 0.3, h - 0.7), 0.14, 1.1, 0.065, 1.7));
    roots = min(roots, sdBraid(q.xy, p.z, vec2(0.35 * sin(p.z * 0.09), h - 0.1), 0.22, 0.7, 0.09, 3.1));

    // Roots thrown across the vault from shoulder to shoulder, sagging, one
    // every few metres. Kept above the aisle: lower, it cut them into stubs that
    // floated in the passage like sausages.
    float cz  = floor(p.z / 7.5);
    float rr  = hash11(cz * 7.13 + 2.0);
    float ux  = clamp(q.x / w, -1.0, 1.0);
    float y0  = h - 0.25 - 0.3 * rr - 0.25 * (1.0 - ux * ux);
    vec2  rc  = vec2(q.y - y0, p.z - (cz + 0.5) * 7.5 - q.x * (rr - 0.5) * 0.8);
    float spn = (length(rc) - (0.09 + 0.06 * rr) * (1.0 + 0.6 * ux * ux)) / 1.4;
    roots = min(roots, spn);

    // Rootlets hanging from the ceiling, retracting with distance so they fade
    // rather than pop at the edge of the detail range.
    if (lod > 0.02 && q.y > h - 2.0) {
      vec2  hc  = floor(vec2(q.x / 0.55, p.z / 0.6));
      vec2  hl  = vec2(mod(q.x, 0.55) - 0.275, mod(p.z, 0.6) - 0.3);
      float hr  = hash21(hc + 31.0);
      float len = mix(0.25, 1.5, hr * hr) * lod;
      float top = h + 0.1;
      vec2  off = (vec2(hash21(hc + 3.0), hash21(hc + 9.0)) - 0.5) * 0.2
                + vec2(sin(q.y * 3.0 + hr * 6.0), 0.0) * 0.03;
      float yy  = clamp((top - q.y) / max(len, 0.01), 0.0, 1.0);
      float rl  = length(hl - off) - mix(0.022, 0.005, yy);
      rl = max(rl, top - len - q.y);
      if (hr > 0.35) roots = min(roots, rl);
    }

    float d = smin(room, roots, 0.18);
    gMat = 2.0; gWet = 0.35; gGlow = 0.0;
    if (roots < room) { gMat = 2.4; gWet = 0.55; gGlow = 0.1; }
    return d;
  }

  // 5 · FRUITING BODY — a tube of wet muscle that breathes.
  //
  // A gut, and you are what is in it. The lumen is centred on the walked line,
  // as THE ROOT LABYRINTH is: on its own sine the aisle bored a second, smooth
  // pipe through the wall wherever the two disagreed. Everything is authored in
  // the tube's own coordinates (angle, depth under the wall, z), so the folds,
  // the sphincters and the polyps all ride the wall wherever it goes.
  const float GUT_RING = 9.0;   // metres between sphincters
  const float GUT_R    = 3.1;   // the relaxed lumen

  // Its axis at z, shared with the nodules that grow on its wall.
  vec2 fruitingAxis(float z) {
    return vec2(trackX(z), 1.25 + sin(z * 0.037) * 0.2);
  }

  // x: the lumen's radius at z, folds aside. y: how far into a sphincter, 0..1.
  // The rings clench one after the other, a wave that runs the way you are
  // carried. The ring's index only changes where its profile has died to zero.
  vec2 fruitingBore(float z) {
    float k  = floor(z / GUT_RING);
    float zr = (z - (k + 0.5) * GUT_RING) / 0.9;
    float in_ = exp(-zr * zr);
    float sq = 0.5 + 0.5 * sin(iTime * 0.9 - k * 1.1);
    return vec2(GUT_R - in_ * (0.4 + 0.4 * sq), in_);
  }

  float sdFruitingBody(vec3 p) {
    vec2  o    = p.xy - fruitingAxis(p.z);
    float r    = length(o);
    float a    = atan(o.y, o.x);
    vec2  bore = fruitingBore(p.z);

    // Rugae: nine pillows of muscle round the lumen with a sharp crease between
    // each pair, wandering as they run, drawn tighter where a ring clenches.
    // Nine half-waves, so abs(sin) meets itself across the seam of the atan.
    float fold = abs(sin(a * 4.5 + p.z * 0.11 + 0.7 * sin(p.z * 0.29)));
    float w    = bore.x + breathe(p) - fold * (0.22 + 0.12 * bore.y) - r;   // depth under the wall

    // The fibre of the muscle, stretched along the tube. Only near the wall: a
    // ray down the middle of the lumen takes the bound instead, and that is
    // where the march spends its steps.
    float lod  = lodAt(p);
    float disp = 0.16 * lod;
    if (w < 1.0 && lod > 0.02)
      disp = rotDisp(p * vec3(1.3, 1.3, 0.6), 0.16) * lod;
    float d = w - disp;
    gMat = 0.0; gWet = 1.0; gGlow = 0.15 + 0.5 * uPulse.x;

    // Polyps: one to a cell of (sector, z), on most cells, never the sector
    // underfoot. Each is a stalk and a bulb with a puckered mouth, built in the
    // wall's frame (arc, height, z) and kept well inside its cell, so no cell
    // edge can slice one: they used to sit on the sector boundary, and every
    // one of them was half a sphere.
    float af = (a + PI * 0.5) / TAU * 6.0 + 0.5;
    float ka = floor(af);
    float kz = floor(p.z / 3.0);
    float h1 = hash21(vec2(ka, kz) + 41.0);
    if (h1 > 0.42 && abs(ka) > 0.5 && w < 2.0) {
      float h2  = hash21(vec2(kz, ka) + 17.0);
      float sz  = mix(0.8, 1.5, fract(h2 * 7.3));
      float ac  = (ka + (h2 - 0.5) * 0.45) / 6.0 * TAU - PI * 0.5;
      float zc  = (kz + 0.5 + (h1 - 0.71) * 0.5) * 3.0;
      vec3  l   = vec3((a - ac) * r, w, p.z - zc);
      // They lean the way the tube swallows, and sway.
      l.x      -= (h2 - 0.5) * 0.5 * w;
      l.z      -= (0.2 + 0.15 * sin(iTime * 0.8 + h1 * 20.0)) * w;
      float hg  = 0.55 * sz;
      float rb  = 0.2 * sz * (1.0 + 0.12 * sin(iTime * 1.1 + h2 * 30.0));
      float stalk = sdCapsule(l, vec3(0.0, -0.15, 0.0), vec3(0.0, hg, 0.0), 0.085 * sz);
      float bulb  = length(l - vec3(0.0, hg, 0.0)) - rb;
      float mouth = length(l - vec3(0.0, hg + rb, 0.0)) - rb * 0.6;
      float polyp = smax(smin(stalk, bulb, 0.12 * sz), -mouth, 0.05);
      if (polyp < d + 0.08) { gMat = 3.0; gGlow = 0.5; }
      d = smin(d, polyp, 0.3);
    }
    return d;
  }

  // 6 · TRANSITION — the nursery again, with the floor coming apart.
  float sdTransition(vec3 p) {
    float open = smoothstep(0.0, 1.0, uStage.w / max(uCam.w, 1.0));

    // Floor with a hole that widens as the stage runs out.
    float hole  = length(vec2(p.x, repS(p.z, 60.0))) - open * 14.0;
    float floorD = smax(p.y + fbm3(p * 0.5) * 0.3, -hole, 0.6);
    float d = floorD;
    gMat = 2.0; gWet = 0.3; gGlow = 0.0;

    // Dead saplings, thinning out.
    vec3 q    = p;
    vec2 cell = floor((p.xz + 2.0) / 4.0);
    q.x       = repS(q.x, 4.0);
    q.z       = repS(q.z, 4.0);
    float rnd = hash21(cell + 11.0);
    if (rnd > open * 0.8) {
      float trunk = sdVertCone(q, mix(1.6, 3.4, rnd), 0.13, 0.03);
      if (trunk < d) { d = trunk; gMat = 1.0; gWet = 0.1; gGlow = 0.0; }
    }

    // The shaft wall you are about to drop past. Displaced so it reads as torn
    // earth rather than as a poured concrete pipe.
    float shaft = abs(length(vec2(p.x, repS(p.z, 60.0))) - 15.0) - 1.0
                - rotDisp(p * 0.5, 0.42) * 2.4;
    shaft = max(shaft, -p.y - 2.0);
    if (shaft < d) { d = shaft; gMat = 2.0; gWet = 0.4; gGlow = 0.1; }

    // Roots torn loose from the rim, hanging into the opening.
    vec3 r = p;
    r.z    = repS(r.z, 7.0);
    r.x    = repS(r.x, 5.0);
    float dangle = sdCapsule(r, vec3(0.0, 0.4, 0.0), vec3(0.3, -3.0 * open, 0.2), 0.09);
    if (dangle < d) { d = dangle; gMat = 1.0; gWet = 0.3; gGlow = 0.05; }
    return d;
  }

  // 7 · THE BLOOM — one enormous cap, aperture widening as you fall past it.
  float sdBloom(vec3 p) {
    vec3 q = p;
    q.z    = repS(q.z, 46.0);
    float open = 3.0 + uWalk.z * 9.0;

    float cap  = sdCap(q - vec3(0.0, 7.0, 0.0), 16.0, 6.0);
    float bore = length(vec2(q.x, q.z)) - open;      // the throat you fall through
    float d    = smax(cap, -bore, 0.8);
    d         -= rotDisp(p * 0.35, 0.4) * 0.8;
    gMat = 0.0; gWet = 0.6; gGlow = 0.6;

    // Petal ribs hanging off the rim.
    float a   = atan(q.z, q.x);
    float rib = abs(sin(a * 9.0)) * 0.5 + 0.5;
    d -= rib * 0.35;

    // A sleeve *around* the throat, not a plug inside it: at open = 3 the old
    // radius of 2.85 sat entirely within the 3-unit bore, so the one opening the
    // camera is aimed at was filled with solid stalk and you fell through it.
    // It is a collar hung under the cap, not a column: as a column it ran down
    // forever, the aisle cut it open, and the fall became one flat orange wedge.
    float stalk = length(q.xz) - (open + 1.8);
    stalk = max(stalk, q.y - 7.0);
    stalk = max(stalk, 2.8 - q.y);
    stalk = max(stalk, -bore);
    if (stalk < d) { d = stalk; gMat = 3.0; gWet = 0.9; gGlow = 0.35; }

    // What you fall toward: the bloom's gill funnel, ribbed and narrowing to a
    // throat below. Levelled off a little below the eye, so between throats it
    // is the ground you cross; without it the pitched-down fall looked into fog.
    float r      = length(q.xz);
    float funnel = (q.y + 6.0 - 0.55 * min(r, 12.0)) * 0.85;
    funnel      -= abs(sin(a * 26.0)) * 0.16 * smoothstep(1.0, 6.0, r);
    funnel       = smax(funnel, -(r - open * 0.55), 0.6);
    if (funnel < d) { d = funnel; gMat = 0.0; gWet = 0.75; gGlow = 0.5; }
    return d;
  }

  // 8 · HOST — bodies grown into the wall of the shaft.
  float sdHost(vec3 p) {
    float rad = 5.5 + breathe(p) * 1.6;
    float d   = rad - length(p.xy - vec2(0.0, 1.5));
    gMat = 0.0; gWet = 0.7; gGlow = 0.2;

    for (int i = 0; i < 5; i++) {
      float fi = float(i);
      float a  = fi / 5.0 * TAU + p.z * 0.02;
      vec2  at = vec2(cos(a), sin(a)) * (rad - 0.7);
      vec3  q  = p;
      q.z      = repS(q.z - fi * 2.3, 11.5);

      vec3 base = vec3(at.x, at.y + 1.5, 0.0);
      // torso · head · one reaching arm
      float body = sdCapsule(q, base, base + vec3(-at.x, -at.y, 0.0) * 0.16 + vec3(0.0, 0.9, 0.0), 0.42);
      float head = sdSphere(q - base - vec3(-at.x, -at.y, 0.0) * 0.2 - vec3(0.0, 1.35, 0.0), 0.30);
      float arm  = sdCapsule(q, base + vec3(0.0, 0.7, 0.0),
                             base + vec3(-at.x, -at.y, 0.0) * 0.75 + vec3(0.0, 0.4, 0.0), 0.13);
      float fig  = smin(smin(body, head, 0.16), arm, 0.14);
      d = smin(d, fig, 0.55);
      if (fig < d + 0.4) { gMat = 3.0; gWet = 0.85; gGlow = 0.3 + 0.4 * uPulse.x; }
    }
    d -= rotDisp(p * 0.8, 0.22) * 0.7;
    return d;
  }

  // 9 · THE HARVEST — fruiting bodies hung on cords.
  float sdHarvest(vec3 p) {
    // The shaft is displaced, not a smooth cylinder — a clean tube reads as a
    // flat wall the moment the camera finds a gap between the fruiting bodies.
    float rad = 7.0 - rotDisp(p * 0.45, 0.40) * 2.2;
    float d   = rad - length(p.xy - vec2(0.0, 2.0));
    gMat = 2.0; gWet = 0.4; gGlow = 0.1;

    vec3 q    = p;
    float row = floor(p.z / 5.5);
    q.z       = repS(q.z, 5.5);
    q.x       = repS(q.x, 3.4);
    float rnd = hash21(vec2(row, floor(p.x / 3.4)));

    float drop  = mix(1.5, 5.0, rnd);
    float sway  = sin(iTime * 0.5 + rnd * 6.2) * 0.18;
    vec3  hang  = vec3(sway * drop, 7.0 - drop, 0.0);
    float cord  = sdCapsule(q, vec3(0.0, 7.2, 0.0), hang, 0.035);
    float fruit = sdEllipsoid(q - hang, vec3(0.42, 0.62, 0.42) * mix(0.7, 1.4, rnd));
    fruit      -= breathe(p) * 0.25;

    if (cord < d)  { d = cord;  gMat = 1.0; gWet = 0.2; gGlow = 0.0; }
    if (fruit < d) { d = fruit; gMat = 3.0; gWet = 1.0; gGlow = 0.55 + 0.4 * rnd; }
    return d;
  }

  // 10 · MYCELIAL FALL — no floor, no walls: filament space.
  //
  // One family of hyphae: strands running down the axis the caller left out, on
  // a lattice of pitch s across it. The lattice is bent before it is repeated,
  // so no strand is straight and no two bend alike; 30 % of it never grew; each
  // strand has its own gauge, a few are cords, and all of them swell where a
  // packet of what the orchard feeds on is passing down them. A cell with no
  // strand returns the bound to its neighbours' strands, not a large number,
  // so the march neither oversteps nor crawls.
  float sdHypha(vec2 uv, float along, vec2 s, float r0, float seed, out float pulse) {
    uv += vec2(sin(along * 0.31 + uv.y * 0.7 + seed), cos(along * 0.27 + uv.x * 0.6 + seed * 1.7)) * 0.42
        + vec2(cos(along * 0.93 + seed * 3.1), sin(along * 1.07 + uv.x * 1.3)) * 0.10;
    vec2  id = floor(uv / s + 0.5);
    vec2  q  = uv - id * s;
    float h  = hash21(id + seed);
    pulse    = 0.0;
    if (h < 0.3) return min(s.x - abs(q.x), s.y - abs(q.y)) - r0 * 4.2;
    float g  = fract(h * 7.13);
    float ph = fract(along * 0.07 - iTime * (0.25 + 0.3 * g) + g * 5.0);
    pulse    = smoothstep(0.10, 0.0, abs(ph - 0.5));
    float r  = r0 * (g > 0.86 ? 2.4 : mix(0.45, 1.3, g))
             * (1.0 + 0.22 * sin(along * 1.7 + h * 31.0) + 0.5 * pulse);
    return length(q) - r;
  }

  float sdMycelialFall(vec3 p) {
    gMat = 4.0; gWet = 0.15;

    // Three hyphal families, each on its own lattice and its own heading.
    float pa, pb, pc;
    float da = sdHypha(vec2(p.x, p.y - 1.0), p.z, vec2(2.6), 0.050, 1.3, pa);

    vec3 b = p;
    b.xz *= rot2(0.7);
    float db = sdHypha(b.xz, b.y, vec2(3.1), 0.042, 4.7, pb);

    vec3 c = p;
    c.xy *= rot2(-0.5);
    float dc = sdHypha(c.yz, c.x, vec2(2.2, 4.4), 0.055, 8.9, pc);

    // Where two meet they fuse rather than cross.
    float d  = smin(da, smin(db, dc, 0.12), 0.12);
    float pl = da < min(db, dc) ? pa : (db < dc ? pb : pc);
    gGlow    = 0.22 + 0.78 * pl;

    // Beads of exudate hung in the web, on under half the lattice.
    vec3  ni = floor(vec3(p.x, p.y - 1.0, p.z) / vec3(2.6, 2.2, 4.4) + 0.5);
    vec3  n  = vec3(p.x, p.y - 1.0, p.z) - ni * vec3(2.6, 2.2, 4.4);
    float nh = hash31(ni + 3.7);
    float nr = nh < 0.45 ? mix(0.07, 0.2, fract(nh * 9.7)) : -0.4;
    n       -= (vec3(fract(nh * 5.3), fract(nh * 11.1), fract(nh * 17.9)) - 0.5) * 0.7;
    n.y     *= 0.85;
    float bead = length(n) - nr;
    if (bead < d) { gMat = 3.0; gWet = 1.0; gGlow = 0.75; }
    return smin(d, bead, 0.16);
  }

  // 11 · SEED VAULT — chambered spheres, each with something curled inside.
  float sdSeedVault(vec3 p) {
    float rad = 8.0 - rotDisp(p * 0.4, 0.40) * 2.6;
    float d   = rad - length(p.xy - vec2(0.0, 2.0));
    gMat = 1.0; gWet = 0.1; gGlow = 0.05;

    vec3 q    = p;
    vec2 cell = floor(vec2(p.x, p.z) / 4.4);
    q.x       = repS(q.x, 4.4);
    q.z       = repS(q.z, 4.4);
    q.y       = repS(q.y - 2.0, 4.4);
    float rnd = hash21(cell + 5.5);

    float shell  = sdSphere(q, 1.25);
    float hollow = sdSphere(q, 1.05);
    float pod    = smax(shell, -hollow, 0.04);
    // A window cut into the shell so the embryo shows.
    float win    = sdBox(q - vec3(0.0, 0.0, 1.1), vec3(0.6, 0.6, 0.4));
    pod          = smax(pod, -win, 0.05);

    float embryo = sdEllipsoid(q - vec3(0.0, -0.15, 0.0), vec3(0.5, 0.38, 0.5))
                 - breathe(p) * 0.2;

    if (pod < d)    { d = pod;    gMat = 1.0; gWet = 0.1;  gGlow = 0.1; }
    if (embryo < d) { d = embryo; gMat = 3.0; gWet = 0.95; gGlow = 0.4 + 0.5 * rnd; }
    return d;
  }

  // 12 · COMPOST — everything softened back into sludge.
  float sdCompost(vec3 p) {
    float d = p.y + 2.0
            + fbm3(p * 0.35 + vec3(0.0, 0.0, iTime * 0.02)) * 2.6
            + fbm3(p * 1.4) * 0.5;
    gMat = 2.0; gWet = 0.8; gGlow = 0.0;

    // Half-dissolved lumps of everything you already walked through.
    vec3 q = p;
    q.x = repS(q.x, 5.0);
    q.z = repS(q.z, 5.0);
    float lump = sdEllipsoid(q - vec3(0.0, -1.2, 0.0), vec3(1.4, 0.7, 1.1));
    lump -= fbm3(p * 0.9) * 0.6;
    d = smin(d, lump, 1.2);
    return d;
  }

`
