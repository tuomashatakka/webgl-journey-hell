// Capture the card posters in public/journeys/<slug>.jpg by driving the real
// journeys in a browser — the landing grid's fallback art is a genuine still of
// the shader, not a mockup.
//
//   bun run dev                       # in another shell
//   bun add -d playwright-core        # not a project dependency; only needed here
//   node tools/shoot-posters.mjs             # all journeys
//   node tools/shoot-posters.mjs stairwell   # selected journeys only
//
// Each journey is left running until its HUD reports the section listed below,
// then the HUD is hidden and the viewport is captured. On a software renderer
// (CI, headless boxes) the journeys run at ~1 fps, hence `speed: 4` — the shots
// still take a couple of minutes.

import { chromium } from 'playwright-core'
import { mkdir, rm } from 'node:fs/promises'
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
  { slug: 'loop-line', section: /THE CUT/ },
]

const requested = new Set(process.argv.slice(2))
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
  // so the section is reached at once instead of driven to at 4x.
  await page.goto(`${BASE}/journeys/${slug}${t !== undefined ? `?t=${t}` : ''}`, { waitUntil: 'load' })
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
