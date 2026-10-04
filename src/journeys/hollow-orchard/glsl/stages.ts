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

  // 3 · MARROW GROVE — bone-white trunks, knuckled, twisted.
  float sdMarrowGrove(vec3 p) {
    float d = p.y + fbm3(vec3(p.x, 0.0, p.z) * 0.7) * 0.2;
    gMat = 1.0; gWet = 0.05; gGlow = 0.0;

    vec3 q    = p;
    vec2 cell = floor((p.xz + 2.25) / 4.5);
    q.x       = repS(q.x, 4.5);
    q.z       = repS(q.z, 4.5);
    float rnd = hash21(cell + 3.1);

    q.xz *= rot2(q.y * (0.06 + rnd * 0.09));        // slow twist up the trunk
    float r     = 0.30 + 0.07 * sin(q.y * 3.0 + rnd * 6.0);  // knuckles
    float trunk = length(q.xz) - r;
    trunk       = max(trunk, p.y - mix(7.0, 12.0, rnd));
    trunk       = max(trunk, -p.y - 0.2);
    trunk       = smin(trunk, d + 0.5, 0.9);        // flare into the floor

    if (trunk < d) { d = trunk; gMat = 1.0; gWet = 0.02; gGlow = 0.0; }

    // Fallen litter.
    vec3 l    = p;
    l.x       = repS(l.x, 4.5) + 1.4;
    l.z       = repS(l.z + 2.2, 4.5);
    float bone = sdCapsule(l, vec3(-0.9, 0.13, 0.0), vec3(0.9, 0.13, 0.25), 0.11);
    if (bone < d) { d = bone; gMat = 1.0; gWet = 0.05; gGlow = 0.0; }
    return d;
  }

  // 4 · THE ROOT LABYRINTH — a carved corridor, braided shut.
  float sdRootLabyrinth(vec3 p) {
    // Interior of a box: negating keeps the march bounded no matter how the
    // roots below chew into it.
    vec2 c     = vec2(sin(p.z * 0.06) * 1.6, 0.0);
    float room = -sdBox(p - vec3(c.x, 1.7, 0.0), vec3(2.4, 1.9, 1e4));
    float d  = room;
    gMat = 2.0; gWet = 0.35; gGlow = 0.0;

    // Braided roots fused into the walls.
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      float ph = fi * 1.7 + p.z * (0.18 + fi * 0.04);
      vec3 a   = vec3(c.x + cos(ph) * 2.1, 1.7 + sin(ph) * 1.5, p.z - 3.0);
      vec3 b   = vec3(c.x + cos(ph + 0.9) * 2.1, 1.7 + sin(ph + 0.9) * 1.5, p.z + 3.0);
      float rt = sdCapsule(p, a, b, 0.20 + 0.08 * sin(p.z * 0.9 + fi));
      d = smin(d, rt, 0.35);
    }
    d -= rotDisp(p * 1.1, 0.14) * (0.5 + uWalk.w * 0.5);
    if (d < room - 0.01) { gMat = 2.0; gWet = 0.5; gGlow = 0.1; }
    return d;
  }

  // 5 · FRUITING BODY — a tube of wet muscle that breathes.
  float sdFruitingBody(vec3 p) {
    vec2 c    = vec2(sin(p.z * 0.05) * 1.2, 1.5 + sin(p.z * 0.037) * 0.5);
    float rad = 2.5
              + breathe(p)
              + sin(p.z * 0.5) * 0.28                 // sphincter rings
              - rotDisp(p * 1.3, 0.30);
    float d = rad - length(p.xy - c);
    gMat = 0.0; gWet = 1.0; gGlow = 0.15 + 0.5 * uPulse.x;

    // Polyps clinging to the wall.
    vec3 q = p;
    q.z    = repS(q.z, 6.0);
    float a = atan(p.y - c.y, p.x - c.x);
    float k = floor(a / TAU * 7.0);
    float pr = 0.34 + 0.2 * hash11(k + floor(p.z / 6.0) * 13.0);
    vec3 pc = vec3(c.x + cos(k / 7.0 * TAU) * rad * 0.9,
                   c.y + sin(k / 7.0 * TAU) * rad * 0.9,
                   0.0);
    float polyp = sdSphere(q - pc, pr) - breathe(p) * 0.3;
    if (polyp < d) { d = polyp; gMat = 3.0; gWet = 1.0; gGlow = 0.5; }
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
    float stalk = length(q.xz) - (open + 1.8);
    stalk = max(stalk, q.y - 7.0);
    stalk = max(stalk, -bore);
    if (stalk < d) { d = stalk; gMat = 3.0; gWet = 0.9; gGlow = 0.35; }
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
  float sdMycelialFall(vec3 p) {
    float d = 1e4;
    gMat = 4.0; gWet = 0.15; gGlow = 0.85;

    // Three axis-aligned hyphal families, each on its own lattice.
    vec3 a = p;
    a.x = repS(a.x, 2.6); a.y = repS(a.y - 1.0, 2.6);
    d = min(d, length(a.xy) - 0.045);

    vec3 b = p;
    b.xz *= rot2(0.7);
    b.x = repS(b.x, 3.1); b.z = repS(b.z, 3.1);
    d = min(d, length(b.xz) - 0.038);

    vec3 c = p;
    c.xy *= rot2(-0.5);
    c.y = repS(c.y, 2.2); c.z = repS(c.z, 4.4);
    d = min(d, length(c.yz) - 0.05);

    // Nodes where the families cross.
    vec3 n = vec3(repS(p.x, 2.6), repS(p.y - 1.0, 2.2), repS(p.z, 4.4));
    d = smin(d, length(n) - 0.16, 0.2);
    return d;
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
