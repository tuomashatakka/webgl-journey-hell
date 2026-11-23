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
// The flight goes down a spine of mass concrete between two bodies of water.
// To its right (-x) a baffled chute twelve wide between training walls: an
// ogee crest where it leaves the wall, an apron of staggered baffle blocks at
// the stair's own pitch, then a drop steeper than the stair into a stilling
// basin whose still water the stair stays over to the end. A battered
// concrete bank climbs away beyond it. To its left (+x) the dam: a face
// standing level while the stair goes down it, buttressed every nine units,
// and in each bay between buttresses a bottom outlet with a lift gate raised
// in its guides by a hoist on the face, a white tongue of water from under
// the leaf and a still pool, the pools stepping down bay by bay.
float spillDrop (float z) { return 6.0 * smoothstep(26.0, 44.0, z); }
// The chute's floor, its water and the basin's water, absolute heights.
float spillFloor (float z) {
  return pathY(0.0, z) - 1.7 + 1.0 * (1.0 - smoothstep(9.0, 16.0, z)) - spillDrop(z);
}
float spillBasin () { return pathY(0.0, 44.0) - 7.0; }
float spillSheet (float z) { return max(spillFloor(z) + 0.3, spillBasin()); }
// Each bay's pool lies level at its own height under the bay's middle.
float spillPool (float z) { return pathY(0.0, z - (mod(z, 9.0) - 4.5)) - 2.0; }
float spillDamTop () { return pathY(0.0, 9.0) + 13.0; }

vec2 spillway (vec3 p) {
  float px = pathX(0.0, p.z);
  float py = pathY(0.0, p.z);
  float dx = p.x - px;

  // The spine under the flight, the chute's training walls and the pools' curb.
  float spine = max(abs(dx + 0.25) - 3.25, p.y - py + 1.4);
  float wallNear = max(abs(dx + 3.9) - 0.4, p.y - py + 1.1);
  float wallFar = max(abs(dx + 15.9) - 0.4, p.y - py - 0.6);
  // The chute and the basin share one floor; the basin's is level.
  float fl = max(spillFloor(p.z), pathY(0.0, 44.0) - 10.5);
  float chute = max((p.y - fl) * 0.8, abs(dx + 9.9) - 5.6);
  // Baffle blocks on the apron, staggered row by row.
  float row = floor(p.z / 3.6);
  vec3 bq = vec3(mod(dx + 9.9 + mod(row, 2.0) * 1.2, 2.4) - 1.2,
                 p.y - spillFloor(row * 3.6 + 1.8) - 0.35, mod(p.z, 3.6) - 1.8);
  float baffle = sdBox(bq, vec3(0.42, 0.42, 0.32));
  baffle = max(baffle, max(abs(dx + 9.9) - 5.0, abs(p.z - 24.5) - 12.5));
  // Beyond the far wall, a battered bank climbing away from the chute.
  float bank = max(dx + 15.5, (p.y - py - 0.6 - (-16.3 - dx) * 1.2) * 0.64);

  // The dam: its face stands level, its buttresses battered against it.
  float top = spillDamTop();
  float zB = mod(p.z + 4.5, 9.0) - 4.5;
  float pyB = pathY(0.0, p.z - zB);
  float zL = mod(p.z, 9.0) - 4.5;
  float wl = spillPool(p.z);
  float curb = max(abs(dx - 3.4) - 0.4, p.y - wl - 0.35);
  float face = max(12.5 - dx, p.y - top);
  face = min(face, sdBox(vec3(dx - 12.2, p.y - top - 0.6, 0.0), vec3(0.3, 0.6, 1e4)));
  float outlet = sdBox(vec3(dx - 12.5, p.y - wl - 1.0, zL), vec3(0.9, 1.3, 1.6));
  face = max(face, -outlet);
  float xo = 7.5 + max(0.0, p.y - pyB + 1.0) * 0.3;
  float buttress = max(max(abs(zB) - 0.6, (xo - dx) * 0.95), max(dx - 13.0, p.y - top));
  // Inside the buttresses, a low wall between one bay's pool and the next.
  buttress = min(buttress, max(abs(zB) - 0.4, max(3.0 - dx, p.y - pyB + 0.6)));
  float concrete = min(min(min(spine, curb), min(wallNear, wallFar)), min(min(chute, baffle), min(bank, min(face, buttress))));

  // The outlet's gate: a leaf raised in its guides, the stem, the hoist.
  float leaf = sdBox(vec3(dx - 12.2, p.y - wl - 2.2, zL), vec3(0.08, 1.6, 1.75));
  float guides = sdBox(vec3(dx - 12.3, p.y - wl - 4.5, abs(zL) - 1.85), vec3(0.2, 4.8, 0.1));
  float stem = sdCylinderY(vec3(dx - 12.15, p.y - wl - 6.5, zL), 2.7, 0.08);
  float hoist = sdBox(vec3(dx - 11.9, p.y - wl - 9.6, zL), vec3(0.6, 0.55, 2.1));
  float steel = min(min(leaf, guides), min(stem, hoist));

  float sheet = max((p.y - spillSheet(p.z)) * 0.8, abs(dx + 9.9) - 5.6);
  float pool = max(p.y - wl, max(3.8 - dx, dx - 12.5));
  // The tongue of water from under the leaf, falling into the pool.
  float tongue = sdBox(vec3(dx - 10.7, p.y - wl - 0.2 - (dx - 10.7) * 0.18, zL), vec3(1.55, 0.12, 1.5)) * 0.95;
  float water = min(sheet, min(pool, tongue));

  vec2 r = steel < concrete ? vec2(steel, M_MACHINE) : vec2(concrete, M_CONCRETE);
  return water < r.x ? vec2(water, M_WATER) : r;
}

// How white the spillway's water is at a point on it: the whole of the sheet
// down the chute, the hydraulic jump fading out across the basin, and the pools
// churned under each outlet.
float spillFoam (vec3 p) {
  float dx = p.x - pathX(0.0, p.z);
  if (dx < 0.0) return exp(-max(spillBasin() - spillFloor(p.z) - 0.3, 0.0) * 1.2);
  return max(exp(-(12.2 - dx) * 0.4), step(spillPool(p.z) + 0.04, p.y));
}

// The water a concrete face stands in, for its tide line.
float spillWet (vec3 p) {
  return p.x - pathX(0.0, p.z) < 0.0 ? spillSheet(p.z) : spillPool(p.z);
}

// II · PROTEAN WEATHER BRIDGE — nothing but structure and weather.
// An open suspension deck: tall portal pylons every 22 units on piers that go
// down into the cloud, main cables sagging between their saddles with a
// hanger every 2.75 down to the deck edge, a grating deck either side of the
// flight on a Warren truss, and wind fencing kept to a low rail of slats so
// the view out over the cloud sea stays open.
vec2 stormBridge (vec3 p) {
  float px = pathX(1.0, p.z);
  float py = pathY(1.0, p.z);
  float dx = p.x - px;
  float ax = abs(dx);
  float y = p.y - py;
  // Everything stands within 5.3 of the line and under 13.3 over it: past
  // that, the bound is the distance, and rays out over the cloud cost nothing.
  float bound = max(ax - 5.4, y - 13.3);
  if (bound > 1.0) return vec2(bound, M_STEEL);
  float zCell = mod(p.z + 11.0, 22.0) - 11.0;
  float zHang = mod(p.z + 1.375, 2.75) - 1.375;
  float zTruss = mod(p.z + 2.75, 5.5) - 2.75;

  // Pylons: legs from the pier cap to above the saddle, a portal beam at the
  // top and a strut under the cables.
  float legs = sdBox(vec3(ax - 4.6, y - 5.0, zCell), vec3(0.32, 7.6, 0.34));
  float portal = sdBox(vec3(dx, y - 11.7, zCell), vec3(4.95, 0.34, 0.3));
  portal = min(portal, sdBox(vec3(dx, y - 7.6, zCell), vec3(4.6, 0.18, 0.22)));
  // The main cables: a parabola from the saddle (12.3) to mid-span (5.2),
  // its vertical distance scaled down by its slope to stay a bound.
  float u = 1.0 - abs(zCell) / 11.0;
  float cy = 5.2 + 7.1 * u * u;
  float slope = 14.2 * u / 11.0;
  float cable = (length(vec2(ax - 4.6, y - cy)) - 0.13) * inversesqrt(1.0 + slope * slope);
  float hh = (cy + 0.4) * 0.5;
  float hanger = sdBox(vec3(ax - 4.6, y - cy + hh, zHang), vec3(0.03, hh, 0.03));

  // The deck either side of the flight, its edge girder and the truss under it.
  float deck = sdBox(vec3(ax - 3.45, y + 0.44, 0.0), vec3(1.5, 0.05, 1e4));
  float chord = min(sdBox(vec3(ax - 4.8, y + 0.62, 0.0), vec3(0.12, 0.2, 1e4)),
                    sdBox(vec3(ax - 4.8, y + 2.35, 0.0), vec3(0.14, 0.14, 1e4)));
  vec3 braceP = vec3(ax - 4.8, y + 1.45, zTruss);
  float braces = min(brace(braceP.zyx, 0.3, vec3(2.9, 0.07, 0.07)), brace(braceP.zyx, -0.3, vec3(2.9, 0.07, 0.07)));
  float floorBeam = sdBox(vec3(dx, y + 0.62, zTruss), vec3(4.8, 0.12, 0.1));
  // Low wind fencing at the deck edge: three slats, knee high.
  float slat = sdBox(vec3(ax - 4.9, mod(y + 0.05, 0.34) - 0.17, 0.0), vec3(0.025, 0.05, 1e4));
  slat = max(slat, abs(y - 0.45) - 0.5);

  float pier = sdBox(vec3(dx, y + 30.0, zCell), vec3(5.1, 27.4, 1.2));
  float beaconPulse = 0.13 + 0.04 * sin(animTime() * 2.1 + floor(p.z / 22.0));
  float beacon = sdBox(vec3(ax - 4.6, y - 12.75, zCell), vec3(beaconPulse));
  float steel = min(min(min(legs, portal), min(cable, hanger)),
                    min(min(deck, chord), min(min(braces, floorBeam), slat)));
  if (beacon < min(steel, pier)) return vec2(beacon, M_EMISSIVE);
  return pier < steel ? vec2(pier, M_CONCRETE) : vec2(steel, M_STEEL);
}

// III · THE TURBINE CANYON — rock and rotation.
// The wind runs down the canyon, so the machines face up it, toward the
// stair: a three-blade rotor on a nacelle on a tapered tower, standing on a
// concrete pedestal, one on each side every 28 units. Penstocks lie along
// the foot of both walls on anchor blocks, and a crane girder spans the
// canyon between every other pair of turbines.
const float TURB_X = 10.5;   // tower axis off the line
const float TURB_Y = 7.6;    // hub over the rail
const float TURB_R = 6.2;    // blade tip radius
const float TURB_W = -1.6;   // rotor plane, in the cell (the cart comes from -z)

// One blade, in the rotor's own frame: u along the span, v round the rotor,
// w along the axis. A twisted elliptical section that narrows to the tip.
float turbineBlade (float u, float v, float w) {
  float k = saturate((u - 1.6) / (TURB_R - 1.6));
  float chord = mix(0.62, 0.13, k) * min(1.0, 0.55 + (u - 0.9) * 0.6);
  float thick = max(chord * 0.2, 0.26 * (1.0 - saturate((u - 0.9) / 0.9)));
  vec2 vw = vec2(v, w);
  vw *= rot(mix(0.5, 0.08, k));
  float e = (length(vec2(vw.x / chord, vw.y / thick)) - 1.0) * min(chord, thick);
  return max(e * 0.8, max(0.8 - u, u - TURB_R));
}

vec2 turbineCanyon (vec3 p) {
  float px = pathX(2.0, p.z);
  float py = pathY(2.0, p.z);
  float dx = p.x - px;
  float ax = abs(dx);
  float hy = p.y - py;
  float zCell = mod(p.z + 14.0, 28.0) - 14.0;
  float cell = floor((p.z + 14.0) / 28.0) * 2.0 + step(0.0, dx);

  // The canyon is wide enough for its machines: walls stand back at nineteen
  // metres, stratified, with talus banked against their feet.
  float strata = sin(p.y * 1.6 + sin(p.z * 0.09) * 1.4) * 0.35 + sin(p.y * 4.1 + p.z * 0.3) * 0.08;
  float walls = 19.5 - ax + strata + sin(p.z * 0.05) * 1.5;
  walls = max(walls, hy - 26.0 - sin(p.z * 0.031 + p.x * 0.02) * 4.0);
  float talus = hy + 3.4 - max(0.0, ax - 16.0) * 0.6;
  talus = max(talus, ax - 23.0);
  float floorRock = hy + 3.6 + sin(p.x * 0.3) * sin(p.z * 0.21) * 0.3;
  float rock = min(min(walls, talus), floorRock);

  // Penstocks along the foot of each wall, flanged every 7 units, on a
  // concrete anchor block every 14.
  vec2 pipeQ = vec2(ax - 15.5, hy + 1.4);
  float pipe = length(pipeQ) - 1.4;
  float flange = max(length(pipeQ) - 1.55, abs(mod(p.z + 3.5, 7.0) - 3.5) - 0.11);
  float penstock = min(pipe, flange);
  float anchor = sdBox(vec3(ax - 15.5, hy + 2.6, mod(p.z + 7.0, 14.0) - 7.0), vec3(1.75, 1.2, 0.7));

  // The crane girder: a vierendeel box at twelve and a half units, wall to
  // wall, halfway between two pairs of turbines every 56, with a hoist
  // trolley on it.
  float gz = mod(p.z + 14.0, 56.0) - 28.0;
  float gy = hy - 12.5;
  float web = sdBox(vec3(dx, gy, abs(gz) - 0.45), vec3(22.0, 0.65, 0.05));
  web = max(web, -sdBox(vec3(mod(dx + 0.6, 1.2) - 0.6, gy, gz), vec3(0.42, 0.42, 1.0)));
  float chords = sdBox(vec3(dx, abs(gy) - 0.62, gz), vec3(22.0, 0.08, 0.55));
  float trolley = sdBox(vec3(dx - 3.2, gy + 0.95, gz), vec3(0.75, 0.3, 0.7));
  float rope = length(vec2(dx - 3.2, gz)) - 0.03;
  rope = max(rope, abs(gy + 3.6) - 2.4);
  float hook = sdBox(vec3(dx - 3.2, gy + 6.15, gz), vec3(0.22, 0.32, 0.16));
  float gantry = min(min(web, chords), min(trolley, min(rope, hook)));

  float machine = min(penstock, gantry);
  float concrete = anchor;

  // The turbines, behind a bound: a ray down the canyon pays one box.
  float lamp = 1e4;
  float tb = max(max(abs(ax - TURB_X) - 7.0, abs(hy - 3.2) - 11.0), abs(zCell - 0.5) - 3.6);
  if (tb < 1.0) {
    // Mirrored by side for the distance, unmirrored for the spin, so every
    // rotor turns the same way seen from the stair.
    float side = dx < 0.0 ? -1.0 : 1.0;
    float spin = animTime() * 0.9 + hash11(cell) * 6.28;
    vec3 q = vec3((ax - TURB_X) * side, hy - TURB_Y, zCell - TURB_W);
    float r = length(q.xy);
    float a = atan(q.y, q.x) - spin;
    a -= floor(a / 2.0944 + 0.5) * 2.0944;
    float blade = turbineBlade(r * cos(a), r * sin(a), q.z);
    // The spinner: an ogive nose on the hub, closed into the nacelle.
    vec3 sq = vec3(q.xy, q.z - 0.15);
    float spinner = (length(vec3(sq.xy, sq.z * (sq.z < 0.0 ? 0.62 : 1.0))) - 0.82) * 0.62;
    spinner = max(spinner, q.z - 0.9);
    // The nacelle: a rounded housing behind the rotor, a little above its axis.
    float nacelle = sdBox(vec3(q.x, q.y - 0.1, q.z - 2.6), vec3(0.62, 0.72, 1.85)) - 0.3;
    // The tower, tapering from its pedestal to the yaw bearing.
    vec2 tq = vec2(ax - TURB_X, zCell - 1.0);
    float tr = mix(0.66, 0.4, saturate((hy + 2.0) / (TURB_Y + 1.4)));
    float tower = max((length(tq) - tr) * 0.98, max(hy - TURB_Y + 0.4, -2.0 - hy));
    float pedestal = sdBox(vec3(tq.x, hy + 2.9, tq.y), vec3(1.5, 1.1, 1.5)) - 0.06;
    float turbine = min(min(blade, spinner), min(nacelle, tower));
    machine = min(machine, turbine);
    concrete = min(concrete, pedestal);
    // A red obstruction light on the nacelle's roof.
    lamp = length(vec3(q.x, q.y - 1.1, q.z - 3.6)) - 0.13;
  } else {
    machine = min(machine, tb);
  }

  vec2 res = rock < machine ? vec2(rock, M_ROCK) : vec2(machine, M_MACHINE);
  if (concrete < res.x) res = vec2(concrete, M_CONCRETE);
  if (lamp < res.x) res = vec2(lamp, M_EMISSIVE);
  return res;
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
// The ground has torn open along the line of the stair. Either side, a cliff
// of level strata broken into fault blocks 11 units long, each thrown up or
// down and tipped on its own, so the bedding steps from block to block and
// every join is a scarp. Thirty units down, the gorge floor is split by the
// rift: a slit of light that lights the cliffs from below. In the air over
// the gorge hang what the tear threw up: slabs of strata with ragged
// undersides, short flights torn out of a stair like this one, and rings,
// broken hoops of steel the stair passes through, with a light along their
// inner face.
const float RIFT_DEPTH = 30.0;
const vec3 RIFT_LIGHT = vec3(0.12, 0.5, 1.1);
// How bright the rift burns: low on the first traversal, up with every one
// after it, and blazing through the finale.
float riftPower () { return (1.0 + uRupture * 0.6 + uFinale * 1.2) * (1.0 - uPurgatory); }
float riftX (float z) { return sin(z * 0.09) * 2.5 + sin(z * 0.23 + 1.3) * 0.8; }

// One fault block of one side's cliff. Its face stands back 9.5 to 12 from
// the line, each bed of the strata at its own depth, and the beds are counted
// from the block's throw, so they step at every fault.
float faultBlock (vec3 p, float ax, float side, float cell) {
  float zc = (cell + 0.5) * 11.0;
  float seed = cell * 3.1 + side * 17.0;
  float throwY = (hash11(seed) - 0.6) * 14.0 + uRupture * (hash11(seed + 5.0) - 0.5) * 6.0;
  float tilt = (hash11(seed + 1.7) - 0.5) * 0.22;
  float dip = (hash11(seed + 2.9) - 0.4) * 0.25;
  float top = pathY(5.0, zc) + 3.0 + throwY + (p.z - zc) * tilt - (ax - 10.0) * dip;
  float s = (p.y - throwY) / 2.3;
  float k = floor(s);
  float bed = mix(hash11(k + side * 31.0), hash11(k + 1.0 + side * 31.0), smoothstep(0.78, 1.0, fract(s)));
  float face = 9.5 + hash11(seed + 4.2) * 2.5 + bed * 1.1 +
               sin(p.z * 0.35 + p.y * 0.21) * 0.45 + sin(p.y * 1.3 + p.z * 0.8) * 0.15;
  float d = max((face - ax) * 0.6, (p.y - top) * 0.8);
  return max(d, abs(p.z - zc) - 5.5);
}

vec2 shearHorizon (vec3 p) {
  float px = pathX(5.0, p.z);
  float py = pathY(5.0, p.z);
  float dx = p.x - px;
  float ax = abs(dx);
  float side = dx < 0.0 ? -1.0 : 1.0;

  // The cliffs: this block and the nearer of its neighbours. Any other block
  // is at least half a block away along the line, and no block of either
  // side stands nearer the line than 9.5 or higher than 20 over the stair,
  // so away from the cliffs a ray is not held to half a block a step.
  float cell = floor(p.z / 11.0);
  float nbr = cell + (fract(p.z / 11.0) < 0.5 ? -1.0 : 1.0);
  float cap = max((9.5 - ax) * 0.6, (p.y - py - 20.0 - max(ax - 10.0, 0.0) * 0.15) * 0.7);
  float cliff = min(min(faultBlock(p, ax, side, cell), faultBlock(p, ax, side, nbr)), max(5.5, cap));

  // The gorge floor, rising toward the cliffs, split by the rift.
  float rx = dx - riftX(p.z);
  float floorY = py - RIFT_DEPTH + abs(rx) * 0.08 + sin(p.x * 0.4) * sin(p.z * 0.3) * 0.6;
  float ground = max((p.y - floorY) * 0.8, 0.8 - abs(rx));
  float rift = max(p.y - floorY + 1.2, abs(rx) - 1.0);

  // Slabs of strata thrown up out of the gorge, clear over the stair or out
  // beside it, with bedding in their sides and a torn underside.
  float sCell = floor((p.z + 13.0) / 26.0);
  float sz = mod(p.z + 13.0, 26.0) - 13.0;
  float ss = hash11(sCell * 1.9 + 4.0) > 0.5 ? 1.0 : -1.0;
  vec3 sq = vec3(dx - ss * (7.0 + hash11(sCell + 1.0) * 7.0),
                 p.y - pathY(5.0, p.z - sz) - 7.0 - hash11(sCell + 4.0) * 9.0 - sin(animTime() * 0.3 + sCell) * 0.4,
                 sz);
  sq.xy *= rot((hash11(sCell + 7.0) - 0.5) * 1.2 + uFinale * ss);
  sq.yz *= rot((hash11(sCell + 8.0) - 0.5) * 0.5);
  vec3 sb = vec3(2.6 + hash11(sCell + 2.0) * 2.5, 0.9 + hash11(sCell + 9.0), 3.0 + hash11(sCell + 3.0) * 3.0);
  float slab = sdBox(sq, sb) + sin(sq.y * 7.0 + sin(sq.x * 0.8) * 2.0) * 0.05;
  slab -= sin(sq.x * 1.7 + sq.z * 1.1) * sin(sq.z * 1.3 + sCell) * 0.35 * smoothstep(0.3, -0.6, sq.y);
  slab *= 0.75;

  // Flights torn out of a stair: steel treads on a pair of stringers, a rail
  // on one side, three to five treads either side of the middle.
  float fCell = floor((p.z + 7.0) / 14.0);
  float fz = mod(p.z + 7.0, 14.0) - 7.0;
  float fs = hash11(fCell * 2.3) > 0.5 ? 1.0 : -1.0;
  vec3 fq = vec3(dx - fs * (5.2 + hash11(fCell + 2.0) * 4.0),
                 p.y - pathY(5.0, p.z - fz) - mix(-7.0, 7.0, hash11(fCell + 11.0)) - sin(animTime() * 0.4 + fCell) * 0.25,
                 fz);
  fq.xy *= rot((hash11(fCell + 3.0) - 0.5) * 0.9 + uFinale * fs * 0.8);
  fq.yz *= rot((hash11(fCell + 5.0) - 0.5) * 0.6);
  float flight = 1e4;
  if (length(fq) < 6.0) {
    const float FR = 0.2;
    const float FG = 0.32;
    float fn = 3.0 + floor(hash11(fCell + 7.0) * 3.0);
    float k = clamp(floor(fq.z / FG + 0.5), -fn, fn);
    float tread = sdBox(vec3(fq.x, fq.y + k * FR, fq.z - k * FG), vec3(0.95, 0.03, FG * 0.5 - 0.01));
    float fl = length(vec2(FR, FG));
    vec2 sc = vec2(fq.y * FG + fq.z * FR, fq.z * FG - fq.y * FR) / fl;
    float stringer = sdBox(vec3(abs(fq.x) - 1.0, sc.x + 0.12, sc.y), vec3(0.05, 0.16, (fn + 0.5) * fl));
    float rail = sdBox(vec3(fq.x - 1.0, sc.x - 0.95, sc.y), vec3(0.025, 0.03, fn * fl));
    float kp = clamp(floor(fq.z / (2.0 * FG) + 0.5), -floor(fn * 0.5), floor(fn * 0.5));
    float post = sdBox(vec3(fq.x - 1.0, fq.y + 2.0 * kp * FR - 0.5, fq.z - 2.0 * kp * FG), vec3(0.02, 0.48, 0.02));
    flight = min(min(tread, stringer), min(rail, post));
  } else flight = length(fq) - 5.0;

  // Rings: broken hoops of steel round the line every 45 units, each tipped
  // and turning slowly in its own plane, with a light along the inner face.
  float rz = mod(p.z + 22.5, 45.0) - 22.5;
  float rCell = floor((p.z + 22.5) / 45.0);
  vec3 rq = vec3(dx, p.y - pathY(5.0, p.z - rz) - 3.0, rz);
  rq.yz *= rot((hash11(rCell + 1.0) - 0.5) * 0.7);
  rq.xz *= rot((hash11(rCell + 2.0) - 0.5) * 0.8);
  rq.xy *= rot(animTime() * (hash11(rCell) - 0.5) * 0.1 + uFinale * 0.8 + rCell);
  float rr = length(rq.xy);
  float ang = atan(rq.y, rq.x);
  float gap = min(abs(mod(ang + 2.74, 6.2832) - 3.1416), abs(mod(ang - 0.86, 6.2832) - 3.1416)) -
              0.18 - hash11(rCell + 3.0) * 0.3;
  gap *= rr;
  float hoop = sdBox(vec3(rr - 11.5, rq.z, 0.0), vec3(0.32, 0.85, 1.0)) - 0.04;
  hoop = max(hoop, -gap);
  float glow = max(length(vec2(rr - 11.15, rq.z)) - 0.08, -gap - 0.3);

  float lit = min(glow, rift);
  float steel = min(hoop, flight);
  float rock = min(min(cliff, ground), slab);
  vec2 r = steel < rock ? vec2(steel, M_MACHINE) : vec2(rock, M_ROCK);
  return lit < r.x ? vec2(lit, M_EMISSIVE) : r;
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
