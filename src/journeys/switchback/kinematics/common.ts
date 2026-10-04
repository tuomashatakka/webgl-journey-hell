export const D = Math.PI / 180

export const G = 9.81

/** Quadratic drag, per metre. Sets terminal speed on the big drop at ~26 m/s. */
export const DRAG = 0.0075

/** Rolling resistance. Small, and the only reason the ride would ever valley. */
export const ROLL_RES = 0.01

/**
 * The cart is not allowed to stop, however the physics feels about it. A gravity
 * railway that valleys is a real thing and it is also the end of the journey, so
 * the floor is a cheat and is documented as one.
 */
export const V_MIN = 2.4

export const V_MAX = 26

// ---------------------------------------------------------------------------
// The fall
// ---------------------------------------------------------------------------
//
// Four laps in, the track stops. Not at a buffer stop and not at a portal — the
// rails simply are not there any more, and the cart carries on into a shaft that
// has no bottom in it. Everything past this point is outside the lap: the
// section is not in SECTIONS, so assertRouteSane still validates a six-room
// cyclic railway and this cannot break it.

export const TYPE_FALL = 6

/** Metres of fall over which the last of the track's grade gives way to the shaft's. */
export const FALL_ENTRY = 150

/**
 * Where along a lap the flood of the next lap's decay arrives. Placed over THE
 * OVERLOOK for the same reason natatorium puts its water rise underwater: it is
 * the one stretch with no near geometry, so lamps going out and the ash thickening
 * happen against open sky where there is nothing to pop.
 */
export const DECAY_SECTION = 5

export const FIT_Z2 = 56
