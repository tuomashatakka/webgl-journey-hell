// Film every journey until its signal is gone, and archive the
// films: assets/archive/<yyyymmdd><noon|eve>/<slug>.gif.
//
//   node tools/shoot-gifs.mjs                      # every journey
//   node tools/shoot-gifs.mjs switchback foundry   # selected journeys only
//   node tools/shoot-gifs.mjs --stamp=20261112eve  # name the folder yourself
//
// No dev server: the bare harness (tools/harness) holds one page per journey
// and is asked for each instant in turn, so a film costs one bundle and one
// shader compile, not one per frame. The harness also says where the picture
// starts to fail (the instant the journey's signalAge runs past the grace it
// is given); the film runs on from there through the whole ramp and a held
// moment of the dead channel, so no film stops short of the loss. Each frame
// is the frame `?t=` would show, so two films of the same code are the same
// film.
//
// The folder is named for the run: the date, and `noon` or `eve` by the hour on
// the machine's own clock (CONFIG.tools.gifs.eveFromHour). A second run in the
// same half of the day overwrites the first.

import { chromium } from 'playwright-core'

import { mkdir, readdir, writeFile } from 'node:fs/promises'

import { existsSync } from 'node:fs'

import path from 'node:path'

import { fileURLToPath } from 'node:url'

import { CONFIG } from '../src/packages/config/config.ts'

import { findChromium, glArgs } from './chromium.mjs'

import { encodeGif } from './gif.mjs'

import { startHarness } from './harness/serve.mjs'


const { gifs } = CONFIG.tools

const ROOT     = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const JOURNEYS = path.join(ROOT, 'src/journeys')

const args      = process.argv.slice(2)

const requested = args.filter(a => !a.startsWith('--'))

const stamp     = args.find(a => a.startsWith('--stamp='))?.slice(8) ?? stampOf(new Date())

const known = (await readdir(JOURNEYS, { withFileTypes: true }))
  .filter(entry => entry.isDirectory() && existsSync(path.join(JOURNEYS, entry.name, 'journey.ts')))
  .map(entry => entry.name)
  .sort()

const unknown = requested.filter(slug => !known.includes(slug))

if (unknown.length)
  throw new Error(`unknown journey slug: ${unknown.join(', ')}`)

const out = path.join(ROOT, gifs.dir, stamp)

await mkdir(out, { recursive: true })

const harness = await startHarness()

const browser = await chromium.launch({ executablePath: await findChromium(), args: glArgs() })

const failed  = []

try {
  for (const slug of requested.length ? requested : known)
    try {
      await film(slug)
    }
    catch (error) {
      failed.push(slug)
      console.error(`${slug}: ${error.message.split('\n')[0]}`)
    }
}
finally {
  await browser.close()
  await harness.close()
}

if (failed.length) {
  console.error(`failed: ${failed.join(', ')}`)
  process.exit(1)
}

console.log(`-> ${path.relative(ROOT, out)}`)

/** <yyyymmdd><noon|eve>, on the machine's own clock. */
function stampOf (now) {
  const two = n => String(n).padStart(2, '0')
  const day = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}`
  return `${day}${now.getHours() < gifs.eveFromHour ? 'noon' : 'eve'}`
}

/** readPixels hands rows over bottom first; a GIF wants the top one first. */
function flipRows (rgba, width, height) {
  const row     = width * 4
  const flipped = Buffer.alloc(rgba.length)
  for (let y = 0; y < height; y++)
    rgba.copy(flipped, y * row, (height - 1 - y) * row, (height - y) * row)
  return flipped
}

/** One journey: a page of its own, so one journey's trouble cannot cost the rest. */
async function film (slug) {
  const page = await browser.newPage()
  try {
    await page.goto(`${harness.url}/journeys/${slug}?t=0&w=${gifs.width}&h=${gifs.height}&hud=0&debug=0`, { waitUntil: 'commit' })
    await page.waitForSelector('html[data-journey-ready="1"]', { state: 'attached', timeout: 300_000 })

    const onset = await page.evaluate(limit => window.__harnessOnset(limit), gifs.maxSeconds)
    const end   = onset + CONFIG.signal.rampSeconds + gifs.holdSeconds
    const count = Math.min(gifs.maxFrames, Math.max(2, Math.floor(end / gifs.everySeconds) + 1))

    const frames = []
    for (let i = 0; i < count; i++) {
      const shot = await page.evaluate(time => window.__harnessFrame(time), end * i / (count - 1))
      frames.push(flipRows(Buffer.from(shot.rgba, 'base64'), gifs.width, gifs.height))
    }

    // A shader that fails to compile still hands back frames: black ones.
    const errors = await page.evaluate(() => window.__harnessErrors ?? [])
    if (errors.length)
      throw new Error(errors[0])

    const gif = encodeGif({ width: gifs.width, height: gifs.height, frames, delayMs: gifs.frameMs, colours: gifs.colours })
    await writeFile(path.join(out, `${slug}.gif`), gif)
    console.log(`${slug}: ${count} frames to ${end.toFixed(0)} s, ${Math.round(gif.length / 1024)} KB`)
  }
  finally {
    await page.close()
  }
}
