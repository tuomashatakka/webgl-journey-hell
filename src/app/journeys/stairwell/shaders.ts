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

  float sdTorusX (vec3 p, vec2 t) {
    vec2 q = vec2(length(p.yz) - t.x, p.x);
    return length(q) - t.y;
  }

  float sectionLength (float section) {
    if (section < 0.5) return 70.0;
    if (section < 1.5) return 85.0;
    if (section < 2.5) return 80.0;
    if (section < 3.5) return 90.0;
    if (section < 4.5) return 85.0;
    return 90.0;
  }

  float nextSection (float section) {
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

  float pathY (float section, float z) {
    float run = 1.45;
    float rise = 0.34;
    if (section > 0.5 && section < 1.5) { run = 1.2; rise = 0.17; }
    else if (section > 1.5 && section < 2.5) { run = 1.55; rise = 0.28; }
    else if (section > 2.5 && section < 3.5) { run = 1.35; rise = 0.31; }
    else if (section > 3.5 && section < 4.5) { run = 1.3; rise = 0.24; }
    else if (section > 4.5) { run = 1.1; rise = 0.22; }
    float stepped = -rise * floor(z / run);
    if (section > 4.5)
      stepped += sin(z * 0.18) * uFinale * 1.4;
    return stepped;
  }

  float railY (float section, float z) {
    float run = 1.45;
    float rise = 0.34;
    if (section > 0.5 && section < 1.5) { run = 1.2; rise = 0.17; }
    else if (section > 1.5 && section < 2.5) { run = 1.55; rise = 0.28; }
    else if (section > 2.5 && section < 3.5) { run = 1.35; rise = 0.31; }
    else if (section > 3.5 && section < 4.5) { run = 1.3; rise = 0.24; }
    else if (section > 4.5) { run = 1.1; rise = 0.22; }
    return -z * rise / run;
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

    float railHeight = railY(section, p.z) + 1.0;
    float railL = length(vec2(p.x - px + width + 0.18, p.y - railHeight)) - 0.055;
    float railR = length(vec2(p.x - px - width - 0.18, p.y - railHeight)) - 0.055;
    float rails = min(railL, railR);
    return rails < solidPath ? vec2(rails, MAT_STEEL) : vec2(solidPath, MAT_CONCRETE);
  }

  vec2 spillway (vec3 p) {
    float py = pathY(0.0, p.z);
    float zCell = mod(p.z + 9.0, 18.0) - 9.0;
    float dam = sdBox(p - vec3(-13.0, py + 7.0, p.z), vec3(5.5, 15.0, 130.0));
    float buttress = sdBox(vec3(abs(p.x + 7.0) - 3.0, p.y - py - 2.5, zCell), vec3(0.65, 5.0, 1.2));
    float penstock = sdCylinderZ(vec3(p.x - 8.5, p.y - py + 4.0, zCell), 8.0, 1.8);
    float gate = sdBox(vec3(p.x - 6.0, p.y - py - 2.0, zCell), vec3(3.6, 3.2, 0.34));
    float d = min(dam, min(buttress, min(penstock, gate)));
    return vec2(d, gate < min(dam, min(buttress, penstock)) ? MAT_MACHINE : MAT_CONCRETE);
  }

  vec2 stormBridge (vec3 p) {
    float py = pathY(1.0, p.z);
    float zCell = mod(p.z + 11.0, 22.0) - 11.0;
    vec3 postP = vec3(abs(p.x - pathX(1.0, p.z)) - 4.2, p.y - py - 4.0, zCell);
    float pylons = sdBox(postP, vec3(0.28, 4.3, 0.28));
    float cross = sdBox(vec3(p.x - pathX(1.0, p.z), p.y - py - 7.8, zCell), vec3(4.4, 0.22, 0.25));
    float cable = abs(length(vec2(abs(p.x - pathX(1.0, p.z)) - 4.2, p.y - py - 7.7)) - 0.06);
    float beacon = sdBox(vec3(abs(p.x - pathX(1.0, p.z)) - 4.2, p.y - py - 8.4, zCell), vec3(0.14));
    float d = min(min(pylons, cross), min(cable, beacon));
    return vec2(d, beacon < min(pylons, cross) ? MAT_EMISSIVE : MAT_STEEL);
  }

  vec2 turbineCanyon (vec3 p) {
    float py = pathY(2.0, p.z);
    float zCell = mod(p.z + 14.0, 28.0) - 14.0;
    vec3 turbineP = vec3(abs(p.x - pathX(2.0, p.z)) - 8.5, p.y - py - 2.2, zCell);
    turbineP.yz *= rotate2(iTime * 0.32 + hash11(floor(p.z / 28.0)) * 6.28);
    float housing = sdCylinderX(turbineP, 2.0, 3.5);
    float hub = sdCylinderX(turbineP, 2.5, 0.65);
    float bladeA = sdBox(turbineP, vec3(2.25, 0.18, 3.0));
    turbineP.yz *= rotate2(1.5708);
    float bladeB = sdBox(turbineP, vec3(2.25, 0.18, 3.0));
    float penstock = sdCylinderZ(vec3(abs(p.x) - 14.0, p.y - py + 2.0, zCell), 13.0, 2.4);
    float d = min(housing, min(hub, min(bladeA, min(bladeB, penstock))));
    return vec2(d, MAT_MACHINE);
  }

  vec2 conveyorEscarpment (vec3 p) {
    float px = pathX(3.0, p.z);
    float py = pathY(3.0, p.z);
    float zCell = mod(p.z + 10.0, 20.0) - 10.0;
    float quarry = p.y + 10.0 - abs(p.x) * 0.16 + floor(abs(p.x) / 5.0) * 0.72;
    float belt = sdBox(vec3(p.x - px - 7.0, p.y - py - 4.4, zCell), vec3(2.0, 0.26, 9.6));
    float support = sdBox(vec3(p.x - px - 7.0, p.y - py - 2.0, zCell), vec3(0.2, 2.4, 0.25));
    vec3 wheelP = vec3(p.x - px - 11.0, p.y - py - 4.0, mod(p.z + 25.0, 50.0) - 25.0);
    wheelP.yz *= rotate2(iTime * 0.18);
    float wheel = sdTorusX(wheelP, vec2(4.2, 0.35));
    float boom = sdBox(vec3(p.x - px + 9.0, p.y - py - 7.0, zCell), vec3(0.28, 7.0, 0.28));
    float d = min(quarry, min(belt, min(support, min(wheel, boom))));
    return vec2(d, quarry < min(belt, support) ? MAT_ROCK : MAT_MACHINE);
  }

  vec2 coolingField (vec3 p) {
    float px = pathX(4.0, p.z);
    float py = pathY(4.0, p.z);
    float zCell = mod(p.z + 21.0, 42.0) - 21.0;
    vec3 towerP = vec3(abs(p.x - px) - 15.0, p.y - py - 8.0, zCell);
    float towerRadius = 4.4 + towerP.y * towerP.y * 0.018;
    float tower = max(abs(length(towerP.xz) - towerRadius) - 0.3, abs(towerP.y) - 10.0);
    float pipe = sdCylinderZ(vec3(abs(p.x - px) - 6.0, p.y - py - 0.2, zCell), 19.0, 0.65);
    float stack = sdCylinderY(vec3(abs(p.x - px) - 9.0, p.y - py - 4.0, zCell), 4.5, 0.7);
    float wetland = p.y - py + 3.5 + sin(p.x * 0.35) * 0.35;
    float d = min(tower, min(pipe, min(stack, wetland)));
    return vec2(d, tower < min(pipe, stack) ? MAT_CONCRETE : MAT_STEEL);
  }

  vec2 shearHorizon (vec3 p) {
    float px = pathX(5.0, p.z);
    float py = pathY(5.0, p.z);
    float cell = floor((p.z + 6.0) / 12.0);
    float zCell = mod(p.z + 6.0, 12.0) - 6.0;
    float angle = (hash11(cell * 4.7) - 0.5) * (0.4 + uRupture * 1.4);
    vec3 shardP = vec3(abs(p.x - px) - 7.0 - hash11(cell) * 7.0, p.y - py - 3.0, zCell);
    shardP.xy *= rotate2(angle + uFinale * sin(cell) * 1.2);
    float shard = sdBox(shardP, vec3(2.8 + hash11(cell + 2.0) * 3.0, 0.5, 5.0));
    vec3 ringP = vec3(p.x - px, p.y - py - 12.0, mod(p.z + 40.0, 80.0) - 40.0);
    ringP.xy *= rotate2(0.7 + uFinale * 0.8);
    float ring = sdTorusX(ringP, vec2(13.0, 0.6));
    float monolith = sdBox(vec3(abs(p.x - px) - 18.0, p.y - py - 7.0, zCell), vec3(2.0, 11.0, 3.5));
    float d = min(shard, min(ring, monolith));
    return vec2(d, ring < min(shard, monolith) ? MAT_EMISSIVE : MAT_MACHINE);
  }

  vec2 sectionEnvironment (vec3 p, float section) {
    if (section < 0.5) return spillway(p);
    if (section < 1.5) return stormBridge(p);
    if (section < 2.5) return turbineCanyon(p);
    if (section < 3.5) return conveyorEscarpment(p);
    if (section < 4.5) return coolingField(p);
    return shearHorizon(p);
  }

  vec2 ruptureDebris (vec3 p, float section) {
    if (uRupture < 0.05)
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
    if (section < 0.5) {
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
    color += vec3(0.10, 0.55, 1.3) * crack * (0.5 + uFinale * 3.0);
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
      float fog = 1.0 - exp(-travel * (gSection > 0.5 && gSection < 1.5 ? 0.018 : 0.009));
      color = mix(color, skyColor, fog);
    }

    vec4 clouds = marchClouds(ro, rd, min(travel, FAR_CLIP), gSection);
    color = color * (1.0 - clouds.a) + clouds.rgb;

    // Every act hands off through its own atmosphere. The veil is strongest at
    // the midpoint where two unrelated SDFs would otherwise exchange the first
    // visible surface abruptly, and clears completely at both endpoints.
    float transitionVeil = smoothstep(0.0, 0.16, gTransition)
      * (1.0 - smoothstep(0.72, 1.0, gTransition));
    vec3 veilColor = mix(
      sectionSky(normalize(rd + vec3(0.0, 0.18, 0.0)), gSection),
      sectionSky(normalize(rd + vec3(0.0, 0.18, 0.0)), gNextSection),
      gTransition
    );
    color = mix(color, veilColor, transitionVeil * 0.88);

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
  uniform float uFinale;

  float hash21 (vec2 p) {
    return fract(sin(dot(p, vec2(127.17, 311.73))) * 43758.3123);
  }

  void main () {
    vec2 uv = gl_FragCoord.xy / iResolution.xy;
    vec2 center = uv - 0.5;
    float r2 = dot(center, center);
    vec2 warped = uv + center * r2 * mix(0.035, 0.12, uFinale);

    float band = floor(warped.y * 38.0 + iTime * 8.0);
    float glitch = step(0.92 - uRupture * 0.11 - uFinale * 0.18, hash21(vec2(band, floor(iTime * 7.0))));
    warped.x += (hash21(vec2(band, 17.0)) - 0.5) * glitch * (0.012 + uFinale * 0.045);

    vec2 ca = center * (r2 + 0.02) * (0.035 + uRupture * 0.055 + uFinale * 0.08);
    vec3 color;
    color.r = texture2D(uTexture, warped - ca).r;
    color.g = texture2D(uTexture, warped).g;
    color.b = texture2D(uTexture, warped + ca).b;

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

    float finaleFade = 1.0 - smoothstep(0.82, 1.0, uFinale) * 0.22;
    color *= finaleFade;
    gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
  }
`

// perf: expensive only in the storm/finale volume; 62/92 sdf and 32/64 cloud steps by quality.
