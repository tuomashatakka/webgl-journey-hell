export const mainGlsl = `  // ---- main ----------------------------------------------------------------

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;

    // The camera does not move and does not turn — the world bends around it.
    // These three are the only angles in the journey, and none of them belongs to
    // the track: where the rider is looking, and how far their head has lagged
    // the car's roll.
    float yaw   = uRide.x + uPointer.x * 0.55;
    float pitch = uRide.y + uPointer.y * 0.33;
    float roll  = uRide.z;

    vec3 fwd = normalize(vec3(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch)));
    vec3 rgt = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
    vec3 up  = cross(fwd, rgt);

    float cr = cos(roll), sr = sin(roll);
    vec3 r2 = rgt * cr - up * sr;
    up  = rgt * sr + up * cr;
    rgt = r2;

    // Speed widens the lens. Oldest trick in the coaster-cam book, worth every
    // one of its three instructions: nothing else makes 60 km/h feel like 60 km/h
    // in a picture with no motion blur in it.
    float rush = clamp(uCart.y / 20.0, 0.0, 1.0);

    // uCart.y pins rush at twenty metres a second, which was the fastest this
    // railway ever went. The fall goes past that by two orders of magnitude, so
    // the lens keeps opening on a term that has no ceiling in it either.
    vec3 rd = normalize(uv.x * rgt + uv.y * up +
      (mix(1.20, 0.80, rush) - uFall.y * 0.30) * fwd);

    // --- march, in camera space, the one place the ray is straight ---
    //
    // The hit epsilon widens with distance at roughly one pixel per metre of
    // depth, which is the whole reason this journey can be shot down a
    // three-metre bore at all. A ray fired down a long narrow tunnel is grazing
    // the wall for its entire length: every step is small, positive and useless,
    // and with a tight epsilon it burns all hundred and ten of them without ever
    // converging. A cone epsilon ends those rays where the surface is already
    // sub-pixel, and it can only ever stop a march *earlier*, never overshoot it.
    float t = 0.03;
    bool hit = false;
    for (int i = 0; i < 110; i++) {
      float d = mapScene(rd * t);
      if (d < 0.0022 + t * 0.0016) { hit = true; break; }
      // 0.92 rather than natatorium's 0.95: the chapel's fold is a Chebyshev
      // bound rather than a euclidean distance — honest, but slack — and the
      // extra three percent is what stops its ribs stippling.
      t += d * 0.92;
      if (t > T_MAX) break;
    }

    // A ray that ran out of iterations short of T_MAX did not miss — it is
    // crawling along a surface it never quite touched. Calling that a miss is
    // how the chalk drift came to have a sunset in it: one wing-shaped hole
    // through the roof of a tunnel, in exactly the shape of the tunnel.
    if (!hit && t < T_MAX) hit = true;

    float tEnd = min(t, T_MAX);
    vec3 col;

    // A room is a range of *depth*, and a ray that is not looking straight down
    // the track covers less depth than distance. roomAt(tEnd) says a ray fired
    // sideways at ninety metres is ninety metres down the line, which is how the
    // chalk drift came to be lit — and skied — by the room two portals away.
    float zEnd = rd.z * tEnd;

    // The air near the cart, which is what the motes are floating in and what the
    // rush glow is picking up. Not the room at the far end of the ray.
    Room near = roomAt(rd.z * 2.0);

    // What is behind everything, seen from here. Evaluated once: it is both the
    // miss colour and, weighted by how open each room is, the colour the fog
    // tends to — which is the same statement twice, and writing it as two
    // different colours is what turned the overlook's sunset into a grey card.
    vec3 skyC = skyColor(toTrackDir(rd, 45.0), roomAt(zEnd).type, uAtm.y);

    if (hit) {
      vec3 p = rd * t;
      vec3 q = toTrack(p);                       // the one crossing, and it is exact
      vec3 n = calcNormal(q, t);

      // Re-evaluate at the converged point so gMat describes the surface actually
      // hit rather than wherever the normal's last tap happened to land.
      mapTrack(q);

      Room r = roomAt(q.z);

      float rough;
      vec3 emit;
      vec3 albedo = materialAlbedo(gMat, q, n, r, t, rough, emit);

      vec3 vdir = -toTrackDir(rd, p.z);
      col = albedo * directLight(q, n, vdir, rough, calcAO(q, n)) + emit;
    }
    else {
      col = skyC;
    }

    // --- atmosphere ---
    //
    // Sampled along the ray rather than taken from whatever it ended up hitting.
    // Rooms genuinely have different air, and the boundary between two of them is
    // a portal you can see through — so a ray that crosses one is carrying a
    // mixture, and reading the far room's fog all the way back to the lens turns
    // every portal into a colour that snaps.
    //
    // A ray that hit nothing is fogged too, and has to be. It only *looks* like a
    // ray to infinity; in a mine it is fifty metres of the drift's dust and then
    // the hole at the end of it, and skipping the fog there paints the far sky
    // over the near air at full strength.
    //
    // Each sample's fog tends toward the sky in proportion to how open its room
    // is, so a room with the roof off fogs toward exactly what is behind it and
    // the mix is a no-op — which is the only way an open section can have honest
    // aerial perspective on its trestle without laying haze over its own sunset.
    vec3 fogCol = vec3(0.0);
    float dens = 0.0;
    for (int k = 0; k < 3; k++) {
      Room fr = roomAt(zEnd * (0.2 + 0.35 * float(k)));
      fogCol += mix(roomFog(fr.type, fr.grime), skyC, fr.sky);
      dens += fogDensity(fr.type);
    }
    fogCol /= 3.0;
    dens *= (1.0 + uAtm.y * 0.5) / 3.0;

    // The fog has to be *complete* by the march limit, not merely thick.
    //
    // T_MAX is where a ray gives up, and either side of that limit it renders
    // two different things: the sky, or whatever it was about to hit. If any of
    // the surface still shows through at ninety-two metres, the boundary between
    // those two is a step — and since the boundary is the set of directions that
    // just barely reach something, it is a smooth curve across the picture. Over
    // the overlook it was a perfect dark arc hanging in the sunset with no object
    // anywhere near it.
    //
    // Forcing the last quarter of the range to full fog costs nothing (it is
    // already at a few percent there) and makes the seam unrepresentable.
    float f = exp(-tEnd * dens) * (1.0 - smoothstep(T_MAX * 0.72, T_MAX, tEnd));
    col = mix(fogCol, col, f);

    col += lampGlow(rd, tEnd);
    col += shafts(rd, tEnd) * (0.55 + uHeavy * 0.45);
    col += motes(rd, tEnd, near.type, uAtm.y);

    // Grid Run's atmosphere accumulator, which is as close as a single pass gets
    // to motion blur: light picked up along the whole ray, brightest where the
    // ray is shortest — so the walls whipping past the cart glow and the far end
    // of the hall does not. In the void it takes Grid Run's hue ramp with it,
    // because in a room with no light and no colour of its own, the only thing
    // left to tell you how fast you are going is what the steel is doing.
    float pickup = 0.05 / (0.05 + tEnd * 0.6);
    vec3 rushTint = near.type > T_DRIFT + 0.5 && near.type < T_CONCOURSE - 0.5
      ? hue(0.35 + tEnd * 0.02 + uCart.x * 0.004) * 1.4
      : lampTint(near.type);
    col += rushTint * pickup * rush * 0.45 * (1.0 + uFall.y * 2.4);

    // --- inline post (no FBO in a single-pass journey) ---

    // A power cut arriving one lap at a time.
    col *= 1.0 - uAtm.x * 0.28 * step(0.965, hash21(vec2(floor(iTime * 15.0), 3.0)));

    // Vignette, tightened by speed. The tunnel closing in is the sensation.
    col *= 1.0 - smoothstep(0.38, 1.20, length(uv * vec2(1.0, 1.08)))
      * (0.40 + rush * 0.24 + uFall.y * 0.26);

    // Cheap bloom: the bright half of the image added back to itself.
    col += col * smoothstep(0.70, 1.7, dot(col, vec3(0.299, 0.587, 0.114))) * 0.40;

    // Reinhard with a white point rather than a clamp. A clamp is what turns a lit
    // tile wall into featureless paper — everything past the ceiling becomes
    // exactly 1.0 and the grout, the courses and the cracks flatten into one area.
    // This compresses instead, so a highlight stays a highlight and keeps its
    // detail; past 2.7 it is a lamp, and lamps are allowed to be white.
    col = max(col, 0.0);
    col = col * (1.0 + col / (2.7 * 2.7)) / (1.0 + col);

    // atzedent's lift, kept on a short leash and on a very long falloff. Grid Run
    // roots the middle of the frame and multiplies it back up, which is glorious
    // over a lit lattice and ruinous over the void: a sixteenth of nothing is
    // still nothing until you take its square root, and then it is a grey card.
    //
    // The falloff has to reach past the corners. Anything that saturates inside
    // the frame draws its own boundary, and over a smooth gradient — the sunset
    // above the overlook, say — a term that stops changing halfway out is a
    // perfect circle hanging in the sky with nothing behind it.
    col = mix(col, sqrt(col) * 0.90, 0.15 * (1.0 - smoothstep(0.0, 1.6, dot(uv, uv))));

    col = pow(col, vec3(0.94));
    col += (hash21(gl_FragCoord.xy + fract(iTime) * 71.3) - 0.5) * 0.026;

    gl_FragColor = vec4(col, 1.0);
  }

`
