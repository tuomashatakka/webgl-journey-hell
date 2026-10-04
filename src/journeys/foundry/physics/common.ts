// clamp so a stalled tab can't spiral

export const G            = 9.81

/** Eye height above the walking surface, metres. */
export const EYE_HEIGHT = 1.62

// --- the lift shaft (mirrored by the shader) --------------------------------

/** Cyclic position of the shaft, part-way down the loading bay. */
export const LIFT_Z = 18

/** How far back from the cage's centre you stand, metres. */
export const LIFT_STAND = 0.55

/** Where the walk starts and ends: standing in the cage at the landing. */
export const WALK_START = LIFT_Z - LIFT_STAND

export const LIFT_TOP     = 120

/** Landing level — the cage floor comes to rest flush with the hall's. */
export const LANDING_Y = 0

// --- lap phases -------------------------------------------------------------

/** Falling: the cable has parted and nothing is holding the cage. */
export const MODE_FALL = 0

/** Stopped at the landing; the gate is rattling up. */
export const MODE_SETTLE = 2

/** On foot, walking the seven halls. */
export const MODE_WALK = 3

/** Past the pit, with nothing below it. There is no phase after this one. */
export const MODE_OBLIVION = 5
