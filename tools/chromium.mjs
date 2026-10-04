// Locating a local Chromium and picking GL flags, shared by the browser-driving tools.

import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'


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
export async function findChromium () {
  if (process.env.JOURNEY_CHROMIUM)
    return process.env.JOURNEY_CHROMIUM

  // macOS's cache, Linux's cache, and whatever PLAYWRIGHT_BROWSERS_PATH points
  // at (cloud containers pre-install there).
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(os.homedir(), 'Library/Caches/ms-playwright'),
    path.join(os.homedir(), '.cache/ms-playwright'),
  ].filter(root => root && existsSync(root))

  const candidates = []
  for (const root of roots)
    for (const dir of await readdir(root)) {
      const rev = (/^chromium(?:_headless_shell)?-(\d+)$/).exec(dir)
      if (!rev)
        continue
      for (const exe of [
        'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        'chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        'chrome-linux64/chrome',
        'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
        'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium',
        'chrome-linux/chrome',
        'chrome-headless-shell-mac-arm64/chrome-headless-shell',
        'chrome-headless-shell-mac/chrome-headless-shell',
        'chrome-linux/headless_shell',
      ]) {
        const full = path.join(root, dir, exe)
        if (existsSync(full))
          // Prefer full Chromium over the headless shell: the shell has no GPU
          // process, and these pages are nothing but GPU.
          candidates.push({ rev: Number(rev[1]), full, shell: exe.includes('headless') })
      }
    }
  candidates.sort((a, b) => a.shell - b.shell || b.rev - a.rev)
  return candidates[0]?.full
}

/**
 * GL backend flags. A Mac has a GPU and ANGLE-on-Metal is what a user sees; a
 * Linux box running this is almost always a headless container with no GPU at
 * all, where the only WebGL2 there is comes from SwiftShader — slow, but exact
 * and deterministic, which is all a plate comparison needs. JOURNEY_GL=gpu|swiftshader
 * overrides the guess.
 */
export function glArgs () {
  const mode = process.env.JOURNEY_GL ?? (process.platform === 'linux' ? 'swiftshader' : 'gpu')
  return mode === 'swiftshader'
    ? [ '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist' ]
    : [ '--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist' ]
}
