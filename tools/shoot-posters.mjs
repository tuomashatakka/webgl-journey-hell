// Capture the card posters in public/journeys/<slug>.jpg by driving the real
// journeys in a browser — the landing grid's fallback art is a genuine still of
// the shader, not a mockup.
//
//   bun run dev                       # in another shell
//   bun add -d playwright-core        # not a project dependency; only needed here
//   node tools/shoot-posters.mjs             # all journeys
//   node tools/shoot-posters.mjs stairwell   # selected journeys only
//   node tools/shoot-posters.mjs --bare loop-line stairwell
//                                            # no dev server: the bare harness
//
// --bare takes each shot from tools/harness at the shot's `t`, for the
// journeys the harness covers, and encodes the JPEG in the page — no sharp, no
// Next, no waiting for a section to come round. It is how the loop line's and
// the stairwell's posters are made. (The harness has no CRT pass; neither does
// any frozen ?t= frame of the real app.)
//
// Each journey is left running until its HUD reports the section listed below,
// then the HUD is hidden and the viewport is captured. On a software renderer
// (CI, headless boxes) the journeys run at ~1 fps, hence `speed: 4` — the shots
// still take a couple of minutes.

import { chromium } from 'playwright-core'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'


const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT  = path.join(ROOT, 'public/journeys')
const BASE = process.env.POSTER_BASE_URL ?? 'http://localhost:3000/webgl-journey-hell'

const SHOTS = [
  { slug: 'liminal', section: /CRYSTAL CAVE/ },
  { slug: 'stairwell', section: /PROTEAN WEATHER BRIDGE/ },
  { slug: 'skybridges', section: /THE ASCENT/ },
  { slug: 'foundry', section: /FURNACE FLOOR|GEARWORKS/ },
  { slug: 'scenic-route', section: /THE FALL/, t: 103.2 },
  { slug: 'hollow-orchard', section: /THE NURSERY/ },
  { slug: 'natatorium', section: /TILE CORRIDOR/ },
  { slug: 'switchback', section: /THE BOARDING PLATFORM/ },
  { slug: 'loop-line', section: /THE VIADUCT/, t: 87 },
]

// The bare harness's own instants, for the journeys it can drive.
const BARE = {
  'loop-line': 87,
  'stairwell': 24,
}

const bare      = process.argv.includes('--bare')
const requested = new Set(process.argv.slice(2).filter(a => !a.startsWith('--')))
const unknown   = [ ...requested ].filter(slug => !SHOTS.some(shot => shot.slug === slug))
if (unknown.length)
  throw new Error(`unknown journey slug: ${unknown.join(', ')}`)

const shots = requested.size ? SHOTS.filter(shot => requested.has(shot.slug)) : SHOTS

const SETTINGS = {
  resolution:   0.75,
  speed:        4.0,
  heavyEffects: false,
  brightness:   1.0,
  contrast:     1.0,
  maxFrameRate: 60,
}

const HIDE_HUD = `
  #back-btn, #fullscreen-btn, #audio-btn, #settings-btn, #fps-display, #sector-title,
  nextjs-portal { display: none !important; }
`

await mkdir(OUT, { recursive: true })

if (bare) {
  const { startHarness } = await import('./harness/serve.mjs')
  const harness          = await startHarness()
  const linux            = process.platform === 'linux'
  const b                = await chromium.launch({
    executablePath: process.env.JOURNEY_CHROMIUM ?? (linux ? '/opt/pw-browsers/chromium' : undefined),
    args:           [ '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist' ],
  })
  const page = await b.newPage()
  for (const slug of requested.size ? [ ...requested ] : Object.keys(BARE)) {
    if (!(slug in BARE)) {
      console.warn(`${slug}: not covered by the bare harness, skipped`)
      continue
    }
    await page.goto(`${harness.url}/journeys/${slug}?t=${BARE[slug]}&w=1280&h=800&hud=0&debug=0`)
    await page.waitForSelector('html[data-journey-ready="1"]', { timeout: 300_000 })

    const jpeg = await page.evaluate(() => document.querySelector('canvas').toDataURL('image/jpeg', 0.84))
    await writeFile(path.join(OUT, `${slug}.jpg`), Buffer.from(jpeg.split(',')[1], 'base64'))

    const label = await page.evaluate(() => window.__journeyDebug?.label ?? '')
    console.log(`${slug} → ${label}  (t=${BARE[slug]}, bare)`)
  }
  await b.close()
  await harness.close()
  process.exit(0)
}

const browser = await chromium.launch({
  args: [ '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader' ],
})
const context = await browser.newContext({
  viewport:          { width: 1280, height: 800 }, // 16:10, the card's aspect ratio
  deviceScaleFactor: 1,
})
await context.addInitScript(settings => {
  localStorage.setItem('journey-graphics-settings-v1', JSON.stringify(settings))
}, SETTINGS)

for (const { slug, section, t } of shots) {
  const page = await context.newPage()
  // A shot may name its instant: ?t= seeks the simulation and freezes there,
  // so the section is reached at once instead of driven to at 4x. ?t= implies
  // the debug overlay; a poster wants the chrome and not the panel.
  await page.goto(`${BASE}/journeys/${slug}${t !== undefined ? `?t=${t}&debug=0` : ''}`, { waitUntil: 'load' })
  await page.waitForSelector('#gl-canvas')

  const deadline = Date.now() + 240_000
  let label = ''
  while (Date.now() < deadline) {
    label = await page.$eval('#sector-title', el => el.textContent ?? '').catch(() => '')
    if (section.test(label))
      break
    await page.waitForTimeout(1000)
  }

  await page.waitForTimeout(4000) // a few more frames into the section
  await page.addStyleTag({ content: HIDE_HUD })
  await page.waitForTimeout(1500)

  const png = path.join(OUT, `${slug}.png`)
  await page.screenshot({ path: png, timeout: 180_000 })
  console.log(`${slug} → ${label || '(section not reached)'}`)
  await page.close()

  // Ship JPEG, not PNG: a 1280×800 raymarch still is ~2 MB as PNG.
  // eslint-disable-next-line import/no-extraneous-dependencies -- optional tool-only encoder
  const sharp = await import('sharp').catch(() => null)
  if (sharp) {
    await sharp.default(png).jpeg({ quality: 82 })
      .toFile(path.join(OUT, `${slug}.jpg`))
    await rm(png)
  }
  else
    console.warn(`  (no sharp installed — left ${slug}.png, convert it by hand)`)
}

await browser.close()
