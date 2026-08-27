// THE STAIRWELL — six open industrial landscapes sharing one traversable path.
//
// The Protean Weather Bridge uses an original deformed-periodic cloud field and
// density-aware step size. It is technically inspired by Nimitz's Protean Clouds
// (Shadertoy 3l23Rh), but does not copy its field, constants, camera, or palette.

export const vsQuad = `
  attribute vec2 position;
  void main () {
    gl_Position = vec4(position, 0.0, 1.0);
  }
`

export const fsScene = `
  precision highp float;

  uniform vec2 iResolution;
  uniform float iTime;
  uniform vec2 uPointer;
  uniform float uHeavy;
  uniform float uPlayerZ;
  uniform float uSection;
  uniform float uSectionProgress;
  uniform float uTransition;
  uniform float uLoop;
  uniform float uLoopProgress;
  uniform float uRupture;
  uniform float uDecay;
  uniform float uPurgatory;
  uniform float uFinale;

  #define MAX_STEPS 92
  #define FAR_CLIP 145.0
  #define HIT_EPSILON 0.018

  #define MAT_CONCRETE 1.0
  #define MAT_STEEL 2.0
  #define MAT_MACHINE 3.0
  #define MAT_EMISSIVE 4.0
  #define MAT_ROCK 5.0

  float gSection;
  float gNextSection;
  float gProgress;
  float gTransition;
  float gCamZ;
  float gCamX;
  float gCamFloor;

  float saturate (float x) { return clamp(x, 0.0, 1.0); }
  float hash11 (float p) { return fract(sin(p * 91.3458) * 47453.5453); }
  float hash21 (vec2 p) { return fract(sin(dot(p, vec2(127.17, 311.73))) * 43758.3123); }

  // --- the rupture, in the field ---------------------------------------------
  //
  // uRupture used to do one thing to the world: bend it. Displacement alone
  // reads as wind, not as damage, which is why four traversals of it never felt
  // like four traversals. The liminal journey's decay is the model for what it
  // does now — there the world cracks open along a vein field and the distance
  // function itself starts to boil, so surfaces come apart instead of leaning.
  //
  // crackField is liminal/shaders.ts getFloorCrack(): a signed noise whose zero
  // set is the crack, widened by decay, and gated by a much lower-frequency
  // mask so the breakage arrives in patches rather than everywhere at once.
  float crackField (vec3 p, float decay) {
    float d = clamp(decay * 0.15, 0.0, 0.72) * (1.0 - uPurgatory * 0.45);
    if (d < 0.05)
      return 0.0;
    float veins = sin(p.x * 3.5 + cos(p.z * 4.5)) * cos(p.z * 3.1 + sin(p.y * 4.0));
    float edge = smoothstep(mix(0.004, 0.10, d), 0.0, abs(veins));
    float patch = smoothstep(0.1, 0.5,
      sin(p.x * 0.35) * cos(p.z * 0.45) * sin(p.y * 0.25) + d * 0.35);
    return edge * patch * d;
  }

  // High-frequency corruption of the field itself.
  //
  // Two things bound it. The amplitude has to stay well under the march's 0.68
  // step factor — liminal can afford an unbounded version because it marches one
  // flat floor, whereas here it overshoots the first hit and punches holes in
  // the world. And it fades out in purgatory: the residue is a place that has
  // finished coming apart, so it should be still. Left seething, the terminal
  // act reads as television static rather than as somewhere you are.
  float fieldBoil (vec3 p) {
    float amount = uRupture * (1.0 - uPurgatory * 0.8);
    if (amount < 0.02)
      return 0.0;
    return sin(p.x * 24.0 + iTime * 32.0) * sin(p.y * 36.0) * sin(p.z * 16.0) *
      0.035 * amount;
  }

  mat2 rotate2 (float a) {
    float c = cos(a), s = sin(a);
    return mat2(c, -s, s, c);
  }

  float sdBox (vec3 p, vec3 b) {
    vec3 q = abs(p) - b;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
  }

  float sdCylinderX (vec3 p, float halfLength, float radius) {
    vec2 q = vec2(length(p.yz) - radius, abs(p.x) - halfLength);
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0));
  }

  float sdCylinderY (vec3 p, float halfLength, float radius) {
    vec2 q = vec2(length(p.xz) - radius, abs(p.y) - halfLength);
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0));
  }

  float sdCylinderZ (vec3 p, float halfLength, float radius) {
    vec2 q = vec2(length(p.xy) - radius, abs(p.z) - halfLength);
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0));
  }

  /**
   * The clock the scenery moves on. Stops as the residue takes hold: purgatory
   * inherits the six acts' geometry, and inheriting their *motion* with it made
   * the terminal act the busiest thing in the journey — turbines spinning and
   * water rippling in a place where nothing is left to run them.
   */
  float animTime () {
    return iTime * (1.0 - uPurgatory * 0.95);
  }

  float sdTorusY (vec3 p, vec2 t) {
    vec2 q = vec2(length(p.xz) - t.x, p.y);
    return length(q) - t.y;
  }

  /**
   * A quarried hillside: a slope cut into benches. Returned as a height, not a
   * distance, so callers can subtract it from p.y and keep the ground planar —
   * three of the six acts are built on some version of this and doing it as
   * nested boxes would cost far more steps for the same silhouette.
   */
  float benchedGround (float x, float stepW, float stepH, float slope) {
    float a = abs(x);
    return a * slope - floor(a / stepW) * stepH;
  }

  /** One leg of an X-brace. Lean it the other way for the second. */
  float brace (vec3 q, float lean, vec3 b) {
    q.xy *= rotate2(lean);
    return sdBox(q, b);
  }

  float sdTorusX (vec3 p, vec2 t) {
    vec2 q = vec2(length(p.yz) - t.x, p.x);
    return length(q) - t.y;
  }

  float sectionLength (float section) {
    if (section > 5.5) return 260.0;
    if (section < 0.5) return 70.0;
    if (section < 1.5) return 85.0;
    if (section < 2.5) return 80.0;
    if (section < 3.5) return 90.0;
    if (section < 4.5) return 85.0;
    return 90.0;
  }

  float nextSection (float section) {
    // Purgatory follows itself. There is no seventh act to hand off to, which
    // is the difference between a loop that resets and one that has stopped.
    if (section > 5.5) return 6.0;
    return mod(section + 1.0, 6.0);
  }

  float pathX (float section, float z) {
    if (section < 0.5) return sin(z * 0.032) * 1.2;
    if (section < 1.5) return sin(z * 0.055) * 2.1;
    if (section < 2.5) return sin(z * 0.041) * 1.5;
    if (section < 3.5) return sin(z * 0.072) * 4.4;
    if (section < 4.5) return sin(z * 0.052) * 4.8;
    return sin(z * 0.038 + uFinale * 2.0) * (2.4 + uFinale * 3.0);
  }

  // The stair pitches over as the traversals pile up: the rise grows and the run
  // shortens, which is what "more vertical" means on an actual stair — a taller
  // step you have to reach further down for. Driven off uDecay so it arrives as
  // the same continuous ramp as every other rupture effect, rather than
  // snapping a new gradient into place at each reset. The first traversal walks
  // a ~13 degree ramp; the fourth is falling down something near 48.
  float riseScale () { return 1.0 + uDecay * 0.45; }
  float runScale () { return 1.0 / (1.0 + uDecay * 0.18); }

  /** Rise and run for an act, before the traversal pitch is applied. */
  vec2 treadOf (float section) {
    if (section > 0.5 && section < 1.5) return vec2(0.17, 1.2);
    if (section > 1.5 && section < 2.5) return vec2(0.28, 1.55);
    if (section > 2.5 && section < 3.5) return vec2(0.31, 1.35);
    if (section > 3.5 && section < 4.5) return vec2(0.24, 1.3);
    if (section > 4.5) return vec2(0.22, 1.1);
    return vec2(0.34, 1.45);
  }

  float pathY (float section, float z) {
    vec2 tread = treadOf(section);
    float rise = tread.x * riseScale();
    float run = tread.y * runScale();
    float stepped = -rise * floor(z / run);

    // The fall's broken path. Deliberately *not* mirrored into railY — the point
    // is that the treads stop being where the camera expects them. That only
    // works while you are falling past them: held on into purgatory, where the
    // drift is 1.6 u/s, it simply parks the eye inside the concrete. So it is
    // gated off as the residue takes hold.
    if (section > 4.5)
      stepped += sin(z * 0.18) * uFinale * 1.4 * (1.0 - uPurgatory);
    return stepped;
  }

  float railY (float section, float z) {
    vec2 tread = treadOf(section);
    return -z * (tread.x * riseScale()) / (tread.y * runScale());
  }

  float pathWidth (float section) {
    if (section < 0.5) return 2.9;
    if (section < 1.5) return 1.65;
    if (section < 2.5) return 2.35;
    if (section < 3.5) return 2.0;
    if (section < 4.5) return 1.85;
    return 1.75;
  }

  vec2 commonPath (vec3 p, float section) {
    float px = pathX(section, p.z);
    float py = pathY(section, p.z);
    float width = pathWidth(section);
    float solidPath = max(p.y - py, abs(p.x - px) - width);

    if (section > 4.5 && uFinale > 0.12) {
      float cell = floor(p.z / 2.1);
      float localZ = mod(p.z + 1.05, 2.1) - 1.05;
      float jitter = (hash11(cell * 7.3) - 0.5) * uFinale;
      vec3 stepP = vec3(
        p.x - px - jitter * 1.5,
        p.y - py - jitter * 1.1,
        localZ
      );
      float broken = sdBox(stepP, vec3(width, 0.18, 0.88 - uFinale * 0.18));
      solidPath = mix(solidPath, broken, smoothstep(0.12, 0.72, uFinale));
    }

    // Proximity-enveloped so both terms act on the surface rather than on the
    // whole field, which is what keeps the march honest at high rupture.
    float near = saturate(1.0 - abs(solidPath) * 2.6);
    solidPath -= crackField(p, uDecay) * 0.18 * near;
    solidPath += fieldBoil(p) * near;

    float railHeight = railY(section, p.z) + 1.0;
    float railL = length(vec2(p.x - px + width + 0.18, p.y - railHeight)) - 0.055;
    float railR = length(vec2(p.x - px - width - 0.18, p.y - railHeight)) - 0.055;
    float rails = min(railL, railR);
    return rails < solidPath ? vec2(rails, MAT_STEEL) : vec2(solidPath, MAT_CONCRETE);
  }

  // --- the six acts ----------------------------------------------------------
  //
  // Each act has to be recognisable from its silhouette alone, because the veil
  // over the handoff means you often see the next one before you can see any of
  // its detail. So they are built in three tiers rather than as one pile of
  // primitives: a far mass that fixes the skyline, a mid-field structure that
  // fixes the rhythm, and near work that fixes the scale. Where two acts would
  // otherwise share a language — the bridge and the conveyor are both trusses —
  // the cadence and the section are deliberately pulled apart.

  // I · THE SPILLWAY THRESHOLD
  // Mass concrete, water, cold dawn. Everything here is poured, nothing is bolted.
  vec2 spillway (vec3 p) {
    float px = pathX(0.0, p.z);
    float py = pathY(0.0, p.z);
    float zCell = mod(p.z + 9.0, 18.0) - 9.0;
    float zBay = mod(p.z + 4.5, 9.0) - 4.5;

    // The dam wall, and the ogee chute stepping down away from it.
    float dam = sdBox(p - vec3(-13.0, py + 7.0, p.z), vec3(5.5, 15.0, 130.0));
    float chute = p.y - py + 2.0 + benchedGround(p.x + 22.0, 3.4, 0.85, 0.06) * 0.5;
    chute = max(chute, -(p.x + 34.0));
    chute = max(chute, p.x + 8.0);

    // Buttresses and the penstock run.
    float buttress = sdBox(vec3(abs(p.x + 7.0) - 3.0, p.y - py - 2.5, zCell), vec3(0.65, 5.0, 1.2));
    float penstock = sdCylinderZ(vec3(p.x - 8.5, p.y - py + 4.0, zCell), 8.0, 1.8);

    // Sluice bays: a gate, its lift screw, and the gantry the screw hangs from.
    float gate = sdBox(vec3(p.x - 6.0, p.y - py - 2.0, zCell), vec3(3.6, 3.2, 0.34));
    float screw = sdCylinderY(vec3(p.x - 6.0, p.y - py - 6.4, zCell), 3.0, 0.13);
    float gantry = sdBox(vec3(p.x - 6.0, p.y - py - 9.2, zCell), vec3(4.0, 0.3, 0.55));
    float sluice = min(gate, min(screw, gantry));

    // Baffle blocks in the stilling basin, on a much tighter pitch than anything
    // else in the act — this is what gives the foreground its scale.
    float baffle = sdBox(vec3(mod(p.x + 30.0, 4.2) - 2.1, p.y - py + 1.4, zBay), vec3(0.5, 0.9, 0.5));
    baffle = max(baffle, p.x + 12.0);

    // Handrail stanchions along the walkway. Near work; keeps the eye anchored.
    float post = sdBox(vec3(abs(p.x - px) - 3.05, p.y - py - 0.55, mod(p.z + 1.1, 2.2) - 1.1),
      vec3(0.06, 0.55, 0.06));

    float water = p.y - py + 2.6 + sin(p.z * 0.5 + animTime() * 0.6) * 0.05
      + sin(p.x * 0.7 - animTime() * 0.4) * 0.04;
    water = max(water, -(p.x + 34.0));

    float concrete = min(dam, min(chute, min(buttress, min(baffle, water))));
    float steel = min(sluice, min(penstock, post));
    return steel < concrete ? vec2(steel, MAT_MACHINE) : vec2(concrete, MAT_CONCRETE);
  }

  // II · PROTEAN WEATHER BRIDGE
  // Nothing but structure and weather. The only act with no ground under it.
  vec2 stormBridge (vec3 p) {
    float px = pathX(1.0, p.z);
    float py = pathY(1.0, p.z);
    float zCell = mod(p.z + 11.0, 22.0) - 11.0;
    float zTruss = mod(p.z + 2.75, 5.5) - 2.75;
    float dx = p.x - px;

    // Pylons and their crossheads.
    float pylons = sdBox(vec3(abs(dx) - 4.2, p.y - py - 4.0, zCell), vec3(0.28, 4.3, 0.28));
    float crosshead = sdBox(vec3(dx, p.y - py - 7.8, zCell), vec3(4.4, 0.22, 0.25));

    // Main catenary, and the hangers dropping off it every truss bay. The sag is
    // the giveaway that this is a suspension deck and not a girder.
    float sag = cos(zCell * 0.16) * 1.15;
    float cable = abs(length(vec2(abs(dx) - 4.2, p.y - py - 8.6 + sag)) - 0.06);
    float hanger = sdBox(vec3(abs(dx) - 4.2, p.y - py - 5.4, zTruss),
      vec3(0.04, 3.2 - sag * 0.5, 0.04));

    // Deck truss: chords plus a pair of leaning braces per bay.
    float chord = sdBox(vec3(abs(dx) - 3.4, p.y - py + 0.9, zCell), vec3(0.14, 0.14, 11.0));
    // The X. Rotating in the y-z plane rather than building two rotated boxes
    // keeps it to one shear each way, which is all a brace is.
    vec3 braceP = vec3(abs(dx) - 3.4, p.y - py + 0.35, zTruss);
    float braces = min(
      brace(braceP.zyx, 0.62, vec3(3.1, 0.09, 0.09)),
      brace(braceP.zyx, -0.62, vec3(3.1, 0.09, 0.09)));

    // Wind fencing: louvre slats, dense, the one fine texture in the act.
    float slat = sdBox(vec3(abs(dx) - 3.9, mod(p.y - py - 0.4, 0.42) - 0.21, zCell),
      vec3(0.05, 0.06, 11.0));
    slat = max(slat, abs(p.y - py - 1.4) - 1.5);

    // Anemometer mast and the aircraft beacons, which are the only light source
    // up here that is not the sky.
    float mast = sdBox(vec3(dx - 4.6, p.y - py - 10.5, mod(p.z + 55.0, 110.0) - 55.0),
      vec3(0.07, 2.6, 0.07));
    float beaconPulse = 0.14 + 0.05 * sin(animTime() * 2.1 + floor(p.z / 22.0));
    float beacon = sdBox(vec3(abs(dx) - 4.2, p.y - py - 8.4, zCell), vec3(beaconPulse));

    float steel = min(min(pylons, crosshead), min(min(cable, hanger),
      min(chord, min(braces, min(slat, mast)))));
    return beacon < steel ? vec2(beacon, MAT_EMISSIVE) : vec2(steel, MAT_STEEL);
  }

  // III · THE TURBINE CANYON
  // Rock and rotation. The only act where the scenery moves on its own.
  vec2 turbineCanyon (vec3 p) {
    float px = pathX(2.0, p.z);
    float py = pathY(2.0, p.z);
    float zCell = mod(p.z + 14.0, 28.0) - 14.0;
    float dx = p.x - px;

    // Canyon walls, stratified. Cut back hard so the descent stays narrow.
    float strata = sin(p.y * 1.6 + sin(p.z * 0.09) * 1.4) * 0.22;
    float walls = 5.6 - abs(dx) + strata;
    walls = max(walls, p.y - py - 26.0);

    // Scree banked against the foot of each wall. Anchored to py and pushed
    // outboard of the corridor, or it fills the descent and you march inside it.
    float talus = p.y - (py - 1.6 + max(0.0, abs(dx) - 6.0) * 0.7);
    talus = max(talus, abs(dx) - 13.0);

    // Three-blade rotors in a housing, flanking the descent.
    vec3 rotorP = vec3(abs(dx) - 8.5, p.y - py - 2.2, zCell);
    rotorP.yz *= rotate2(animTime() * 0.32 + hash11(floor(p.z / 28.0)) * 6.28);
    float housing = sdCylinderX(rotorP, 2.0, 3.5);
    float hub = sdCylinderX(rotorP, 2.9, 0.65);
    float blades = sdBox(rotorP, vec3(2.25, 0.16, 3.0));
    rotorP.yz *= rotate2(2.0944);
    blades = min(blades, sdBox(rotorP, vec3(2.25, 0.16, 3.0)));
    rotorP.yz *= rotate2(2.0944);
    blades = min(blades, sdBox(rotorP, vec3(2.25, 0.16, 3.0)));

    // Nacelle tail behind each rotor, so the machines read as directional.
    float tail = sdBox(vec3(abs(dx) - 8.5, p.y - py - 2.2, zCell + 3.4), vec3(1.1, 1.1, 2.6));

    float penstock = sdCylinderZ(vec3(abs(p.x) - 14.0, p.y - py + 2.0, zCell), 13.0, 2.4);

    // Service gantry bridging the canyon overhead, on a slower pitch than the
    // rotors so the two rhythms beat against each other.
    float gantry = sdBox(vec3(dx, p.y - py - 11.5, mod(p.z + 33.0, 66.0) - 33.0),
      vec3(9.0, 0.28, 0.9));
    float gantryLeg = sdBox(vec3(abs(dx) - 8.4, p.y - py - 6.0, mod(p.z + 33.0, 66.0) - 33.0),
      vec3(0.2, 6.0, 0.6));

    // Cable tray with catenary sag between supports.
    float trayY = p.y - py - 6.4 + cos((mod(p.z, 14.0) - 7.0) * 0.22) * 0.5;
    float tray = sdBox(vec3(dx + 5.4, trayY, p.z), vec3(0.42, 0.1, 200.0));

    float rock = min(walls, talus);
    float machine = min(min(housing, min(hub, blades)),
      min(tail, min(penstock, min(gantry, min(gantryLeg, tray)))));

    // The hub lights are the only warm thing in a very cold act.
    float lamp = sdCylinderX(vec3(abs(dx) - 8.5, p.y - py - 2.2, zCell), 3.05, 0.2);
    if (lamp < min(rock, machine))
      return vec2(lamp, MAT_EMISSIVE);
    return rock < machine ? vec2(rock, MAT_ROCK) : vec2(machine, MAT_MACHINE);
  }

  // IV · CONVEYOR ESCARPMENT
  // Extraction. Warm, dusty, and the only act built around a single machine.
  vec2 conveyorEscarpment (vec3 p) {
    float px = pathX(3.0, p.z);
    float py = pathY(3.0, p.z);
    float zCell = mod(p.z + 10.0, 20.0) - 10.0;
    float dx = p.x - px;

    // Quarry benches. Wider steps than the spillway's chute and cut the other
    // way up, so the two terraced acts do not read as the same place.
    float quarry = p.y - py + 10.0 - benchedGround(p.x, 5.0, 0.72, 0.16);

    // Stockpile cones at the foot of the benches.
    float coneX = mod(p.x + 60.0, 40.0) - 20.0;
    float stockpile = p.y - py + 3.0 + (length(vec2(coneX, mod(p.z + 45.0, 90.0) - 45.0)) - 9.0) * 0.62;

    // The conveyor gallery: a roofed truss box on trestles, running the act.
    vec3 galleryP = vec3(dx - 7.0, p.y - py - 4.4, zCell);
    float belt = sdBox(galleryP, vec3(2.0, 0.26, 9.6));
    float roof = sdBox(vec3(galleryP.x, galleryP.y - 1.9, galleryP.z), vec3(2.2, 0.12, 9.6));
    float side = sdBox(vec3(abs(galleryP.x) - 2.1, galleryP.y - 0.9, galleryP.z), vec3(0.08, 1.0, 9.6));
    float trestle = sdBox(vec3(abs(dx - 7.0) - 1.7, p.y - py - 2.0, mod(p.z + 5.0, 10.0) - 5.0),
      vec3(0.2, 2.4, 0.25));

    // Idler rollers under the belt, on a fast pitch — the finest cadence here.
    float roller = sdCylinderX(vec3(dx - 7.0, p.y - py - 4.15, mod(p.z + 0.6, 1.2) - 0.6),
      2.0, 0.16);

    // The bucket wheel, with buckets around the rim.
    vec3 wheelP = vec3(dx - 11.0, p.y - py - 4.0, mod(p.z + 25.0, 50.0) - 25.0);
    wheelP.yz *= rotate2(animTime() * 0.18);
    float wheel = sdTorusX(wheelP, vec2(4.2, 0.35));
    vec3 bucketP = wheelP;
    bucketP.yz *= rotate2(floor(atan(wheelP.z, wheelP.y) * 1.9099 + 0.5) * -0.5236);
    float bucket = sdBox(vec3(bucketP.x, bucketP.y - 4.2, bucketP.z), vec3(0.7, 0.5, 0.5));
    float boom = sdBox(vec3(dx + 9.0, p.y - py - 7.0, zCell), vec3(0.28, 7.0, 0.28));

    // Transfer tower where the gallery changes level.
    vec3 towerP = vec3(dx - 7.0, p.y - py - 7.0, mod(p.z + 60.0, 120.0) - 60.0);
    float tower = sdBox(towerP, vec3(2.6, 7.2, 2.6));
    tower = max(tower, -sdBox(towerP, vec3(2.2, 6.6, 2.2)));

    float rock = min(quarry, stockpile);
    float machine = min(min(belt, min(roof, min(side, trestle))),
      min(min(roller, wheel), min(bucket, min(boom, tower))));
    return rock < machine ? vec2(rock, MAT_ROCK) : vec2(machine, MAT_MACHINE);
  }

  // V · THE COOLING FIELD
  // Pale, chemical, and horizontal. Every silhouette here is a curve.
  vec2 coolingField (vec3 p) {
    float px = pathX(4.0, p.z);
    float py = pathY(4.0, p.z);
    float zCell = mod(p.z + 21.0, 42.0) - 21.0;
    float dx = p.x - px;

    // Hyperboloid towers, with the raked column ring they actually stand on.
    vec3 towerP = vec3(abs(dx) - 15.0, p.y - py - 8.0, zCell);
    float towerRadius = 4.4 + towerP.y * towerP.y * 0.018;
    float tower = max(abs(length(towerP.xz) - towerRadius) - 0.3, abs(towerP.y) - 10.0);
    float ang = atan(towerP.z, towerP.x);
    vec3 legP = vec3(length(towerP.xz) - 5.6, towerP.y + 9.4, sin(ang * 9.0) * 1.4);
    float legs = sdBox(legP, vec3(0.22, 1.6, 0.22));

    // A pipe rack rather than a single pipe: four runs on a frame, with an
    // expansion loop every bay. This is the act's rhythm.
    float rackY = p.y - py - 0.2 - mod(floor((p.y - py) * 1.2), 1.0) * 0.0;
    float pipes = 1000.0;
    for (int i = 0; i < 4; i++) {
      float o = float(i) * 0.9;
      pipes = min(pipes, sdCylinderZ(vec3(abs(dx) - 6.0 + o * 0.55, rackY - o * 0.42, zCell), 19.0, 0.34));
    }
    float loop = sdTorusY(vec3(abs(dx) - 6.0, p.y - py - 1.6, zCell - 16.0), vec2(1.5, 0.34));
    float rackFrame = sdBox(vec3(abs(dx) - 6.8, p.y - py - 0.8, mod(p.z + 6.0, 12.0) - 6.0),
      vec3(0.14, 1.6, 0.14));

    // Chimney with its banding, and a valve station at the foot of it.
    vec3 stackP = vec3(abs(dx) - 9.0, p.y - py - 6.0, zCell);
    float stack = sdCylinderY(stackP, 6.5, 0.7 - abs(stackP.y) * 0.02);
    float bands = sdTorusY(vec3(stackP.x, mod(stackP.y + 1.0, 2.0) - 1.0, stackP.z), vec2(0.72, 0.09));
    bands = max(bands, abs(stackP.y) - 6.5);
    float valve = sdTorusY(vec3(abs(dx) - 6.0, p.y - py + 0.9, mod(p.z + 15.0, 30.0) - 15.0),
      vec2(0.55, 0.09));

    // Chain-link fence line: the only thing in the act at human scale.
    float fence = sdBox(vec3(abs(dx) - 3.6, p.y - py - 0.9, mod(p.z + 3.0, 6.0) - 3.0),
      vec3(0.05, 0.9, 0.05));

    float pond = p.y - py + 3.5 + sin(p.x * 0.35) * 0.35 + sin(p.z * 0.22 + animTime() * 0.3) * 0.06;

    float concrete = min(tower, min(legs, pond));
    float steel = min(min(pipes, min(loop, rackFrame)),
      min(stack, min(bands, min(valve, fence))));
    return concrete < steel ? vec2(concrete, MAT_CONCRETE) : vec2(steel, MAT_STEEL);
  }

  // VI · THE SHEAR HORIZON
  // Where the anthology stops being architecture. Everything is unmoored.
  vec2 shearHorizon (vec3 p) {
    float px = pathX(5.0, p.z);
    float py = pathY(5.0, p.z);
    float cell = floor((p.z + 6.0) / 12.0);
    float zCell = mod(p.z + 6.0, 12.0) - 6.0;
    float dx = p.x - px;

    float angle = (hash11(cell * 4.7) - 0.5) * (0.4 + uRupture * 1.4);
    vec3 shardP = vec3(abs(dx) - 7.0 - hash11(cell) * 7.0, p.y - py - 3.0, zCell);
    shardP.xy *= rotate2(angle + uFinale * sin(cell) * 1.2);
    float shard = sdBox(shardP, vec3(2.8 + hash11(cell + 2.0) * 3.0, 0.5, 5.0));

    // Torn strata: slabs of the earlier acts' ground, hanging at wrong angles.
    float sCell = floor((p.z + 19.0) / 38.0);
    vec3 slabP = vec3(dx + (hash11(sCell) - 0.5) * 26.0,
      p.y - py + 6.0 - hash11(sCell + 4.0) * 16.0,
      mod(p.z + 19.0, 38.0) - 19.0);
    slabP.xy *= rotate2((hash11(sCell + 7.0) - 0.5) * 2.2);
    float slab = sdBox(slabP, vec3(7.0, 0.42, 9.0));

    // Suspended stair fragments — the route itself, elsewhere, in pieces.
    float fCell = floor((p.z + 8.0) / 16.0);
    vec3 fragP = vec3(dx - (hash11(fCell + 2.0) - 0.5) * 30.0,
      p.y - py - 2.0 - hash11(fCell + 11.0) * 14.0,
      mod(p.z + 8.0, 16.0) - 8.0);
    fragP.xy *= rotate2(hash11(fCell + 3.0) * 3.0 + uFinale);
    float tread = sdBox(vec3(fragP.x, mod(fragP.y + 0.35, 0.7) - 0.35, fragP.z),
      vec3(1.6, 0.09, 0.42));
    float frag = max(tread, sdBox(fragP, vec3(1.7, 2.2, 3.0)));

    vec3 ringP = vec3(dx, p.y - py - 12.0, mod(p.z + 40.0, 80.0) - 40.0);
    ringP.xy *= rotate2(0.7 + uFinale * 0.8);
    float ring = sdTorusX(ringP, vec2(13.0, 0.6));

    float monolith = sdBox(vec3(abs(dx) - 18.0, p.y - py - 7.0, zCell), vec3(2.0, 11.0, 3.5));

    // The rift: a horizontal slit of light along the floor of the world.
    float rift = max(abs(p.y - py + 14.0) - 0.35, abs(dx) - 40.0);

    float lit = min(ring, rift);
    float solid = min(shard, min(slab, min(frag, monolith)));
    return lit < solid ? vec2(lit, MAT_EMISSIVE) : vec2(solid, MAT_MACHINE);
  }

  vec2 actEnvironment (vec3 p, float section) {
    if (section < 0.5) return spillway(p);
    if (section < 1.5) return stormBridge(p);
    if (section < 2.5) return turbineCanyon(p);
    if (section < 3.5) return conveyorEscarpment(p);
    if (section < 4.5) return coolingField(p);
    return shearHorizon(p);
  }

  /**
   * The residue — purgatory's geometry.
   *
   * Not a seventh environment. It is the six acts recurring as ghosts on a slow
   * cycle, pushed back and thickened so they read as the same structures seen
   * from somewhere you cannot reach them from, and stripped to one material.
   * Purgatory is made of what you already walked through; inventing new scenery
   * for it would say the opposite of what the act is for.
   */
  vec2 purgatoryResidue (vec3 p) {
    float cycle = mod(floor(p.z / 88.0) + floor(uPlayerZ / 260.0), 6.0);
    vec3 q = p;
    q.x += sin(p.z * 0.021) * 3.2;
    q.y -= 1.1;
    vec2 ghost = actEnvironment(q, cycle);
    ghost.x = ghost.x * 0.86 + 1.3;
    ghost.y = MAT_CONCRETE;
    return ghost;
  }

  vec2 sectionEnvironment (vec3 p, float section) {
    if (section > 5.5) return purgatoryResidue(p);
    return actEnvironment(p, section);
  }

  vec2 ruptureDebris (vec3 p, float section) {
    if (uRupture < 0.05 || uPurgatory > 0.75)
      return vec2(1000.0, MAT_MACHINE);
    float cell = floor((p.z + 4.0) / 8.0);
    float zCell = mod(p.z + 4.0, 8.0) - 4.0;
    float side = sign(sin(cell * 4.13));
    float x = pathX(section, p.z) + side * (5.0 + hash11(cell) * 11.0);
    float y = pathY(section, p.z) + 2.0 + hash11(cell + 9.0) * 10.0;
    vec3 q = p - vec3(x, y, p.z - zCell);
    q.xy *= rotate2(iTime * 0.07 * side + hash11(cell + 3.0) * 3.0);
    float d = sdBox(q, vec3(0.25 + hash11(cell) * 1.1, 0.18, 1.2 + hash11(cell + 2.0) * 2.5));
    return vec2(d, hash11(cell + 6.0) > 0.8 ? MAT_EMISSIVE : MAT_MACHINE);
  }

  vec2 mapSection (vec3 p, float section) {
    vec2 path = commonPath(p, section);
    vec3 warped = p;
    float shearBand = floor((p.z + 13.0) / 26.0);
    warped.x += sin(p.z * 0.11 + shearBand) * uRupture * 1.8;
    warped.y += (hash11(shearBand) - 0.5) * uRupture * 2.0;
    vec2 environment = sectionEnvironment(warped, section);
    vec2 debris = ruptureDebris(p, section);
    vec2 result = path.x < environment.x ? path : environment;
    if (debris.x < result.x)
      result = debris;

    // Chunks of the world stop being what they were. Liminal replaces its matte
    // floor material above a decay-scaled noise threshold (shaders.ts:784-789);
    // the same idea in this journey's vocabulary is a machine face that has
    // become rift light — the structure is still there, the substance is not.
    if (uDecay >= 1.0 && result.y > 2.5 && result.y < 3.5) {
      float vNoise = hash21(floor(p.xz * 0.6) + floor(p.y * 0.5));
      if (vNoise > 0.95 - clamp(uDecay * 0.09, 0.0, 0.30))
        result.y = MAT_EMISSIVE;
    }

    float safe = length(p.xy - vec2(pathX(section, p.z), pathY(section, p.z) + 1.5)) - 0.78;
    result.x = max(result.x, -safe);
    return result;
  }

  vec2 mapScene (vec3 p) {
    vec2 current = mapSection(p, gSection);
    // Keep the current SDF authoritative until the atmosphere has become
    // opaque enough to conceal the unavoidable first-hit ownership handoff.
    if (gTransition < 0.12)
      return current;

    float following = nextSection(gSection);
    vec3 relative = p - vec3(gCamX, gCamFloor, gCamZ);
    vec3 nextP = relative + vec3(pathX(following, 0.0), pathY(following, 0.0), 0.0);
    vec2 next = mapSection(nextP, following);
    return vec2(
      mix(current.x, next.x, gTransition),
      gTransition < 0.5 ? current.y : next.y
    );
  }

  vec3 calcNormal (vec3 p) {
    vec2 e = vec2(0.0025, -0.0025);
    return normalize(
      e.xyy * mapScene(p + e.xyy).x +
      e.yyx * mapScene(p + e.yyx).x +
      e.yxy * mapScene(p + e.yxy).x +
      e.xxx * mapScene(p + e.xxx).x
    );
  }

  float ambientOcclusion (vec3 p, vec3 n) {
    float a = 0.0;
    float weight = 1.0;
    for (int i = 0; i < 3; i++) {
      float h = 0.07 + float(i) * 0.16;
      a += (h - mapScene(p + n * h).x) * weight;
      weight *= 0.55;
    }
    return saturate(1.0 - a * 1.8);
  }

  float weatherVapor (vec3 rd) {
    vec3 p = rd * 6.4 + vec3(iTime * 0.08, -iTime * 0.035, iTime * 0.05);
    float vapor = 0.0;
    float amplitude = 0.55;
    for (int i = 0; i < 3; i++) {
      p += sin(p.yzx * 0.83 + float(i) * 1.7) * 0.42;
      vapor += abs(dot(sin(p), cos(p.zxy * 1.13))) * amplitude;
      p.xy *= rotate2(0.73 + float(i) * 0.21);
      p = p * 1.72 + vec3(0.8, -1.4, 1.1);
      amplitude *= 0.48;
    }
    return smoothstep(0.38, 1.18, vapor);
  }

  vec3 sectionSky (vec3 rd, float section) {
    vec3 low;
    vec3 high;
    vec3 sun;
    if (section > 5.5) {
      // No sun, no gradient worth the name. A lit ceiling with nothing above it.
      low = vec3(0.045, 0.047, 0.05); high = vec3(0.15, 0.152, 0.158); sun = vec3(0.0);
    } else if (section < 0.5) {
      low = vec3(0.12, 0.20, 0.25); high = vec3(0.58, 0.73, 0.82); sun = vec3(1.0, 0.72, 0.42);
    } else if (section < 1.5) {
      low = vec3(0.035, 0.075, 0.11); high = vec3(0.22, 0.39, 0.46); sun = vec3(0.45, 0.9, 1.0);
    } else if (section < 2.5) {
      low = vec3(0.10, 0.13, 0.12); high = vec3(0.52, 0.64, 0.58); sun = vec3(1.0, 0.56, 0.25);
    } else if (section < 3.5) {
      low = vec3(0.18, 0.10, 0.055); high = vec3(0.70, 0.45, 0.22); sun = vec3(1.0, 0.76, 0.42);
    } else if (section < 4.5) {
      low = vec3(0.08, 0.14, 0.14); high = vec3(0.55, 0.67, 0.63); sun = vec3(0.78, 0.94, 0.88);
    } else {
      low = vec3(0.025, 0.008, 0.055); high = vec3(0.18, 0.06, 0.30); sun = vec3(0.55, 0.82, 1.0);
    }
    float horizon = saturate(rd.y * 0.72 + 0.46 + sin(rd.x * 2.0 + uRupture) * uRupture * 0.08);
    vec3 color = mix(low, high, horizon);
    vec3 sunDir = normalize(vec3(-0.48, 0.55, 0.68));
    color += sun * pow(max(dot(rd, sunDir), 0.0), 220.0) * 4.0;
    if (section > 0.5 && section < 1.5) {
      float vapor = weatherVapor(rd);
      vec3 vaporColor = mix(vec3(0.025, 0.09, 0.13), vec3(0.24, 0.48, 0.51), vapor);
      color = mix(color, vaporColor, 0.24 + vapor * 0.48);
      float lightning = pow(max(sin(iTime * 0.73 + floor(iTime * 0.19) * 4.2), 0.0), 42.0);
      color += vec3(0.42, 0.78, 1.0) * lightning * (0.4 + uRupture * 0.8);
    }
    float rift = exp(-abs(rd.y + 0.05 + sin(rd.x * 8.0) * 0.05) * 55.0);
    color += vec3(0.20, 0.55, 1.0) * rift * uRupture * (0.25 + uFinale * 2.0);
    return color;
  }

  float cloudField (vec3 p) {
    p *= 0.17;
    float sum = 0.0;
    float amplitude = 0.58;
    for (int i = 0; i < 4; i++) {
      vec3 warp = sin(p.yzx * 1.37 + iTime * vec3(0.19, 0.13, 0.16));
      sum += abs(dot(sin(p + warp * 0.45), cos(p.zxy * 1.11))) * amplitude;
      p.xy *= rotate2(0.82 + float(i) * 0.17);
      p.yz *= rotate2(-0.54 + float(i) * 0.11);
      p = p * 1.68 + vec3(1.7, -1.1, 0.8);
      amplitude *= 0.52;
    }
    return sum;
  }

  vec4 marchClouds (vec3 ro, vec3 rd, float maxDistance, float section) {
    float currentStorm = section > 0.5 && section < 1.5 ? 1.0 : 0.0;
    float nextStorm = gNextSection > 0.5 && gNextSection < 1.5 ? 1.0 : 0.0;
    float active = max(mix(currentStorm, nextStorm, gTransition), uFinale);
    if (active < 0.01)
      return vec4(0.0);

    vec4 result = vec4(0.0);
    float distanceAlongRay = 2.0;
    for (int i = 0; i < 64; i++) {
      if (uHeavy < 0.5 && i >= 32) break;
      if (distanceAlongRay > maxDistance || result.a > 0.97) break;
      vec3 p = ro + rd * distanceAlongRay;
      p.x += sin(p.z * 0.025 + iTime * 0.11) * 5.0;
      p.y += cos(p.z * 0.018 - iTime * 0.09) * 3.0;
      float layer = abs(p.y - gCamFloor - 3.0);
      float envelope = 1.0 - smoothstep(1.8, 9.0, layer);
      float billow = sin(p.x * 0.16 + sin(p.z * 0.07 + iTime * 0.12)) * 0.24;
      billow += sin(p.z * 0.11 - p.y * 0.19 - iTime * 0.08) * 0.18;
      float shape = cloudField(p) - 0.78 + envelope * 0.10 + billow;
      float density = smoothstep(0.015, 0.48, shape) * envelope * active;
      if (density > 0.01) {
        float lightSample = cloudField(p + vec3(-0.8, 1.2, 0.7));
        float lighting = saturate((shape - lightSample) * 1.7 + 0.38);
        vec3 cold = vec3(0.13, 0.31, 0.36);
        vec3 warm = vec3(0.62, 0.22, 0.13);
        vec3 cloudColor = mix(cold, warm, uRupture * 0.75 + uFinale * 0.25);
        cloudColor *= 0.52 + lighting * 2.4;
        float lightning = pow(max(sin(iTime * 0.73 + floor(p.z * 0.04)), 0.0), 34.0);
        cloudColor += vec3(0.24, 0.62, 0.9) * lightning * (0.3 + uRupture);
        float alpha = density * 0.085;
        result.rgb += cloudColor * alpha * (1.0 - result.a);
        result.a += alpha * (1.0 - result.a);
      }
      distanceAlongRay += mix(0.76, 0.19, density);
    }
    return result;
  }

  vec3 materialColor (float material, float section, vec3 p, vec3 n, vec3 rd) {
    vec3 concrete = vec3(0.34, 0.37, 0.39);
    vec3 steel = vec3(0.16, 0.20, 0.23);
    vec3 machineA = section < 2.5 ? vec3(0.19, 0.25, 0.25) : vec3(0.32, 0.18, 0.08);
    vec3 machineB = gNextSection < 2.5 ? vec3(0.19, 0.25, 0.25) : vec3(0.32, 0.18, 0.08);
    vec3 machine = mix(machineA, machineB, gTransition);
    vec3 rock = vec3(0.27, 0.15, 0.075);
    vec3 base = material < 1.5 ? concrete : material < 2.5 ? steel : material < 3.5 ? machine : rock;
    float grime = hash21(floor(p.xz * 0.8)) * 0.16 + sin(p.y * 2.7 + p.z * 0.3) * 0.04;
    base *= 0.83 + grime;

    vec3 lightDir = normalize(vec3(-0.55, 0.72, 0.34));
    float diffuse = max(dot(n, lightDir), 0.0);
    float ao = ambientOcclusion(p, n);
    vec3 ambientA = section < 0.5 ? vec3(0.34, 0.48, 0.58)
      : section < 1.5 ? vec3(0.10, 0.30, 0.42)
      : section < 2.5 ? vec3(0.32, 0.42, 0.34)
      : section < 3.5 ? vec3(0.48, 0.25, 0.10)
      : section < 4.5 ? vec3(0.26, 0.45, 0.42)
      : vec3(0.23, 0.08, 0.38);
    vec3 ambientB = gNextSection < 0.5 ? vec3(0.34, 0.48, 0.58)
      : gNextSection < 1.5 ? vec3(0.10, 0.30, 0.42)
      : gNextSection < 2.5 ? vec3(0.32, 0.42, 0.34)
      : gNextSection < 3.5 ? vec3(0.48, 0.25, 0.10)
      : gNextSection < 4.5 ? vec3(0.26, 0.45, 0.42)
      : vec3(0.23, 0.08, 0.38);
    vec3 ambientTint = mix(ambientA, ambientB, gTransition);
    vec3 color = base * (0.30 + diffuse * 0.82) * ao + base * ambientTint * 0.32;
    float fresnel = pow(1.0 - max(dot(n, -rd), 0.0), 4.0);
    color += vec3(0.32, 0.48, 0.58) * fresnel * (material > 1.5 ? 0.36 : 0.12);

    float fracture = abs(sin(p.x * 2.8 + sin(p.z * 0.7)) * cos(p.y * 2.2 + p.z));
    float crack = smoothstep(0.035 + uRupture * 0.08, 0.0, fracture) * uRupture;

    // The stairwell starts as a place with lights in it and ends as a place that
    // is burning. Cold rift blue on the first traversal, crossfading to liminal's
    // furnace core (shaders.ts:1030) as the decay counter climbs.
    float heat = saturate(uDecay * 0.28);
    vec3 crackHot = vec3(1.5, 0.02, 0.01) * (1.0 + 3.0 * heat);
    color += mix(vec3(0.10, 0.55, 1.3), crackHot, heat) * crack * (0.4 + uFinale * 2.4);

    // The carved cracks *replace* the surface rather than adding to it — which
    // is what liminal does (mix, not +=) and the reason its abyss stays legible
    // while an additive version of the same term blows the whole frame out.
    color = mix(color, crackHot, saturate(crackField(p, uDecay) * 1.1));
    if (material > 3.5 && material < 4.5)
      color = vec3(0.12, 0.75, 1.5) * (1.2 + sin(iTime * 4.0 + p.z) * 0.3);
    return color;
  }

  vec3 aces (vec3 x) {
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  }

  void main () {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    gSection = uSection;
    gNextSection = nextSection(gSection);
    gProgress = uSectionProgress;
    gTransition = uTransition;
    gCamZ = gProgress * sectionLength(gSection);
    gCamX = pathX(gSection, gCamZ);
    gCamFloor = railY(gSection, gCamZ);

    float bob = sin(iTime * 5.2) * 0.035 * (1.0 - uFinale * 0.65);
    vec3 ro = vec3(gCamX, gCamFloor + 1.68 + bob, gCamZ);
    float lookZ = min(gCamZ + 10.0, sectionLength(gSection));
    vec3 target = vec3(pathX(gSection, lookZ), railY(gSection, lookZ) + 1.35, lookZ);
    vec3 currentForward = normalize(target - ro);
    vec3 nextRo = vec3(pathX(gNextSection, 0.0), railY(gNextSection, 0.0) + 1.68, 0.0);
    float nextLookZ = min(10.0, sectionLength(gNextSection));
    vec3 nextTarget = vec3(
      pathX(gNextSection, nextLookZ),
      railY(gNextSection, nextLookZ) + 1.35,
      nextLookZ
    );
    vec3 nextForward = normalize(nextTarget - nextRo);
    vec3 forward = normalize(mix(currentForward, nextForward, gTransition));
    forward.y -= uFinale * 0.62;
    forward = normalize(forward);
    vec3 right = normalize(cross(forward, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, forward);
    float roll = uFinale * 0.18 * sin(iTime * 0.43);
    right.xy *= rotate2(roll);
    up = cross(right, forward);
    vec3 pointerTarget = right * uPointer.x * 0.42 + up * uPointer.y * 0.32;
    vec3 rd = normalize(uv.x * right + uv.y * up + mix(1.28, 0.78, uFinale) * (forward + pointerTarget));

    float travel = 0.0;
    float material = 0.0;
    bool hit = false;
    for (int i = 0; i < MAX_STEPS; i++) {
      if (uHeavy < 0.5 && i >= 62) break;
      vec2 mapped = mapScene(ro + rd * travel);
      if (mapped.x < HIT_EPSILON) {
        material = mapped.y;
        hit = true;
        break;
      }
      travel += mapped.x * mix(0.68, 0.48, smoothstep(0.0, 0.24, gTransition));
      if (travel > FAR_CLIP) break;
    }

    vec3 skyColor = mix(
      sectionSky(rd, gSection),
      sectionSky(rd, gNextSection),
      gTransition
    );
    vec3 color = skyColor;
    if (hit) {
      vec3 p = ro + rd * travel;
      vec3 n = calcNormal(p);
      color = materialColor(material, gSection, p, n, rd);
      float fog = 1.0 - exp(-travel * ((gSection > 0.5 && gSection < 1.5 ? 0.018 : 0.009)
        + uPurgatory * 0.030));
      color = mix(color, skyColor, fog);
    }

    vec4 clouds = marchClouds(ro, rd, min(travel, FAR_CLIP), gSection);
    color = color * (1.0 - clouds.a) + clouds.rgb;

    // Every act hands off through its own atmosphere. The veil is strongest at
    // the midpoint where two unrelated SDFs would otherwise exchange the first
    // visible surface abruptly, and clears completely at both endpoints.
    float transitionVeil = smoothstep(0.0, 0.22, gTransition)
      * (1.0 - smoothstep(0.80, 1.0, gTransition));
    vec3 veilColor = mix(
      sectionSky(normalize(rd + vec3(0.0, 0.18, 0.0)), gSection),
      sectionSky(normalize(rd + vec3(0.0, 0.18, 0.0)), gNextSection),
      gTransition
    );
    color = mix(color, veilColor, transitionVeil * 0.88);

    // The residue, applied last so it takes the whole image with it: colour
    // drains out, the blacks close up. One expression covers both the bleed
    // across the four traversals and the terminal act, because they are the
    // same process seen at two points along it.
    if (uPurgatory > 0.001) {
      float luma = dot(color, vec3(0.299, 0.587, 0.114));
      color = mix(color, vec3(luma), uPurgatory * 0.88);

      // Contrast crush on the displayable range only. Squaring the raw value
      // would *amplify* anything already over 1, which is the opposite of a
      // crush and turns every emissive surface into a white hole.
      vec3 crushed = clamp(color, 0.0, 1.0);
      crushed = crushed * crushed * (3.0 - 2.0 * crushed);
      color = mix(color, crushed, uPurgatory * 0.6);
      color *= 1.0 - uPurgatory * 0.20;
    }

    float exposurePulse = 1.0 - uFinale * 0.18 + sin(iTime * 19.0) * uFinale * 0.025;
    color *= exposurePulse;
    gl_FragColor = vec4(aces(color), 1.0);
  }
`

export const fsPost = `
  precision highp float;

  uniform sampler2D uTexture;
  uniform vec2 iResolution;
  uniform float iTime;
  uniform float uHeavy;
  uniform float uSection;
  uniform float uRupture;
  uniform float uDecay;
  uniform float uPurgatory;
  uniform float uFinale;

  float hash21 (vec2 p) {
    return fract(sin(dot(p, vec2(127.17, 311.73))) * 43758.3123);
  }

  void main () {
    vec2 uv = gl_FragCoord.xy / iResolution.xy;
    vec2 center = uv - 0.5;
    float r2 = dot(center, center);
    vec2 warped = uv + center * r2 * mix(0.035, 0.12, uFinale);

    // How much of the image has gone. Continuous in uDecay rather than stepped
    // per traversal, so the interference thickens through a loop instead of
    // arriving all at once at the reset.
    //
    // Purgatory *subtracts* from it, which is liminal's calm term
    // (shaders.ts:1190) doing the same job: once the route has stopped, the
    // picture stops fighting. The horror of the residue is that it is quiet.
    float damage = (clamp(uDecay * 0.16, 0.0, 0.52) + uFinale * 0.42) *
      (1.0 - uPurgatory * 0.78);

    // Liminal's two-tier interference (shaders.ts:1232-1243). Two independent
    // mechanisms, not one stronger one: a hash-gated per-band displacement, and
    // separately a red flash injected across the frame. A single displacement
    // turned up further only ever reads as more shake.
    // The coarse tier. Note the calm factor here too — this one predates the
    // residue and would otherwise keep tearing 19% of the scanlines at full
    // rupture in an act that is supposed to have gone quiet.
    float band = floor(warped.y * 38.0 + iTime * 8.0);
    float glitch = step(0.92 - uRupture * 0.11 - uFinale * 0.18, hash21(vec2(band, floor(iTime * 7.0))));
    warped.x += (hash21(vec2(band, 17.0)) - 0.5) * glitch * (0.012 + uFinale * 0.045)
      * (1.0 - uPurgatory * 0.85);

    float fineBand = floor(warped.y * 28.0 + iTime * 35.0);
    if (hash21(vec2(fineBand, 91.0)) < damage * 0.25)
      warped.x += (hash21(vec2(fineBand, 15.0)) - 0.5) * damage * 0.07;

    float caScale = 0.035 + uRupture * 0.055 + uFinale * 0.08;

    // Liminal reserves this kick for SECTOR 666; here it belongs to the authored
    // fall alone. uFinale releases across the first units of purgatory, so this
    // lets go on its own once you are through the seam.
    if (uFinale > 0.5) {
      float tG = iTime * 65.0;
      warped += vec2(
        sin(tG * 1.5) * 0.012 * step(0.72, sin(tG)),
        cos(tG * 0.9) * 0.008 * step(0.82, cos(tG * 1.1))
      );
      caScale *= 2.2;
    }

    vec2 ca = center * (r2 + 0.02) * caScale;
    vec3 color;
    color.r = texture2D(uTexture, warped - ca).r;
    color.g = texture2D(uTexture, warped).g;
    color.b = texture2D(uTexture, warped + ca).b;

    // The red flash. Injected rather than sampled, so it survives a frame in
    // which nothing bright is on screen — which, deep in purgatory, is most of them.
    if (hash21(vec2(floor(iTime * 18.0), 3.0)) < damage * 0.18)
      color += vec3(0.18, 0.01, 0.02) * damage * sin(warped.y * 30.0);

    float pixel = 1.0 / iResolution.y;
    vec3 bloom = vec3(0.0);
    for (int i = 1; i <= 4; i++) {
      float offset = float(i) * pixel * 3.0;
      bloom += max(texture2D(uTexture, warped + vec2(offset, 0.0)).rgb - 0.62, 0.0);
      bloom += max(texture2D(uTexture, warped - vec2(offset, 0.0)).rgb - 0.62, 0.0);
      if (uHeavy > 0.5) {
        bloom += max(texture2D(uTexture, warped + vec2(0.0, offset)).rgb - 0.68, 0.0);
        bloom += max(texture2D(uTexture, warped - vec2(0.0, offset)).rgb - 0.68, 0.0);
      }
    }
    color += bloom * (uHeavy > 0.5 ? 0.045 : 0.032);

    color += (hash21(gl_FragCoord.xy + fract(iTime) * 71.0) - 0.5) * 0.035;
    color *= mix(0.48, 1.0, smoothstep(0.78, 0.24, length(center)));

    // The residue reaches the display treatment too, or the grade would fight
    // the image: a monochrome world behind a full-colour scanline is just a
    // colour picture of a grey room.
    if (uPurgatory > 0.001) {
      float luma = dot(color, vec3(0.299, 0.587, 0.114));
      color = mix(color, vec3(luma * 1.04), uPurgatory * 0.7);
    }

    float finaleFade = 1.0 - smoothstep(0.82, 1.0, uFinale) * 0.22;
    color *= finaleFade;
    gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
  }
`

// perf: expensive only in the storm/finale volume; 62/92 sdf and 32/64 cloud steps by quality.
