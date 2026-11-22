// THE LOOP LINE — a parked car's side, for the CARRIAGE mode of the surface
// shader in world.ts: where its glazing and doors are, and the lit saloon
// behind the glass, interior-mapped from the camera's position in the car's
// own frame (vCamL).

export const CARRIAGE_GLSL = /* glsl */`
// A rounded box in 2D: negative inside.
float sdRound (vec2 p, vec2 c, vec2 h, float r) {
  vec2 q = abs(p - c) - h + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

// A parked car's side, in its own (along, up) metres: the glazing, the
// door leaves and the window surround as distances, negative inside.
// Doors are 1.36 m pairs at 4.6 m either side of the middle; six panes
// between them, two in each end bay.
vec3 carSide (vec2 p) {
  float az = abs(p.x);
  float pane;
  if (az < 3.705) {
    float c = (floor((p.x + 3.705) / 1.235) + 0.5) * 1.235 - 3.705;
    pane = sdRound(p, vec2(c, 2.19), vec2(0.545, 0.47), 0.09);
  }
  else {
    float c = (floor((az - 5.5) / 1.25) + 0.5) * 1.25 + 5.5;
    pane = az > 5.5 && az < 8.0 ? sdRound(vec2(az, p.y), vec2(c, 2.19), vec2(0.55, 0.47), 0.09) : 1.0;
  }
  float dz = az - 4.6;
  float door = sdRound(vec2(dz, p.y), vec2(0.0, 2.05), vec2(0.68, 0.93), 0.05);
  float leaf = sdRound(vec2(abs(dz) - 0.34, p.y), vec2(0.0, 2.19), vec2(0.2, 0.47), 0.07);
  return vec3(min(pane, leaf), door, abs(dz) < 0.68 ? leaf : pane);
}

// The lit saloon seen through a pane: the view ray from the glass into the
// car's box, against the far wall, the ceiling with its two light lines, the
// floor, and the seat backs either side of the aisle, which is what makes
// the inside move against the glass as the train goes past.
vec3 carInterior (vec3 p, vec3 dir, float side) {
  float tx = dir.x * side < -0.01 ? (-side * 1.3 - p.x) / dir.x : 1e3;
  float ty = dir.y > 0.0 ? (3.22 - p.y) / max(dir.y, 1e-3) : (1.14 - p.y) / min(dir.y, -1e-3);
  float t = min(tx, ty);
  vec3 h = p + dir * t;
  vec3 warm = vec3(1.0, 0.93, 0.8);
  float lift = 0.55 + 0.45 * smoothstep(1.2, 3.2, h.y);
  vec3 c;
  if (ty < tx && dir.y > 0.0) {
    float strip = 1.0 - smoothstep(0.05, 0.09, abs(abs(h.x) - 0.48));
    c = warm * (0.55 + strip * 5.0);
  }
  else if (ty < tx)
    c = vec3(0.16, 0.16, 0.17) * lift;
  else {
    float win = step(1.72, h.y) * step(h.y, 2.66) * step(0.68, abs(abs(h.z) - 4.6));
    float rack = step(2.78, h.y) * step(h.y, 2.86);
    c = mix(vec3(0.62, 0.6, 0.55) * lift, vec3(0.02, 0.022, 0.03), win);
    c = mix(c, vec3(0.2), rack);
  }
  for (int k = 0; k < 2; k++) {
    float row = k == 0 ? side : -side;
    float tp = abs(dir.x) > 0.01 ? (row * 0.8 - p.x) / dir.x : -1.0;
    if (tp > 0.0 && tp < t) {
      vec3 sp = p + dir * tp;
      float back = step(fract(sp.z / 1.8 + 0.3), 0.09) * step(sp.y, 2.15);
      float seat = max(back, step(sp.y, 1.55)) * step(0.85, abs(abs(sp.z) - 4.6));
      if (seat > 0.5) {
        t = tp;
        c = vec3(0.1, 0.16, 0.42) * (0.45 + 0.4 * smoothstep(1.2, 2.2, sp.y));
        break;
      }
    }
  }
  return c;
}
`
