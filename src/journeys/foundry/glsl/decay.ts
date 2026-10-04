export const decayGlsl = `  // ========================== THE DECAY ====================================
  //
  // The lap used to come apart by *bending*: a low-frequency sin/cos pushed
  // through the sample point, so the corridor snaked and breathed. It read as
  // wind. Nothing that only leans ever reads as damage, which is why four laps
  // of it never felt like four laps.
  //
  // The liminal journey has the model for what damage actually looks like:
  // there the world cracks open along a vein field and the distance function
  // itself begins to boil, so surfaces come apart instead of swaying. This is
  // that, in a foundry — the plate splits, and what is behind the plate is the
  // same melt that is under the span.

  /**
   * liminal/shaders.ts getFloorCrack(): a signed noise whose zero set is the
   * crack, widened by the decay, and gated by a much lower-frequency mask so the
   * breakage arrives in patches rather than everywhere at once.
   */
  float crackField(vec3 p, float dec) {
    float d = clamp(dec * 0.62, 0.0, 0.80);
    if (d < 0.05) return 0.0;
    float veins = sin(p.x * 3.5 + cos(p.z * 4.5)) * cos(p.z * 3.1 + sin(p.y * 4.0));
    float edge = smoothstep(mix(0.004, 0.11, d), 0.0, abs(veins));
    float patch = smoothstep(0.1, 0.5,
      sin(p.x * 0.35) * cos(p.z * 0.45) * sin(p.y * 0.25) + d * 0.35);
    return edge * patch * d;
  }

  /**
   * High-frequency corruption of the field itself.
   *
   * The amplitude has to stay well under the march's STEP_K, or it overshoots
   * the first hit and punches holes through the world instead of roughening it.
   * A guard keeps it off the walker's immediate surroundings too: this is a
   * corridor with a camera *inside* it, and a boiling field at arm's length is
   * a face full of static rather than a place coming apart.
   */
  float fieldBoil(vec3 p, float dec) {
    if (dec < 0.02) return 0.0;
    return sin(p.x * 21.0 + iTime * 27.0) * sin(p.y * 33.0) * sin(p.z * 15.0)
      * 0.030 * dec;
  }

  // --- the loop's coordinate system ----------------------------------------
  // The walk is unbounded but the world is not: everything is a function of the
  // position *within* one circuit. cycd() is the signed version — continuous
  // across the seam, which is what lets a ray march through the wrap without
  // ever seeing it.
  float cyc(float z) { return z - CYCLE * floor(z / CYCLE); }
  float cycd(float z) { return z - CYCLE * floor(z / CYCLE + 0.5); }

  float secIndexAt(float zc) { return clamp(floor(zc / SEC_LEN), 0.0, SEC_COUNT - 1.0); }

  /**
   * Deployment coordinate for a mechanism whose station centre is 'ahead' metres
   * in front of the walker. Everything mechanical in the foundry runs on this:
   * nothing is simply *there* when it comes into view — it drives out of the
   * wall as you approach, overshoots on its stops and rings down.
   *
   * This is the closed-form response of the same damped second-order hinge the
   * folding span integrates on the CPU, evaluated against distance rather than
   * time. The walker holds a near-constant pace, so the two are the same curve,
   * and a distance-keyed version costs no state: a hall 200 m away is not being
   * simulated, it is simply not deployed yet.
   */
  float deployAt(float ahead) {
    float x = (DEPLOY_SIGHT - ahead) / DEPLOY_RUN;
    if (x <= 0.0) return 0.0;
    if (x > 4.0) return 1.0;
    // Underdamped, and deliberately slack: it reaches its stops around x = 0.7,
    // overshoots by about a tenth, and is still ringing as you walk up to it.
    return 1.0 - exp(-1.6 * x) * cos(2.2 * x);
  }

  /** Deployment of the station at cyclic position 'sz'. */
  float deployStation(float sz) { return deployAt(cycd(sz - walkZ())); }

  /**
   * The one transition rule, applied at all seven boundaries including the wrap.
   * It has two halves, because a corridor and the machinery bolted to it want
   * different transitions:
   *   t  — the profile funnel. The corridor's width and height ease from one
   *        hall's proportions into the next over the last TRANS metres, so the
   *        walls visibly flare or choke down as you approach the bulkhead.
   *   tf — the machinery dissolve. Morphing one hall's SDF into another's
   *        leaves ghosts hanging in mid-air (a coolant pipe growing out of
   *        nothing halfway down the long run), so instead each hall's fittings
   *        are *eroded* — offset outward until they thin to nothing — over the
   *        last FEAT_FADE metres, and the next hall's are already standing
   *        beyond the doorway when you get there.
   */
  void secBlend(float zc, out float a, out float b, out float t, out float tf) {
    a = secIndexAt(zc);
    float local = zc - a * SEC_LEN;
    t = smoothstep(SEC_LEN - TRANS, SEC_LEN, local);
    tf = smoothstep(SEC_LEN - FEAT_FADE, SEC_LEN, local);
    b = mod(a + 1.0, SEC_COUNT);
  }

  // Per-hall corridor profile: (half-width, ceiling height). The circuit
  // breathes — tight and riveted at the landing, cavernous through the long run,
  // choked down to a slot for the brake run, then opened over the melt.
  vec2 secProfile(float i) {
    if (i < 0.5) return vec2(2.6, 3.6);   // loading bay
    if (i < 1.5) return vec2(3.1, 4.6);   // piston gallery
    if (i < 2.5) return vec2(7.5, 11.0);  // long run
    if (i < 3.5) return vec2(2.6, 3.9);   // coolant tier
    if (i < 4.5) return vec2(4.2, 6.4);   // gearworks
    if (i < 5.5) return vec2(2.1, 3.0);   // brake run
    return vec2(7.8, 8.0);                // furnace floor — wide, for the crossing
  }

  // Per-hall rib and lamp cadence, in metres. Every spacing divides SEC_LEN, so
  // the pattern lands square on each boundary instead of drifting.
  float secRibSpacing(float i) {
    if (i < 0.5) return 3.0;
    if (i < 1.5) return 6.0;
    if (i < 2.5) return 18.0;  // long run: almost nothing to measure against
    if (i < 3.5) return 4.0;
    if (i < 4.5) return 12.0;
    if (i < 5.5) return 3.0;   // brake run: dense, so the pace is legible
    return 9.0;
  }
  float secLampSpacing(float i) {
    if (i < 0.5) return 6.0;
    if (i < 1.5) return 6.0;
    if (i < 2.5) return 18.0;
    if (i < 3.5) return 6.0;
    if (i < 4.5) return 12.0;
    if (i < 5.5) return 4.0;
    return 12.0;
  }

`
