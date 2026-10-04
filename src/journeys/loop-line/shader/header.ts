/** Lamps per draw. A bay uploads its nearest this many to the camera. */
export const MAX_LAMPS = 24

/** Lamps that scatter into the air, nearest the camera across all bays. */
export const MAX_SCATTER = 8

/** Points per headwall opening; two openings at most. */
export const MAX_HOLE = 24

export const HEADER = /* glsl */`#version 300 es
precision highp float;
precision highp int;
`
