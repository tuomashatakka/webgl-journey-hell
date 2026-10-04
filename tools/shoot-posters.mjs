// Capture the card posters in assets/posters/<slug>.jpg by driving the real
// journeys in a browser — the landing grid's fallback art is a genuine still of
// the shader, not a mockup.
//
//   bun run dev                       # in another shell
//   node tools/shoot-posters.mjs             # all journeys
//   node tools/shoot-posters.mjs stairwell   # selected journeys only
//   node tools/shoot-posters.mjs --bare loop-line stairwell
//                                            # no dev server: the bare harness
//
// --bare takes each shot from tools/harness at the shot's `t`, for the
// journeys the harness covers, and encodes the JPEG in the page — no Next, no waiting for a section to come round. It is how the loop line's and
// the stairwell's posters are made. (The harness has no CRT pass; neither does
// any frozen ?t= frame of the real app.)
//
// Each journey is left running until its HUD reports the section listed below,
// then the HUD is hidden and the viewport is captured. On a software renderer
// (CI, headless boxes) the journeys run at ~1 fps, hence `speed: 4` — the shots
// still take a couple of minutes.

import { chromium } from 'playwright-core'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CONFIG } from '../src/packages/config/config.ts'
import { findChromium, glArgs } from './chromium.mjs'


const { posters } = CONFIG.tools
const ROOT        = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT         = path.join(ROOT, posters.dir)
const BASE        = process.env.POSTER_BASE_URL ?? `${CONFIG.tools.devOrigin}${CONFIG.site.basePath}`
const SHOTS       = posters.shots.map(shot => ({ ...shot, section: new RegExp(shot.section) }))
const quality     = posters.quality

const bare      = process.argv.includes('--bare')
const requested = new Set(process.argv.slice(2).filter(a => !a.startsWith('--')))
const unknown   = [ ...requested ].filter(slug => !SHOTS.some(shot => shot.slug === slug))
if (unknown.length)
  throw new Error(`unknown journey slug: ${unknown.join(', ')}`)

const shots = requested.size ? SHOTS.filter(shot => requested.has(shot.slug)) : SHOTS

await mkdir(OUT, { recursive: true })

if (bare) {
  const { startHarness } = await import('./harness/serve.mjs')
  const harness          = await startHarness()
  const b                = await chromium.launch({
    executablePath: await findChromium(),
    args:           [ '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist' ],
  })
  const page = await b.newPage()
  for (const slug of requested.size ? [ ...requested ] : Object.keys(posters.bare)) {
    if (!(slug in posters.bare)) {
      console.warn(`${slug}: not covered by the bare harness, skipped`)
      continue
    }

    const t = posters.bare[slug]
    await page.goto(`${harness.url}/journeys/${slug}?t=${t}&w=${posters.width}&h=${posters.height}&hud=0&debug=0`)
    await page.waitForSelector('html[data-journey-ready="1"]', { state: 'attached', timeout: 300_000 })

    const jpeg = await page.evaluate(q => document.querySelector('canvas').toDataURL('image/jpeg', q / 100), quality)
    await writeFile(path.join(OUT, `${slug}.jpg`), Buffer.from(jpeg.split(',')[1], 'base64'))

    const label = await page.evaluate(() => window.__journeyDebug?.label ?? '')
    console.log(`${slug} → ${label}  (t=${t}, bare)`)
  }
  await b.close()
  await harness.close()
  process.exit(0)
}

// One browser per shot, so one journey's GPU trouble cannot cost the rest.
async function openPage () {
  const browser = await chromium.launch({
    executablePath: await findChromium(),
    args:           glArgs(),
  })
  const context = await browser.newContext({
    viewport:          { width: posters.width, height: posters.height },
    deviceScaleFactor: 1,
  })
  await context.addInitScript(([ key, settings ]) => {
    localStorage.setItem(key, JSON.stringify(settings))
  }, [ CONFIG.settings.storageKey, posters.settings ])
  const page = await context.newPage()
  return { browser, page }
}

const failed = []
for (const { slug, section, t } of shots) {
  const { browser, page } = await openPage()
  page.on('crash', () => console.error(`${slug}: page crashed`))
  page.on('pageerror', e => console.error(`${slug}: ${e.message}`))
  try {
    await shoot(page, slug, section, t)
  } catch (error) {
    failed.push(slug)
    console.error(`${slug}: ${error.message.split('\n')[0]}`)
  } finally {
    await browser.close().catch(() => {})
  }
}

if (failed.length) {
  console.error(`failed: ${failed.join(', ')}`)
  process.exit(1)
}

async function shoot (page, slug, section, t) {
  // A shot may name its instant: ?t= seeks the simulation and freezes there,
  // so the section is reached at once instead of driven to at 4x. ?t= implies
  // the debug overlay; a poster wants the chrome and not the panel.
  await page.goto(`${BASE}/journeys/${slug}${t !== undefined ? `?t=${t}&debug=0` : ''}`, { waitUntil: 'load' })
  await page.waitForSelector('#gl-canvas')

  const deadline = Date.now() + posters.sectionTimeoutMs
  let label = ''
  while (Date.now() < deadline) {
    // A frozen ?t= page publishes its label; a live one names its section on
    // the transport's state line.
    label = await page.evaluate(() =>
      window.__journeyDebug?.label ??
      document.querySelector('#journey-transport .jt-label')?.textContent ?? '').catch(() => '')
    if (section.test(label))
      break
    await page.waitForTimeout(1000)
  }

  await page.waitForTimeout(posters.settleMs) // a few more frames into the section
  await page.addStyleTag({ content: posters.hideHud })
  await page.waitForTimeout(1500)

  // JPEG, not PNG: a 1280x800 raymarch still is ~2 MB as PNG.
  await page.screenshot({ path: path.join(OUT, `${slug}.jpg`), type: 'jpeg', quality, timeout: 180_000 })
  console.log(`${slug} → ${label || '(section not reached)'}`)
}
