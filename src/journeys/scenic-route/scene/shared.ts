import type { Mesh } from '@wjh/gl/mesh'

/** Sky LUT size. Rows 0..63 are elevation, row 64 the sun's radiance. */
export const SKY_W = 128
export const SKY_H = 65

/** Bank LUT texture width; rows wrap. */
export const BANK_TEX_W = 1024

/** The sun's depth map: size, and the half-width of the box it covers. */
export const SHADOW_SIZE  = 2048


/** How far above the river's spine the land is raised inland: over the vault (1.42 × the widest ring), falling to the road at the portal. */
export const PORTAL_LIFT = 30

/** The rear-view pass: the mirror glass is 3.3:1. */
export const MIRROR_W = 320
export const MIRROR_H = 96

export interface Drawable {
  mesh:   Mesh;
  cx:     number;
  cy:     number;
  cz:     number;
  radius: number;
}
