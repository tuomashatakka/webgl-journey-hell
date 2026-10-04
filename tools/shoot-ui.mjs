// Capture the README's screenshots of the app chrome (index, journey, tooltip,
// settings, phone) into assets/screenshots/app-*.png from a running dev server.
//
//   bun run dev            # in another shell
//   node tools/shoot-ui.mjs

import { chromium } from 'playwright-core'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CONFIG } from '../src/packages/config/config.ts'
import { findChromium, glArgs } from './chromium.mjs'


const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT  = path.join(ROOT, 'assets/screenshots')
const BASE = process.env.UI_BASE_URL ?? `${CONFIG.tools.devOrigin}${CONFIG.site.basePath}`
const shot = async (vp, name, fn) => {
  const b = await chromium.launch({ executablePath: await findChromium(), args: glArgs() })
  const p = await b.newPage({ viewport: vp, deviceScaleFactor: 2 })
  p.on('pageerror', e => console.error(name, e.message))
  await fn(p)
  await p.screenshot({ path: `${OUT}/${name}.png` })
  console.log('ok', name)
  await b.close()
}
const journey = async p => {
  await p.goto(`${BASE}/journeys/natatorium`)
  // data-journey-ready is a debug-mode signal; a live page is waited out past its opening.
  await p.waitForSelector('#gl-canvas')
  await p.waitForTimeout(12_000)
  await p.mouse.move(640, 400)
}
const desk = { width: 1280, height: 800 }
await shot(desk, 'app-index', async p => { await p.goto(BASE); await p.waitForTimeout(3000); await p.hover('a[href*="journeys/stairwell"]').catch(() => {}); await p.waitForTimeout(3000) })
await shot(desk, 'app-journey', journey)
await shot(desk, 'app-tooltip', async p => { await journey(p); await p.hover('#fullscreen-btn'); await p.waitForTimeout(800) })
await shot(desk, 'app-settings', async p => { await journey(p); await p.click('#settings-btn'); await p.waitForTimeout(800) })
await shot({ width: 390, height: 844 }, 'app-phone', journey)
