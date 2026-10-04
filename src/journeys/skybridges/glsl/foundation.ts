import { HASH21 } from '@wjh/glsl/hash'
import { ROT, SD_BOX } from '@wjh/glsl/sdf'
import { fbm2, valueNoise2 } from '@wjh/glsl/noise'


export const foundationGlsl = `
  precision highp float;
  uniform vec2 iResolution;
  uniform float iTime;
  uniform vec2 uPointer;
  uniform float uHeavy;        // 1.0 = heavyEffects on (see-through refraction march)
  uniform sampler2D uEnv;      // equirectangular environment map (unit 0)
  uniform float uEnvLoaded;    // 1.0 once uEnv's image has uploaded
  uniform float uSignalLoss;   // 0..SIGNAL_PEAK, how far the signal has gone

  // ========================= THE SUN GOES OFF ==============================
  //
  // The signal does not fail because the transmitter fails. It fails because
  // the star this whole journey is lit by comes apart, and the last thing the
  // camera does is watch it happen — which is why the reception failure and the
  // event share one clock. lib/signalLoss ramps over fifteen seconds; that ramp
  // is the detonation, and the picture going is the consequence rather than the
  // subject.
  //
  // Every stage below is keyed off this one number, so the whole sequence seeks
  // exactly like everything else does.
  //
  //   0.00-0.10  the flash        — the disc swells, the colour burns to white
  //   0.10-0.45  the shockfront   — a luminous wavefront crosses the whole sky
  //   0.45-1.00  the aftermath    — a ragged cooling coal, and an ember sky
  //
  // The light arrives before the wave, because it does.
  const float SIGNAL_PEAK = 0.86;
  float blast() { return clamp(uSignalLoss / SIGNAL_PEAK, 0.0, 1.0); }

  /** Angular radius of the shockfront, radians. Nought until the flash is out. */
  float blastFront(float b) {
    return smoothstep(0.10, 1.0, b) * 3.4;
  }

  const float PI = 3.14159265359;
  const float SEG = 9.0;         // Z length of each main-deck segment
  const float SPEED = 5.0;       // longer, more legible acts — mirrors kinematics.ts
  const float LOOP_Z = 540.0;    // nine 60-unit sections; mirrored in kinematics.ts
  const float EYE = 1.6;         // first-person eye height above the deck
  const float LOOKAHEAD = 16.0;  // camera anticipation through an authored corner
  const float BENDLEN = 24.0;    // half-length over which each hard turn eases in

  // Material/look state written by the SDF at the nearest hit, read by shading.
  float gThick;   // thin-film thickness proxy + Beer-Lambert depth
  float gFell;    // fracture/darken weight 0..1
  float gSpark;   // shatter sparkle weight 0..1
  float gMat;     // 0 = glass, 1 = train (dark metal), 2 = skyscraper

  // Continuous per-fragment atmosphere (set once by setupAtmosphere()).
  vec3  gBg, gKeyDir, gKeyCol, gGlassTint;
  float gRough, gDisp, gBloom, gFogDen;
  // Section weights (0..1), peaking at each act centre, overlapping:
  // 1 DAWN 2 CONVERGENCE 3 ASCENT 4 HIGH-SPAN 5 TRAIN 6 CATCH 7 FROST 8 HELIX 9 SKYLIGHT
  float gDawn, gConv, gAsc, gSpan, gTrain, gCatch, gFrost, gHelix, gSky;

  // --- hash / noise --------------------------------------------------------
  ${HASH21}
  ${valueNoise2('hash21')}
  ${fbm2({ octaves: 'FBM_OCTAVES', next: 'p *= 2.02;' })}
  ${ROT}

  // --- SDF primitives ------------------------------------------------------
  ${SD_BOX}
  float sdTorus(vec3 p, vec2 t) { vec2 q = vec2(length(p.xy) - t.x, p.z); return length(q) - t.y; }

  // --- easing / physics shapes --------------------------------------------
  float easeIO(float u) { u = clamp(u, 0.0, 1.0); return u * u * (3.0 - 2.0 * u); }
  float accel(float u)  { u = clamp(u, 0.0, 1.0); return u * u; }            // from rest (gravity)
  float decel(float u)  { u = clamp(u, 0.0, 1.0); return 1.0 - (1.0 - u) * (1.0 - u); }
  float win(float z, float a, float b, float c, float d) { return smoothstep(a, b, z) - smoothstep(c, d, z); }

  // --- timeline ------------------------------------------------------------
  float rawPlayerZ() { return iTime * SPEED; }
  float sectionZ() { return mod(rawPlayerZ(), LOOP_Z); }
  float playerZ() { return rawPlayerZ(); }
  float sectionEnv(float center, float halfW) {
    float d = abs(sectionZ() - center);
    d = min(d, LOOP_Z - d);
    return 1.0 - smoothstep(0.0, halfW, d);
  }

  // Restored from the original six-act journey: real angular corners instead
  // of lateral centreline offsets. The final return turn closes the heading so
  // z=540 flows continuously into z=0 on every lap.
  float turnHeading(float z) {
    z = mod(z, LOOP_Z);
    float h = 0.0;
    h += (PI * 0.5)       * smoothstep(90.0  - BENDLEN, 90.0  + BENDLEN, z);
    h += (-PI / 3.0)      * smoothstep(210.0 - BENDLEN, 210.0 + BENDLEN, z);
    h += (PI * 2.0 / 3.0) * smoothstep(390.0 - BENDLEN, 390.0 + BENDLEN, z);
    h += (-PI * 5.0 / 6.0) * smoothstep(510.0 - BENDLEN, 510.0 + BENDLEN, z);
    return h;
  }

  // World -> canonical: undo the local corridor heading around the camera. All
  // straight authored SDFs then occupy the same visibly turning route.
  vec3 unbend(vec3 w) {
    float camZ = playerZ();
    float angle = turnHeading(w.z) - turnHeading(camZ);
    vec2 offset = w.xz - vec2(0.0, camZ);
    offset = rot(-angle) * offset;
    return vec3(offset.x, w.y, offset.y + camZ);
  }

  float pathHeading(float z) {
    return turnHeading(z) - turnHeading(z + LOOKAHEAD);
  }

  // --- vertical path (first-person eye Y), continuous, physically shaped ----
  // E0 = ground eye, E1 = upper-tier eye, ET = train-roof eye. See SPEC.md §4.
  float pathY(float z) {
    z = mod(z, LOOP_Z);
    float E0 = EYE, E1 = 11.6, ET = -2.3;
    if (z < 120.0) return E0;                                              // 1 dawn / 2 convergence
    if (z < 180.0) return mix(E0, E1, easeIO((z - 120.0) / 60.0));         // 3 ascent (climb)
    if (z < 225.0) return E1;                                             // 4 high catwalk
    if (z < 240.0) return mix(E1, E0, accel((z - 225.0) / 15.0));         // 4 jump down
    if (z < 248.0) return E0;                                             // brief lower run
    if (z < 260.0) return mix(E0, ET, accel((z - 248.0) / 12.0));         // 5 leap onto train
    if (z < 288.0) return ET + sin(z * 0.5) * 0.22;                       // 5 ride (sway)
    if (z < 300.0) return ET - accel((z - 288.0) / 12.0) * 37.2;          // 5 free fall
    if (z < 330.0) return mix(-39.5, E0, decel((z - 300.0) / 30.0));      // 6 catch + climb
    if (z < 360.0) return E0;                                             // 6 settle
    if (z < 420.0) return E0 + sin((z - 360.0) * 0.12) * 0.3;             // 7 frost (flat)
    if (z < 480.0) return E0 + sin((z - 420.0) / 60.0 * PI) * 4.0;        // 8 helix rise/fall
    return E0;                                                            // 9 skylight
  }

  // Deck top Y at canonical depth sz, or 1e4 where there is no main deck
  // (jump gaps, the train section, etc — those use other geometry).
  float deckTopAt(float sz) {
    float zz = mod(sz, LOOP_Z);
    if (zz < 225.0) return pathY(sz) - EYE;        // ground / climb / catwalk
    if (zz < 240.0) return 1e4;                     // jump-down gap
    if (zz < 248.0) return 0.0;                     // brief landing deck
    if (zz < 300.0) return 1e4;                     // train section
    if (zz < 540.0) return pathY(sz) - EYE;         // catch / settle / frost / helix / skylight
    return pathY(sz) - EYE;
  }

  // --- atmosphere ----------------------------------------------------------
  void setupAtmosphere() {
    gDawn  = sectionEnv(30.0, 64.0);  gConv  = sectionEnv(90.0, 64.0);  gAsc   = sectionEnv(150.0, 64.0);
    gSpan  = sectionEnv(210.0, 64.0); gTrain = sectionEnv(270.0, 64.0); gCatch = sectionEnv(330.0, 64.0);
    gFrost = sectionEnv(390.0, 64.0); gHelix = sectionEnv(450.0, 64.0); gSky   = sectionEnv(510.0, 64.0);

    float s = 0.0, w;
    vec3 bg = vec3(0.0), kd = vec3(0.0), kc = vec3(0.0), gt = vec3(0.0);
    float ro = 0.0, di = 0.0, bl = 0.0, fd = 0.0;
    // 1 DAWN APPROACH — warm low sun, clear
    w = gDawn;  s += w; bg += w*vec3(0.12,0.13,0.20); kd += w*normalize(vec3(-0.35,0.16,0.92)); kc += w*vec3(1.00,0.76,0.50); gt += w*vec3(0.90,0.93,0.97); ro += w*0.05; di += w*0.020; bl += w*0.40; fd += w*0.013;
    // 2 CONVERGENCE — cool prism, crossing bridges
    w = gConv;  s += w; bg += w*vec3(0.10,0.15,0.26); kd += w*normalize(vec3( 0.30,0.42,0.86)); kc += w*vec3(1.00,0.98,0.98); gt += w*vec3(0.95,0.97,1.00); ro += w*0.03; di += w*0.115; bl += w*0.46; fd += w*0.012;
    // 3 ASCENT — bright opening, climb
    w = gAsc;   s += w; bg += w*vec3(0.13,0.18,0.30); kd += w*normalize(vec3( 0.10,0.34,0.94)); kc += w*vec3(0.82,0.90,1.00); gt += w*vec3(0.86,0.92,1.00); ro += w*0.05; di += w*0.035; bl += w*0.40; fd += w*0.013;
    // 4 HIGH SPAN — teal, thin, vertigo
    w = gSpan;  s += w; bg += w*vec3(0.07,0.17,0.22); kd += w*normalize(vec3(-0.18,0.36,0.91)); kc += w*vec3(0.58,0.92,1.00); gt += w*vec3(0.80,0.94,0.99); ro += w*0.05; di += w*0.050; bl += w*0.42; fd += w*0.018;
    // 5 TRAIN — dramatic side light, energetic
    w = gTrain; s += w; bg += w*vec3(0.18,0.15,0.18); kd += w*normalize(vec3(0.55,0.30,0.78));  kc += w*vec3(1.00,0.82,0.62); gt += w*vec3(0.92,0.94,1.00); ro += w*0.05; di += w*0.045; bl += w*0.58; fd += w*0.016;
    // 6 CATCH — warm golden relief
    w = gCatch; s += w; bg += w*vec3(0.22,0.16,0.14); kd += w*normalize(vec3(0.20,0.40,0.89));  kc += w*vec3(1.00,0.78,0.52); gt += w*vec3(0.96,0.90,0.84); ro += w*0.05; di += w*0.040; bl += w*0.70; fd += w*0.014;
    // 7 FROST GALLERY — cold milky, crossings
    w = gFrost; s += w; bg += w*vec3(0.14,0.18,0.30); kd += w*normalize(vec3(-0.30,0.28,0.91)); kc += w*vec3(0.74,0.84,1.00); gt += w*vec3(0.82,0.88,1.00); ro += w*0.55; di += w*0.020; bl += w*0.30; fd += w*0.026;
    // 8 AURORA HELIX — iridescent dusk, spiral
    w = gHelix; s += w; bg += w*vec3(0.10,0.14,0.26); kd += w*normalize(vec3(0.30,0.40,0.87));  kc += w*vec3(0.62,1.00,0.82); gt += w*vec3(0.90,0.96,1.00); ro += w*0.08; di += w*0.065; bl += w*0.50; fd += w*0.018;
    // 9 SKYLIGHT RELEASE — brilliant bloom
    w = gSky;   s += w; bg += w*vec3(0.30,0.34,0.44);  kd += w*normalize(vec3(0.05,0.55,0.83));  kc += w*vec3(1.00,0.98,0.94); gt += w*vec3(0.97,0.99,1.00); ro += w*0.03; di += w*0.030; bl += w*0.74; fd += w*0.010;

    float inv = 1.0 / max(s, 0.001);
    gBg = bg*inv; gKeyDir = normalize(kd); gKeyCol = kc*inv; gGlassTint = gt*inv;
    gRough = ro*inv; gDisp = di*inv; gBloom = bl*inv; gFogDen = fd*inv;

    // The detonation is applied to the *key light*, not to the sky. Every pane
    // of glass, every rail, every window across the whole run takes its
    // highlight and its tint from gKeyCol — so rewriting it here is what puts
    // the event on the bridge you are standing on rather than only on the
    // backdrop behind it. This is the whole reason the effect goes in here.
    float b = blast();
    if (b > 0.0) {
      // Flash: white-hot, and far brighter than anything in the palette. Then it
      // cools through everything a fire cools through and settles at ember.
      vec3 flash  = vec3(1.60, 1.52, 1.42);
      vec3 ember  = vec3(1.10, 0.30, 0.10);
      // 'lit' is a step — the sun is a fire now and stays one. The *brightness*
      // is a pulse, and the difference matters: a step here multiplies every
      // surface in the scene by six for the rest of the run and the whole frame
      // sits blown out with nothing readable in it. The flash is a moment.
      float lit   = smoothstep(0.0, 0.09, b);
      float cool  = smoothstep(0.16, 0.85, b);
      // Squared by multiplication, never by pow(): GLSL leaves pow(x, y)
      // undefined for negative x, and every one of these arguments is negative
      // for the first half of the sequence. It returns NaN, the NaN reaches the
      // colour, and the whole frame comes out black — which is exactly what it
      // did, and exactly what a screenshot of an exploding sun cannot tell you
      // apart from a very dark exploding sun.
      float pk = (b - 0.045) * 14.0;
      float pulse = exp(-pk * pk);
      vec3 blown  = mix(flash, ember, cool);
      gKeyCol = mix(gKeyCol, blown, lit) * (1.0 + 6.0 * pulse + 0.20 * lit * (1.0 - cool));

      // The sky loses its own colour and takes the fire's.
      gBg = mix(gBg, mix(vec3(0.34, 0.24, 0.15), vec3(0.10, 0.030, 0.024), cool), lit);
      gGlassTint = mix(gGlassTint, vec3(1.00, 0.72, 0.55), lit * 0.8);
      gBloom = mix(gBloom, 0.95, lit * (1.0 - cool * 0.4));
      // Ash. The air stops being clear about a second after the flash.
      gFogDen = mix(gFogDen, 0.052, smoothstep(0.05, 0.55, b));
    }
  }

`
