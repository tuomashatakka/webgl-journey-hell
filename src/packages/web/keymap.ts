// The key map, as pure functions over CONFIG.keys: which key means what, and
// the arithmetic of the look offset. No DOM, no React: the hook that owns the
// listeners only asks "what does this press mean" and does it.

import { CONFIG } from '@wjh/config/config'
import { clamp } from '@wjh/math/scalar'


type LoopAction = 'prev-lap' | 'next-lap'

export type KeyBinding =
  | { kind: 'pause' } |
  { kind: 'seek'; seconds: number } |
  { kind: 'loop'; action: LoopAction } |
  { kind: 'speed'; value: number }

export interface KeyPress {
  code:    string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey:  boolean;
}

/** The held look keys as one direction, each axis in -1..1. */
type LookDirectionReturnType = { x: number; y: number }

/**
 * What a key press means, or null. Meta+Arrow is the loop jump and is tested
 * before the plain arrows, which seek. Other modifiers belong to the browser.
 */
export function bindingFor (e: KeyPress): KeyBinding | null {
  const keys = CONFIG.keys
  if (e.ctrlKey || e.altKey)
    return null

  if (e.metaKey) {
    const action = keys.loop[e.code]
    return action ? { kind: 'loop', action } : null
  }

  if (keys.pause.includes(e.code))
    return { kind: 'pause' }

  const dir = keys.seek[e.code]
  if (dir)
    return { kind: 'seek', seconds: dir * keys.seekSeconds }

  const value = keys.speed[e.code]
  return value ? { kind: 'speed', value } : null
}

/** Is this a look key (held, not pressed)? */
export function isLookKey (e: Pick<KeyPress, 'code' | 'metaKey' | 'ctrlKey' | 'altKey'>): boolean {
  return !e.metaKey && !e.ctrlKey && !e.altKey && e.code in CONFIG.keys.look
}

export function lookDirection (held: Iterable<string>): LookDirectionReturnType {
  let x = 0
  let y = 0
  for (const code of held) {
    const v = CONFIG.keys.look[code]
    if (!v)
      continue
    x += v[0]
    y += v[1]
  }
  return { x: clamp(x, -1, 1), y: clamp(y, -1, 1) }
}

/**
 * One axis of the look offset, advanced by `dt`: pushed toward `dir * limit`
 * while a key is held, eased back to zero on release.
 */
export function stepLookOffset (offset: number, dir: number, dt: number): number {
  const k      = CONFIG.keys
  const rate   = dir === 0 ? k.lookReturnRate : k.lookPushRate
  const target = dir * k.lookLimit
  return clamp(offset + (target - offset) * (1 - Math.exp(-rate * dt)), -k.lookLimit, k.lookLimit)
}
