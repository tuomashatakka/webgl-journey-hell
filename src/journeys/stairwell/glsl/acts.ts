export const actsGlsl = `// --- the walls between the acts -----------------------------------------------

// A barrier at a seam: two hundred metres of wall, seventy high, with a portal
// tunnel carrying the stair through it. Its style follows the act it closes —
// the spillway ends in its own dam, the canyon in its rock.
vec2 barrier (vec3 p, float zs, float closing) {
  // Ribs and rock stand up to two units proud of the slab.
  float bound = abs(p.z - zs) - SEAM - 2.5;
  if (bound > 2.0) return vec2(bound, M_WALL);
  float px = pathXJ(p.z);
  float ry = railJ(p.z);
  vec3 q = vec3(p.x - pathXJ(zs), p.y - railJ(zs), p.z - zs);

  // Rock walls are cliffs: strata, ledges and a few octaves of ridge. Concrete
  // walls are dams: buttress ribs standing proud of the face every nine
  // metres, a setback every twelve, and a parapet along the crest.
  float isRock = (closing > 1.5 && closing < 3.5) || closing > 4.5 ? 1.0 : 0.0;
  float slab = sdBox(vec3(q.x, q.y - (WALL_TOP - 60.0), q.z), vec3(160.0, 60.0, SEAM));
  if (isRock > 0.5) {
    float strata = sin(q.y * 0.9 + sin(q.x * 0.07) * 2.0) * 0.9;
    float ridge = sin(q.x * 0.31 + sin(q.y * 0.17) * 2.0) * 1.3 + sin(q.y * 0.53 + q.x * 0.11) * 0.7;
    float ledge = smoothstep(0.7, 1.0, fract(q.y / 7.0)) * 1.4;
    slab += (ridge + strata - ledge) * 0.45;
  } else {
    vec3 r = vec3(mod(q.x + 4.5, 9.0) - 4.5, q.y, q.z + SEAM);
    float rib = sdBox(r - vec3(0.0, 10.0, -0.9), vec3(0.9, 40.0, 1.1));
    float setback = (SEAM - 0.5) * step(18.0, q.y) - 0.0;
    slab = max(slab, -(q.z + SEAM - min(setback, 0.8) * step(18.0, q.y)));
    float parapet = sdBox(vec3(q.x, q.y - WALL_TOP - 0.7, q.z + SEAM - 0.4), vec3(160.0, 0.7, 0.25));
    slab = min(slab, min(rib, parapet));
  }

  // The bore follows the stair.
  float dx = p.x - px;
  float bore = max(abs(dx) - 2.9, abs(p.y - ry - 1.5) - 3.0);
  // A portal arch on each face, slightly larger than the bore, for a reveal.
  float reveal = max(abs(dx) - 3.4, abs(p.y - ry - 1.7) - 3.3);
  reveal = max(reveal, SEAM - 0.6 - abs(q.z));
  float wall = max(slab, -min(bore, reveal));

  // Light strips in the tunnel roof, the only light inside.
  float strip = sdBox(vec3(dx, p.y - ry - 4.45, mod(q.z + 1.0, 2.0) - 1.0), vec3(0.18, 0.03, 0.6));
  strip = max(strip, abs(q.z) - SEAM + 0.5);
  if (strip < wall) return vec2(strip, M_EMISSIVE);
  return vec2(wall, M_WALL);
}

// --- the six acts --------------------------------------------------------------

// I · THE SPILLWAY THRESHOLD — mass concrete, water, a cold dawn.
vec2 spillway (vec3 p) {
  float px = pathX(0.0, p.z);
  float py = pathY(0.0, p.z);
  float zCell = mod(p.z + 9.0, 18.0) - 9.0;
  float zBay = mod(p.z + 4.5, 9.0) - 4.5;
  float dam = sdBox(p - vec3(-13.0, py + 7.0, p.z), vec3(5.5, 15.0, 130.0));
  float chute = p.y - py + 2.0 + benchedGround(p.x + 22.0, 3.4, 0.85, 0.06) * 0.5;
  chute = max(chute, -(p.x + 34.0));
  chute = max(chute, p.x + 8.0);
  float buttress = sdBox(vec3(abs(p.x + 7.0) - 3.0, p.y - py - 2.5, zCell), vec3(0.65, 5.0, 1.2));
  float penstock = sdCylinderZ(vec3(p.x - 8.5, p.y - py + 4.0, zCell), 8.0, 1.8);
  float gate = sdBox(vec3(p.x - 6.0, p.y - py - 2.0, zCell), vec3(3.6, 3.2, 0.34));
  float screw = sdCylinderY(vec3(p.x - 6.0, p.y - py - 6.4, zCell), 3.0, 0.13);
  float gantry = sdBox(vec3(p.x - 6.0, p.y - py - 9.2, zCell), vec3(4.0, 0.3, 0.55));
  float sluice = min(gate, min(screw, gantry));
  float baffle = sdBox(vec3(mod(p.x + 30.0, 4.2) - 2.1, p.y - py + 1.4, zBay), vec3(0.5, 0.9, 0.5));
  baffle = max(baffle, p.x + 12.0);
  float ground = p.y - py + 3.2;
  float concrete = min(dam, min(chute, min(buttress, min(baffle, ground))));
  float steel = min(sluice, penstock);
  float water = p.y - py + 2.55;
  water = max(water, -(p.x + 34.0));
  water = max(water, p.x + 8.5);
  vec2 r = steel < concrete ? vec2(steel, M_MACHINE) : vec2(concrete, M_CONCRETE);
  return water < r.x ? vec2(water, M_WATER) : r;
}

// II · PROTEAN WEATHER BRIDGE — nothing but structure and weather.
vec2 stormBridge (vec3 p) {
  float px = pathX(1.0, p.z);
  float py = pathY(1.0, p.z);
  float zCell = mod(p.z + 11.0, 22.0) - 11.0;
  float zTruss = mod(p.z + 2.75, 5.5) - 2.75;
  float dx = p.x - px;
  float pylons = sdBox(vec3(abs(dx) - 4.2, p.y - py - 4.0, zCell), vec3(0.28, 4.3, 0.28));
  float crosshead = sdBox(vec3(dx, p.y - py - 7.8, zCell), vec3(4.4, 0.22, 0.25));
  float sag = cos(zCell * 0.16) * 1.15;
  float cable = abs(length(vec2(abs(dx) - 4.2, p.y - py - 8.6 + sag)) - 0.06);
  float hanger = sdBox(vec3(abs(dx) - 4.2, p.y - py - 5.4, zTruss), vec3(0.04, 3.2 - sag * 0.5, 0.04));
  float chord = sdBox(vec3(abs(dx) - 3.4, p.y - py + 0.9, zCell), vec3(0.14, 0.14, 11.0));
  vec3 braceP = vec3(abs(dx) - 3.4, p.y - py + 0.35, zTruss);
  float braces = min(brace(braceP.zyx, 0.62, vec3(3.1, 0.09, 0.09)), brace(braceP.zyx, -0.62, vec3(3.1, 0.09, 0.09)));
  float slat = sdBox(vec3(abs(dx) - 3.9, mod(p.y - py - 0.4, 0.42) - 0.21, zCell), vec3(0.05, 0.06, 11.0));
  slat = max(slat, abs(p.y - py - 1.4) - 1.5);
  float pier = sdBox(vec3(dx, p.y - py + 30.0, mod(p.z + 22.0, 44.0) - 22.0), vec3(2.2, 28.0, 1.6));
  float beaconPulse = 0.14 + 0.05 * sin(animTime() * 2.1 + floor(p.z / 22.0));
  float beacon = sdBox(vec3(abs(dx) - 4.2, p.y - py - 8.4, zCell), vec3(beaconPulse));
  float steel = min(min(pylons, crosshead), min(min(cable, hanger), min(chord, min(braces, slat))));
  if (beacon < min(steel, pier)) return vec2(beacon, M_EMISSIVE);
  return pier < steel ? vec2(pier, M_CONCRETE) : vec2(steel, M_STEEL);
}

// III · THE TURBINE CANYON — rock and rotation.
vec2 turbineCanyon (vec3 p) {
  float px = pathX(2.0, p.z);
  float py = pathY(2.0, p.z);
  float zCell = mod(p.z + 14.0, 28.0) - 14.0;
  float dx = p.x - px;
  // The canyon is wide enough for its machines: walls stand back at twelve
  // metres, stratified and undercut, and the rotors stand free in front of
  // them instead of buried in the rock.
  float strata = sin(p.y * 1.6 + sin(p.z * 0.09) * 1.4) * 0.35 + sin(p.y * 4.1 + p.z * 0.3) * 0.08;
  float walls = 12.5 - abs(dx) + strata + sin(p.z * 0.05) * 1.5;
  walls = max(walls, p.y - py - 20.0 - sin(p.z * 0.031 + p.x * 0.02) * 4.0);
  float talus = p.y - (py - 3.4 + max(0.0, abs(dx) - 9.5) * 0.65);
  talus = max(talus, abs(dx) - 17.0);
  float floorRock = p.y - py + 3.6 + sin(p.x * 0.3) * sin(p.z * 0.21) * 0.3;
  vec3 rotorP = vec3(abs(dx) - 8.5, p.y - py - 2.2, zCell);
  rotorP.yz *= rot(animTime() * 0.32 + hash11(floor(p.z / 28.0)) * 6.28);
  float housing = sdCylinderX(rotorP, 2.0, 3.5);
  float hub = sdCylinderX(rotorP, 2.9, 0.65);
  float blades = sdBox(rotorP, vec3(2.25, 0.16, 3.0));
  rotorP.yz *= rot(2.0944);
  blades = min(blades, sdBox(rotorP, vec3(2.25, 0.16, 3.0)));
  rotorP.yz *= rot(2.0944);
  blades = min(blades, sdBox(rotorP, vec3(2.25, 0.16, 3.0)));
  float tail = sdBox(vec3(abs(dx) - 8.5, p.y - py - 2.2, zCell + 3.4), vec3(1.1, 1.1, 2.6));
  float penstock = sdCylinderZ(vec3(abs(dx) - 11.0, p.y - py + 1.2, zCell), 13.0, 1.6);
  float gantry = sdBox(vec3(dx, p.y - py - 11.5, mod(p.z + 33.0, 66.0) - 33.0), vec3(12.5, 0.28, 0.9));
  float gantryLeg = sdBox(vec3(abs(dx) - 11.6, p.y - py - 4.0, mod(p.z + 33.0, 66.0) - 33.0), vec3(0.2, 8.0, 0.6));
  float trayY = p.y - py - 6.4 + cos((mod(p.z, 14.0) - 7.0) * 0.22) * 0.5;
  float tray = sdBox(vec3(dx + 5.4, trayY, p.z), vec3(0.42, 0.1, 200.0));
  float rock = min(min(walls, talus), floorRock);
  float pedestal = sdBox(vec3(abs(dx) - 8.5, p.y - py + 1.0, zCell + 0.6), vec3(1.6, 2.4, 3.6));
  float machine = min(min(housing, min(hub, blades)), min(tail, min(penstock, min(gantry, min(gantryLeg, min(tray, pedestal))))));
  float lamp = sdCylinderX(vec3(abs(dx) - 8.5, p.y - py - 2.2, zCell), 3.05, 0.2);
  if (lamp < min(rock, machine)) return vec2(lamp, M_EMISSIVE);
  return rock < machine ? vec2(rock, M_ROCK) : vec2(machine, M_MACHINE);
}

// IV · CONVEYOR ESCARPMENT — extraction, warm and dusty.
vec2 conveyorEscarpment (vec3 p) {
  float px = pathX(3.0, p.z);
  float py = pathY(3.0, p.z);
  float zCell = mod(p.z + 10.0, 20.0) - 10.0;
  float dx = p.x - px;
  float quarry = p.y - py + 10.0 - benchedGround(p.x, 5.0, 0.72, 0.16);
  float coneX = mod(p.x + 60.0, 40.0) - 20.0;
  float stockpile = p.y - py + 3.0 + (length(vec2(coneX, mod(p.z + 45.0, 90.0) - 45.0)) - 9.0) * 0.62;
  vec3 galleryP = vec3(dx - 7.0, p.y - py - 4.4, zCell);
  float belt = sdBox(galleryP, vec3(2.0, 0.26, 9.6));
  float roof = sdBox(vec3(galleryP.x, galleryP.y - 1.9, galleryP.z), vec3(2.2, 0.12, 9.6));
  float side = sdBox(vec3(abs(galleryP.x) - 2.1, galleryP.y - 0.9, galleryP.z), vec3(0.08, 1.0, 9.6));
  float trestle = sdBox(vec3(abs(dx - 7.0) - 1.7, p.y - py - 2.0, mod(p.z + 5.0, 10.0) - 5.0), vec3(0.2, 2.4, 0.25));
  float roller = sdCylinderX(vec3(dx - 7.0, p.y - py - 4.15, mod(p.z + 0.6, 1.2) - 0.6), 2.0, 0.16);
  vec3 wheelP = vec3(dx - 11.0, p.y - py - 4.0, mod(p.z + 25.0, 50.0) - 25.0);
  wheelP.yz *= rot(animTime() * 0.18);
  float wheel = sdTorusX(wheelP, vec2(4.2, 0.35));
  vec3 bucketP = wheelP;
  bucketP.yz *= rot(floor(atan(wheelP.z, wheelP.y) * 1.9099 + 0.5) * -0.5236);
  float bucket = sdBox(vec3(bucketP.x, bucketP.y - 4.2, bucketP.z), vec3(0.7, 0.5, 0.5));
  float boom = sdBox(vec3(dx + 9.0, p.y - py - 7.0, zCell), vec3(0.28, 7.0, 0.28));
  vec3 towerP = vec3(dx - 7.0, p.y - py - 7.0, mod(p.z + 60.0, 120.0) - 60.0);
  float tower = sdBox(towerP, vec3(2.6, 7.2, 2.6));
  tower = max(tower, -sdBox(towerP, vec3(2.2, 6.6, 2.2)));
  float rock = min(quarry, stockpile);
  float clad = min(roof, side);
  float machine = min(min(belt, trestle), min(min(roller, wheel), min(bucket, min(boom, tower))));
  if (clad < min(rock, machine)) return vec2(clad, M_STEEL);
  return rock < machine ? vec2(rock, M_ROCK) : vec2(machine, M_MACHINE);
}

// V · THE COOLING FIELD — pale, chemical, every silhouette a curve.
vec2 coolingField (vec3 p) {
  float px = pathX(4.0, p.z);
  float py = pathY(4.0, p.z);
  float zCell = mod(p.z + 21.0, 42.0) - 21.0;
  float dx = p.x - px;
  vec3 towerP = vec3(abs(dx) - 15.0, p.y - py - 8.0, zCell);
  float towerRadius = 4.4 + towerP.y * towerP.y * 0.018;
  float tower = max(abs(length(towerP.xz) - towerRadius) - 0.3, abs(towerP.y) - 10.0);
  float ang = atan(towerP.z, towerP.x);
  vec3 legP = vec3(length(towerP.xz) - 5.6, towerP.y + 9.4, sin(ang * 9.0) * 1.4);
  float legs = sdBox(legP, vec3(0.22, 1.6, 0.22));
  float pipes = 1000.0;
  for (int i = 0; i < 4; i++) {
    float o = float(i) * 0.9;
    pipes = min(pipes, sdCylinderZ(vec3(abs(dx) - 6.0 + o * 0.55, p.y - py - 0.2 - o * 0.42, zCell), 19.0, 0.34));
  }
  float loopPipe = sdTorusY(vec3(abs(dx) - 6.0, p.y - py - 1.6, zCell - 16.0), vec2(1.5, 0.34));
  float rackFrame = sdBox(vec3(abs(dx) - 6.8, p.y - py - 0.8, mod(p.z + 6.0, 12.0) - 6.0), vec3(0.14, 1.6, 0.14));
  vec3 stackP = vec3(abs(dx) - 9.0, p.y - py - 6.0, zCell);
  float stack = sdCylinderY(stackP, 6.5, 0.7 - abs(stackP.y) * 0.02);
  float bands = sdTorusY(vec3(stackP.x, mod(stackP.y + 1.0, 2.0) - 1.0, stackP.z), vec2(0.72, 0.09));
  bands = max(bands, abs(stackP.y) - 6.5);
  float valve = sdTorusY(vec3(abs(dx) - 6.0, p.y - py + 0.9, mod(p.z + 15.0, 30.0) - 15.0), vec2(0.55, 0.09));
  float fence = sdBox(vec3(abs(dx) - 3.6, p.y - py - 0.9, mod(p.z + 3.0, 6.0) - 3.0), vec3(0.05, 0.9, 0.05));
  float ground = p.y - py + 3.6;
  float pond = p.y - py + 3.4 + sin(p.x * 0.35) * 0.1;
  pond = max(pond, abs(dx) - 26.0);
  float concrete = min(tower, min(legs, ground));
  float steel = min(min(pipes, min(loopPipe, rackFrame)), min(stack, min(bands, min(valve, fence))));
  vec2 r = concrete < steel ? vec2(concrete, M_CONCRETE) : vec2(steel, M_MACHINE);
  return pond < r.x ? vec2(pond, M_WATER) : r;
}

// VI · THE SHEAR HORIZON — where the anthology stops being architecture.
vec2 shearHorizon (vec3 p) {
  float px = pathX(5.0, p.z);
  float py = pathY(5.0, p.z);
  float cell = floor((p.z + 6.0) / 12.0);
  float zCell = mod(p.z + 6.0, 12.0) - 6.0;
  float dx = p.x - px;
  float angle = (hash11(cell * 4.7) - 0.5) * (0.4 + uRupture * 1.4);
  vec3 shardP = vec3(abs(dx) - 7.0 - hash11(cell) * 7.0, p.y - py - 3.0, zCell);
  shardP.xy *= rot(angle + uFinale * sin(cell) * 1.2);
  float shard = sdBox(shardP, vec3(2.8 + hash11(cell + 2.0) * 3.0, 0.5, 5.0));
  float sCell = floor((p.z + 19.0) / 38.0);
  vec3 slabP = vec3(dx + (hash11(sCell) - 0.5) * 26.0, p.y - py + 6.0 - hash11(sCell + 4.0) * 16.0, mod(p.z + 19.0, 38.0) - 19.0);
  slabP.xy *= rot((hash11(sCell + 7.0) - 0.5) * 2.2);
  float slab = sdBox(slabP, vec3(7.0, 0.42, 9.0));
  float fCell = floor((p.z + 8.0) / 16.0);
  vec3 fragP = vec3(dx - (hash11(fCell + 2.0) - 0.5) * 30.0, p.y - py - 2.0 - hash11(fCell + 11.0) * 14.0, mod(p.z + 8.0, 16.0) - 8.0);
  fragP.xy *= rot(hash11(fCell + 3.0) * 3.0 + uFinale);
  float tread = sdBox(vec3(fragP.x, mod(fragP.y + 0.35, 0.7) - 0.35, fragP.z), vec3(1.6, 0.09, 0.42));
  float frag = max(tread, sdBox(fragP, vec3(1.7, 2.2, 3.0)));
  vec3 ringP = vec3(dx, p.y - py - 12.0, mod(p.z + 40.0, 80.0) - 40.0);
  ringP.xy *= rot(0.7 + uFinale * 0.8);
  float ring = sdTorusX(ringP, vec2(13.0, 0.6));
  float monolith = sdBox(vec3(abs(dx) - 18.0, p.y - py - 7.0, zCell), vec3(2.0, 11.0, 3.5));
  float rift = max(abs(p.y - py + 14.0) - 0.35, abs(dx) - 40.0);
  float lit = min(ring, rift);
  float solid = min(shard, min(slab, min(frag, monolith)));
  return lit < solid ? vec2(lit, M_EMISSIVE) : vec2(solid, M_ROCK);
}

vec2 actEnvironment (vec3 p, float a) {
  if (a < 0.5) return spillway(p);
  if (a < 1.5) return stormBridge(p);
  if (a < 2.5) return turbineCanyon(p);
  if (a < 3.5) return conveyorEscarpment(p);
  if (a < 4.5) return coolingField(p);
  return shearHorizon(p);
}

// Purgatory's geometry is not a seventh place: it is the six recurring as
// ghosts on a slow cycle, pushed back and thickened, one material.
vec2 residue (vec3 p, float z0) {
  // Cycled on distance along the whole route, so a ghost is the same ghost
  // seen from either side of a seam.
  float cycle = mod(floor((p.z + z0) / 88.0), 6.0);
  vec3 q = p;
  q.x += sin(p.z * 0.021) * 3.2;
  q.y -= 1.1;
  vec2 ghost = actEnvironment(q, cycle);
  return vec2(ghost.x * 0.86 + 1.3, M_CONCRETE);
}

vec2 environment (vec3 p, float a, float z0) {
  if (a > 5.5) return residue(p, z0);
  return actEnvironment(p, a);
}

vec2 debris (vec3 p) {
  if (uRupture < 0.05 || uPurgatory > 0.75) return vec2(1000.0, M_MACHINE);
  // Cells on distance along the route, not along this act: the same piece of
  // debris either side of a seam.
  float gz = p.z + gZ0;
  float cell = floor((gz + 4.0) / 8.0);
  float zCell = mod(gz + 4.0, 8.0) - 4.0;
  float side = sign(sin(cell * 4.13));
  float x = pathXJ(p.z) + side * (5.0 + hash11(cell) * 11.0);
  float y = railJ(p.z) + 2.0 + hash11(cell + 9.0) * 10.0;
  vec3 q = p - vec3(x, y, p.z - zCell);
  q.xy *= rot(gTime * 0.07 * side + hash11(cell + 3.0) * 3.0);
  float d = sdBox(q, vec3(0.25 + hash11(cell) * 1.1, 0.18, 1.2 + hash11(cell + 2.0) * 2.5));
  return vec2(d, hash11(cell + 6.0) > 0.92 ? M_EMISSIVE : M_MACHINE);
}

// The whole scene, in this act's coordinates: (distance, material). Whose
// light, coordinates and material a hit takes follows from where it is.
vec2 mapScene (vec3 p) {
  vec2 res = stair(p);

  // The scenery of whichever act's stretch p is in, in that act's own
  // coordinates: one environment call however many acts are in view. The
  // next act's far wall has to be standing before the camera gets to it, and
  // so does whatever is framed in its bore. A shear band displaces the
  // scenery as the rupture grows: the world leans as well as cracks.
  float k = max(zoneOf(p.z), 0.0);
  vec3 o = zoneOffset(k);
  float len = k < 0.5 ? gLenA : k < 1.5 ? gLenB : gLenC;
  vec3 q = p - o;
  float band = floor((q.z + 13.0) / 26.0);
  vec3 w = q;
  w.x += sin(q.z * 0.11 + band) * uRupture * 1.8;
  w.y += (hash11(band) - 0.5) * uRupture * 2.0;
  vec2 e = environment(w, zoneAct(k), gZ0 + o.z);
  // Scenery stops at the walls' faces: inside a seam there is only the wall
  // and its bore. (A quarry's stockpile happens to sit on the path at an act's
  // origin, and filled the tunnel until it did.)
  e.x = max(e.x, max(q.z - (len - SEAM), SEAM - q.z));
  // The neighbouring stretches' scenery starts a wall's half-width past the
  // midlines, which keeps the split a bound on the distance to that as well.
  float nb = 1e4;
  if (k < 1.5) nb = len + SEAM - q.z;
  if (k > 0.5) nb = min(nb, q.z + SEAM);
  e.x = min(e.x, nb);
  if (e.x < res.x) res = e;

  // The walls: behind, at the far seam, and at the next act's far seam.
  vec2 wall = barrier(p, 0.0, gP);
  vec2 far = barrier(p, gLenA, gA);
  if (far.x < wall.x) wall = far;
  far = barrier(p, gLenA + gLenB, gB);
  if (far.x < wall.x) wall = far;
  if (wall.x < res.x) res = wall;

  vec2 d = debris(p);
  if (d.x < res.x) res = d;

  // A machine face that has stopped being one: rift light where steel was.
  if (uDecay >= 1.0 && res.y > 2.5 && res.y < 3.5) {
    vec3 pc = p - zoneOffset(zoneOf(p.z));
    float v = hash12(floor(pc.xz * 0.6) + floor(pc.y * 0.5));
    if (v > 0.97 - clamp(uDecay * 0.05, 0.0, 0.16)) res.y = M_EMISSIVE;
  }

  // The walked tube: nothing may enter it, by construction.
  float safe = length(p.xy - vec2(pathXJ(p.z), railJ(p.z) + 1.5)) - 0.78;
  res.x = max(res.x, -safe);
  return res;
}

float mapD (vec3 p) { return mapScene(p).x; }

vec3 calcNormal (vec3 p) {
  vec2 e = vec2(0.0022, -0.0022);
  return normalize(e.xyy * mapD(p + e.xyy) + e.yyx * mapD(p + e.yyx) +
                   e.yxy * mapD(p + e.yxy) + e.xxx * mapD(p + e.xxx));
}

float ambientOcclusion (vec3 p, vec3 n) {
  float a = 0.0, w = 1.0;
  for (int i = 0; i < 4; i++) {
    float h = 0.06 + float(i) * 0.22;
    a += (h - mapD(p + n * h)) * w;
    w *= 0.6;
  }
  return saturate(1.0 - a * 1.4);
}

// iq's soft shadow: the closest the shadow ray came to anything, over distance.
float softShadow (vec3 ro, vec3 rd, float k) {
  float res = 1.0;
  float t = 0.06;
  for (int i = 0; i < 40; i++) {
    if (uHeavy < 0.5 && i >= 20) break;
    float h = mapD(ro + rd * t);
    res = min(res, k * h / t);
    t += clamp(h, 0.06, 3.0);
    if (res < 0.02 || t > 70.0) break;
  }
  return saturate(res);
}

`
