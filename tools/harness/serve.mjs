// Serve the bare harness (tools/harness/entry.ts) for tools/journey.mjs.
//
//   node tools/harness/serve.mjs [--port=4173]   # standalone, for a browser
//   node tools/journey.mjs <cmd> <journey> --bare …   # started in-process
//
// The bundle is rebuilt on every request for it, which takes a few hundred
// milliseconds and means an edit to a shader is picked up by the next shot with
// nothing to restart. Static files come straight out of public/, at the root,
// because the harness bundle is built with an empty basePath.

import { execFile } from 'node:child_process'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'


const run   = promisify(execFile)
const ROOT  = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const ENTRY = path.join(ROOT, 'tools/harness/entry.ts')

const TYPES = {
  '.html': 'text/html',
  '.js':   'text/javascript',
  '.jpg':  'image/jpeg',
  '.png':  'image/png',
  '.json': 'application/json',
  '.css':  'text/css',
}

// The empty icon stops the browser's own favicon request from 404ing, which
// `journey.mjs glsl` would otherwise count as an error.
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,">
<style>html,body{margin:0;background:#000}canvas{display:block}</style></head>
<body><script type="module" src="/__harness/entry.js"></script></body></html>`

async function bundle (outdir) {
  // bun resolves the tsconfig aliases (✦, Δ) on its own. process.env is not a
  // thing in a browser bundle, so the variables the app reads are defined here.
  // Images imported by Δ go through the file loader: copied into outdir with a
  // content hash, the import evaluating to their URL under /__harness/.
  await run('bun', [
    'build', ENTRY, '--target=browser', '--format=esm', `--outdir=${outdir}`,
    '--public-path=/__harness/', '--loader=.jpg:file', '--loader=.png:file',
    '--define', 'process.env.NEXT_PUBLIC_BASE_PATH=""',
    '--define', 'process.env.NODE_ENV="development"',
  ], { cwd: ROOT, maxBuffer: 1 << 24 })
}

export async function startHarness ({ port = 0, quiet = true } = {}) {
  const outdir = await mkdtemp(path.join(os.tmpdir(), 'journey-harness-'))
  // Fail fast on a build error, before any browser is launched at it.
  await bundle(outdir)

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x')
      if (url.pathname.startsWith('/__harness/')) {
        // The page's own script request is the rebuild trigger, so an edited
        // shader is in the very next shot with nothing restarted.
        if (url.pathname === '/__harness/entry.js')
          await bundle(outdir)

        const file = path.join(outdir, path.basename(url.pathname))
        if (!existsSync(file))
          return res.writeHead(404).end()
        res.writeHead(200, { 'content-type':  TYPES[path.extname(file)] ?? 'application/octet-stream',
          'cache-control': 'no-store' })
        createReadStream(file).pipe(res)
        return
      }
      if (url.pathname.startsWith('/journeys/') && !path.extname(url.pathname)) {
        res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-store' })
        res.end(PAGE)
        return
      }

      const file = path.join(ROOT, 'public', path.normalize(decodeURIComponent(url.pathname)))
      if (file.startsWith(path.join(ROOT, 'public')) && existsSync(file) && statSync(file).isFile()) {
        res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
        createReadStream(file).pipe(res)
        return
      }
      res.writeHead(404).end()
    }
    catch (err) {
      if (!quiet)
        console.error(err)
      res.writeHead(500, { 'content-type': 'text/plain' }).end(String(err?.stderr ?? err))
    }
  })

  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve))

  const { port: actual } = server.address()
  return {
    url:   `http://127.0.0.1:${actual}`,
    close: () => new Promise(resolve => server.close(resolve)),
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number((/--port=(\d+)/).exec(process.argv.join(' '))?.[1] ?? 4173)
  const h    = await startHarness({ port, quiet: false })
  console.log(`harness at ${h.url}/journeys/<slug>?t=12&w=640&h=360`)
}
