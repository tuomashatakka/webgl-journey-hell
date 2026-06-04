// THE STAIRWELL — timeline / pacing for the winding brutalist descent.
//
// The path is a chain of fixed-length SECTIONS. Each section is a distinct room
// type, and the corridor turns ±90° at most junctions (the turn table + room
// types are mirrored in the GLSL — keep SEG_LEN in sync with `SEG` in shaders.ts).
// The geometry is re-anchored to the camera's current section every frame inside
// the shader, so this module only drives the HUD label, the slow "iteration"
// aging counter, and the walk speed the render loop integrates into uPlayerZ.

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function mix(a: number, b: number, t: number): number {
  return a * (1.0 - t) + b * t;
}

export interface KinematicState {
  loop: number; // full towers (500u) descended — drives concrete aging
  sector: number; // room type 0..5 of the current section
  localZ: number; // distance travelled into the current section
  secLen: number; // section length
  name: string; // HUD section title
}

const SEG_LEN = 70.0; // MUST equal `SEG` in shaders.ts

// Six room types cycle along the descent (index = section mod 6).
const ROOM_NAMES = [
  'CONCRETE SHAFT',
  'THE ATRIUM VOID',
  'COLONNADE VAULT',
  'THE IMPOSSIBLE CROSSING',
  'SKYLIGHT WELL',
  'THE GALLERY',
];

export function getKinematicState(z: number): KinematicState {
  const seg = Math.floor(z / SEG_LEN);
  const roomType = ((seg % 6) + 6) % 6;
  return {
    loop: Math.floor(z / 500.0),
    sector: roomType,
    localZ: z - seg * SEG_LEN,
    secLen: SEG_LEN,
    name: ROOM_NAMES[roomType],
  };
}

// Walk speed (units/sec) per room — linger in the dramatic spaces, march the
// plain ones. Slows on the approach to a turn so cornering reads cleanly.
export function getWalkSpeed(z: number): number {
  const s = getKinematicState(z);
  const base =
    s.sector === 1 ? 4.5 // atrium — gawk at the void
    : s.sector === 3 ? 4.0 // impossible crossing — wary
    : s.sector === 4 ? 4.5 // skylight — slow into the light
    : s.sector === 2 ? 5.5 // vault
    : s.sector === 5 ? 5.5 // gallery
    : 6.5; // concrete shaft — brisk
  // Ease down over the last 20% of the section (the turn / landing).
  const frac = s.localZ / s.secLen;
  return base * (1.0 - 0.35 * smoothstep(0.8, 1.0, frac));
}
