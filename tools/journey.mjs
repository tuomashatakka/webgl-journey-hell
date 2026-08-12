// Drive a journey from the command line, deterministically.
//
// Every subcommand here is built on the ?t= seek (see lib/debugParams): the
// journey replays its simulation to an exact instant and holds there, so a shot
// taken now and the same shot taken next week are the same pixels. Nothing in
// this file sleeps waiting for a journey to reach a section — it asks for the
// moment it wants.
//
//   bun run dev                      # in another shell
//   node tools/journey.mjs <cmd> …
//
//   shot   natatorium --t=30 --out=/tmp/a.png
//   film   natatorium --from=26 --to=34 --step=0.5 --out=/tmp/film
//   probe  natatorium --from=0 --to=60 --step=2 [--json]
//   scan   natatorium --from=0 --to=60 --step=0.25 [--top=15]
//   uv     natatorium --t=30
//
// `scan` is the one worth knowing about. It walks time in small increments and
// measures how much the image changed between neighbouring frames. A journey is
// continuous, so that delta should be small and smooth; a spike means something
// popped — a material switching, a block vanishing, a light changing frame — and
// the timestamp it prints is exactly where to point `shot` next.
//
// `uv` samples texture-space statistics rather than pixels: it is for the class
// of bug where the image is *stable* but wrong, e.g. tiles stretched into
// streaks because a surface picked the wrong projection axis.

import { chromium } from 'playwright-core'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const BASE = process.env.JOURNEY_BASE_URL ?? 'http://localhost:3000/webgl-journey-hell'

// Small by default: these are measurements, not portfolio shots, and a 320x200
// buffer resolves a popping wall just as well as a 4K one while running ~40x
// faster. Override with --w/--h when the eye is the instrument.
const DEF_W = 320
const DEF_H = 200

function parseArgs (argv) {
  const [ cmd, journey, ...rest ] = argv
  const opts = {}
  for (const a of rest) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a)
    if (m)
      opts[m[1]] = m[2] === undefined ? true : m[2]
  }
  return { cmd, journey, opts }
}

const num = (v, d) => (v === undefined ? d : Number(v))

function url (journey, t, opts, extra = {}) {
  const q = new URLSearchParams({
    t:     String(t),
    w:     String(num(opts.w, DEF_W)),
    h:     String(num(opts.h, DEF_H)),
    hud:   opts.hud ? '1' : '0',
    debug: '0',
    ...extra,
  })
  if (opts.dt)
    q.set('dt', String(opts.dt))
  if (opts.pointer)
    q.set('pointer', String(opts.pointer))
  return `${BASE}/journeys/${journey}?${q}`
}

/**
 * Seek to `t` and wait for the frame to actually be on the canvas.
 *
 * The wait is on data-journey-ready, which the page sets only after draw() has
 * returned for the seeked frame — so this cannot race, and it does not need a
 * timeout guess. That attribute existing is the whole reason this file can be
 * short.
 */
async function seek (page, journey, t, opts, extra) {
  await page.goto(url(journey, t, opts, extra), { waitUntil: 'commit' })
  await page.waitForSelector('html[data-journey-ready="1"]', { timeout: 30_000 })
  return page.evaluate(() => window.__journeyDebug)
}

// NOTE: these run in the page, so they are passed to evaluate() as real
// functions and serialised by Playwright. Passing them as strings looks
// equivalent and is not — a string is evaluated as an *expression*, which
// yields the function without calling it, and evaluate() then tries to send a
// function back across the bridge and quietly resolves undefined.

/** Mean luminance, clipping counts, and a small plate for frame comparison. */
function statsFn () {
  const c = document.querySelector('canvas')
  const gl = c.getContext('webgl')
  const w = c.width, h = c.height
  const px = new Uint8Array(w * h * 4)
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px)
  let sum = 0, dark = 0, blown = 0, rSum = 0, gSum = 0, bSum = 0
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2]
    rSum += r; gSum += g; bSum += b
    const l = (r + g + b) / 3
    sum += l
    if (l < 4) dark++
    if (l > 250) blown++
  }
  const n = w * h
  return {
    mean:  sum / n,
    r:     rSum / n,
    g:     gSum / n,
    b:     bSum / n,
    dark:  dark / n,
    blown: blown / n,
    // Base64 of a downsampled grey plate, for frame-to-frame comparison. Full
    // resolution would be accurate and far too slow to ship between processes.
    plate: (() => {
      const S = 48
      const out = new Uint8Array(S * S)
      for (let y = 0; y < S; y++)
        for (let x = 0; x < S; x++) {
          const sx = Math.floor(x * w / S), sy = Math.floor(y * h / S)
          const i = (sy * w + sx) * 4
          out[y * S + x] = (px[i] + px[i + 1] + px[i + 2]) / 3
        }
      return Array.from(out)
    })(),
  }
}

/**
 * Find any cached Playwright Chromium, rather than the exact build this
 * playwright-core pins.
 *
 * playwright-core bumps its expected browser revision on almost every release,
 * and the machine usually already has a perfectly good Chromium from some other
 * tool. Demanding an exact match means a multi-hundred-megabyte download to run
 * a script that takes screenshots. Any recent build renders these shaders
 * identically, so take what is here and only fall back to the pinned one.
 */
async function findChromium () {
  if (process.env.JOURNEY_CHROMIUM)
    return process.env.JOURNEY_CHROMIUM

  const root = path.join(os.homedir(), 'Library/Caches/ms-playwright')
  if (!existsSync(root))
    return undefined

  const candidates = []
  for (const dir of await readdir(root)) {
    const rev = /^chromium(?:_headless_shell)?-(\d+)$/.exec(dir)
    if (!rev)
      continue
    for (const exe of [
      'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
      'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium',
      'chrome-headless-shell-mac-arm64/chrome-headless-shell',
      'chrome-headless-shell-mac/chrome-headless-shell',
    ]) {
      const full = path.join(root, dir, exe)
      if (existsSync(full))
        // Prefer full Chromium over the headless shell: the shell has no GPU
        // process, and these pages are nothing but GPU.
        candidates.push({ rev: Number(rev[1]), full, shell: exe.includes('headless-shell') })
    }
  }
  candidates.sort((a, b) => (a.shell - b.shell) || (b.rev - a.rev))
  return candidates[0]?.full
}

async function withBrowser (fn) {
  const browser = await chromium.launch({
    executablePath: await findChromium(),
    // The journeys are WebGL; a software rasteriser would still render but the
    // colours differ enough from a real GPU to make plate comparisons useless.
    args: [ '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist' ],
  })
  try {
    const page = await browser.newPage()
    page.on('pageerror', e => console.error('  [pageerror]', e.message))
    page.on('console', m => {
      if (m.type() === 'error')
        console.error('  [console]', m.text().slice(0, 300))
    })
    return await fn(page)
  }
  finally {
    await browser.close()
  }
}

// --- commands --------------------------------------------------------------

async function cmdShot (page, journey, opts) {
  const t   = num(opts.t, 0)
  const dbg = await seek(page, journey, t, opts)
  const out = opts.out ?? `/tmp/${journey}-${t}.png`
  await mkdir(path.dirname(out), { recursive: true })
  await page.locator('canvas').screenshot({ path: out })
  console.log(`t=${t}  ${dbg.label}  ${dbg.width}x${dbg.height}  -> ${out}`)
}

async function cmdFilm (page, journey, opts) {
  const from = num(opts.from, 0)
  const to   = num(opts.to, from + 10)
  const step = num(opts.step, 1)
  const dir  = opts.out ?? `/tmp/${journey}-film`
  await mkdir(dir, { recursive: true })

  for (let t = from; t <= to + 1e-9; t += step) {
    const dbg  = await seek(page, journey, t, opts)
    const name = `${String(t.toFixed(2)).padStart(8, '0')}.png`
    await page.locator('canvas').screenshot({ path: path.join(dir, name) })
    console.log(`  t=${t.toFixed(2)}  ${dbg.label}`)
  }
  console.log(`-> ${dir}`)
}

async function cmdProbe (page, journey, opts) {
  const from = num(opts.from, 0)
  const to   = num(opts.to, 60)
  const step = num(opts.step, 2)
  const rows = []

  for (let t = from; t <= to + 1e-9; t += step) {
    const dbg  = await seek(page, journey, t, opts)
    const st   = await page.evaluate(statsFn)
    rows.push({ t: +t.toFixed(2), label: dbg.label, mean: +st.mean.toFixed(1),
      dark: +st.dark.toFixed(3), blown: +st.blown.toFixed(4), uniforms: dbg.uniforms })
  }

  if (opts.json) {
    console.log(JSON.stringify(rows, null, 2))
    return
  }
  console.log('    t  label                    mean   dark  blown')
  for (const r of rows)
    console.log(`${String(r.t).padStart(5)}  ${r.label.padEnd(22)} ${String(r.mean).padStart(6)} ` +
                `${String(r.dark).padStart(6)} ${String(r.blown).padStart(6)}`)
}

/**
 * Walk time finely and report where the image jumps.
 *
 * The delta is mean absolute difference between successive downsampled plates,
 * normalised by the step so that it reads as "change per second" and can be
 * compared across different --step values. Camera motion produces a broad,
 * roughly constant baseline; a discontinuity produces a spike several times it.
 */
async function cmdScan (page, journey, opts) {
  const from = num(opts.from, 0)
  const to   = num(opts.to, 60)
  const step = num(opts.step, 0.25)
  const top  = num(opts.top, 15)

  const samples = []
  let prev = null

  for (let t = from; t <= to + 1e-9; t += step) {
    const dbg = await seek(page, journey, t, opts)
    const st  = await page.evaluate(statsFn)

    let delta = 0
    if (prev) {
      let acc = 0
      for (let i = 0; i < st.plate.length; i++)
        acc += Math.abs(st.plate[i] - prev[i])
      delta = acc / st.plate.length / step
    }
    samples.push({ t: +t.toFixed(3), label: dbg.label, delta: +delta.toFixed(2), mean: +st.mean.toFixed(1) })
    prev = st.plate
  }

  const deltas = samples.slice(1).map(s => s.delta).sort((a, b) => a - b)
  const median = deltas[Math.floor(deltas.length / 2)] || 0

  console.log(`baseline (median) delta/s: ${median.toFixed(2)}`)
  console.log(`\nworst ${top} discontinuities:`)
  console.log('       t  label                   delta/s  xBaseline')
  for (const s of [ ...samples.slice(1) ].sort((a, b) => b.delta - a.delta).slice(0, top))
    console.log(`${String(s.t).padStart(8)}  ${s.label.padEnd(22)} ${String(s.delta).padStart(8)}` +
                `  ${(s.delta / (median || 1)).toFixed(1)}x`)

  if (opts.json)
    await writeFile(opts.json === true ? '/tmp/scan.json' : opts.json,
      JSON.stringify(samples, null, 2))
}

/**
 * Texture-space sanity, for when the image is stable but looks wrong.
 *
 * Reports local contrast in narrow horizontal and vertical bands. Tile is a grid
 * of roughly square cells, so a healthy surface has comparable detail on both
 * axes; a surface projected onto the wrong plane smears into stripes and one of
 * the two collapses. The ratio is the tell, not either number alone.
 */
function uvFn () {
  const c = document.querySelector('canvas')
  const gl = c.getContext('webgl')
  const w = c.width, h = c.height
  const px = new Uint8Array(w * h * 4)
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px)
  const L = (x, y) => { const i = (y * w + x) * 4; return (px[i] + px[i+1] + px[i+2]) / 3 }
  let hAcc = 0, vAcc = 0, n = 0
  for (let y = 2; y < h - 2; y += 2)
    for (let x = 2; x < w - 2; x += 2) {
      hAcc += Math.abs(L(x + 1, y) - L(x - 1, y))
      vAcc += Math.abs(L(x, y + 1) - L(x, y - 1))
      n++
    }
  return { hDetail: hAcc / n, vDetail: vAcc / n, ratio: (hAcc / n) / Math.max(vAcc / n, 1e-6) }
}

async function cmdUv (page, journey, opts) {
  const t   = num(opts.t, 0)
  const dbg = await seek(page, journey, t, opts)
  const uv  = await page.evaluate(uvFn)
  console.log(`t=${t}  ${dbg.label}`)
  console.log(`  horizontal detail ${uv.hDetail.toFixed(2)}`)
  console.log(`  vertical detail   ${uv.vDetail.toFixed(2)}`)
  console.log(`  h/v ratio         ${uv.ratio.toFixed(2)}   (far from 1.0 = smeared on one axis)`)
}

const COMMANDS = { shot: cmdShot, film: cmdFilm, probe: cmdProbe, scan: cmdScan, uv: cmdUv }

const { cmd, journey, opts } = parseArgs(process.argv.slice(2))
if (!COMMANDS[cmd] || !journey) {
  console.error('usage: node tools/journey.mjs <shot|film|probe|scan|uv> <journey> [--opts]')
  process.exit(1)
}
await withBrowser(page => COMMANDS[cmd](page, journey, opts))
