import { CONFIG } from '@wjh/config/config'


let cached: DeviceProfile | null = null

// What kind of device this is, decided once.
//
// Only coarse facts the browser will tell anyone: a touch-first pointer, the
// user agent's own claim to be mobile, the core count and (where exposed) the
// memory. A raymarched journey at a phone's native resolution is several
// million fragments a frame on a GPU a tenth the size of a desktop's, so the
// split that matters is "phone or not", and within phones, "old or not".

export interface DeviceProfile {

  /** Touch-first device: a phone or a tablet. */
  mobile: boolean;

  /** Device pixel ratio, as reported. */
  dpr: number;

  /**
   * 0 a phone, or any device with little memory or few cores; 1 a capable
   * tablet or a small laptop; 2 a desktop-class machine.
   */
  tier: 0 | 1 | 2;
}

export function detectDevice (): DeviceProfile {
  if (typeof window === 'undefined')
    return CONFIG.quality.serverProfile
  if (cached)
    return cached

  const nav    = navigator as Navigator & { deviceMemory?: number }
  const ua     = nav.userAgent || ''
  const mobile = isMobile(nav, ua)
  const tier   = tierOf(mobile, nav, ua)

  cached = { mobile, dpr: window.devicePixelRatio || 1, tier }
  return cached
}

function isMobile (nav: Navigator, ua: string): boolean {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  // iPadOS reports a desktop Safari user agent; touch points give it away.
  const ipad   = (/Macintosh/).test(ua) && nav.maxTouchPoints > 1
  return coarse || ipad || (/Android|iPhone|iPad|iPod|Mobile|Silk/i).test(ua)
}

function tierOf (mobile: boolean, nav: Navigator & { deviceMemory?: number }, ua: string): 0 | 1 | 2 {
  const cores  = nav.hardwareConcurrency || 4
  const memory = nav.deviceMemory ?? (mobile ? 4 : 8)
  if (mobile)
    return cores >= 8 && memory >= 6 && !(/Android [4-8]\b/).test(ua) ? 1 : 0
  return cores <= 4 || memory <= 4 ? 1 : 2
}
