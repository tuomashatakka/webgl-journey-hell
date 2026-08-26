// deterministic pseudo-random number generators for simulation and procedural
// generation.
//
// this repo's whole debug story is `?t=42.5` — seeking the timeline to an
// exact instant and expecting byte-identical pixels across reloads and
// machines. any call to Math.random() inside a simulation step or procedural
// generator breaks that reproducibility: different platforms, browser
// versions, or even GC timing can shuffle the random sequence and produce
// slightly different debris trajectories, different cloud formations, or
// different noise fields at the same timestamp.
//
// the generators here are integer-mixing hashes using Math.imul and unsigned
// right-shifts, so they produce identical output on every platform that
// implements those operations faithfully (which is every mainstream engine).
// mulberry32 is the seeded prng used by foundry's debris simulation; hash2
// and hash3 are 2d/3d spatial hashes for deterministic noise and particle
// placement.


/**
 * Mulberry32 — a 32-bit seeded prng that produces [0,1) floats. The body is
 * copied verbatim from foundry/physics.ts to keep debris bit-identical.
 */
export function mulberry32 (seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = a + 0x6d2b79f5 >>> 0

    let t = Math.imul(a ^ a >>> 15, 1 | a)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}


/** Deterministic [0,1) from two integer coordinates via integer mixing. */
export function hash2 (x: number, y: number): number {
  let h = x * 374761393 + y * 668265263 | 0
  h = Math.imul(h ^ h >>> 13, 1274126177) | 0
  h = h ^ h >>> 16
  return (h >>> 0) / 4294967296
}


/** Deterministic [0,1) from three integer coordinates via integer mixing. */
export function hash3 (x: number, y: number, z: number): number {
  let h = x * 374761393 + y * 668265263 + z * 1103515249 | 0
  h = Math.imul(h ^ h >>> 13, 1274126177) | 0
  h = h ^ h >>> 16
  return (h >>> 0) / 4294967296
}
