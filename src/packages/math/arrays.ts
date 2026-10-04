// Typed-array and plain-array helpers.

/** `n` zeros as a plain array: the shape uniform arrays are built from. */
export function zeros (n: number): number[] {
  return Array.from({ length: n }, () => 0)
}

/**
 * `arr`, or a doubled copy of it with the first `used` elements kept, if there
 * is not room for `need` more. Amortised O(1) appends onto a typed array.
 */
export function grownTo<T extends Float32Array | Uint32Array> (arr: T, used: number, need: number, minCapacity: number): T {
  if (used + need <= arr.length)
    return arr

  let cap = Math.max(arr.length, minCapacity)
  while (cap < used + need)
    cap *= 2

  const next = new (arr.constructor as new (n: number) => T)(cap)
  next.set(arr.subarray(0, used))
  return next
}
