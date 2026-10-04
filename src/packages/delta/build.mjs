// Δ — rebuild the asset files from ambientCG.
//
//   bun delta/build.mjs              # download (cached) and rebuild everything
//   bun delta/build.mjs --size=256   # smaller material strips, for a quick test
//
// Needs `unzip` and ImageMagick (`convert`). Run with bun: it imports the table
// straight from manifest.ts, so the files, the GLSL defines and the asset page
// are all built from one list.
//
// Outputs, all committed:
//
//   materials/color.jpg   Color                                    one layer per 512 rows
//   materials/normal.jpg  NormalGL.r, NormalGL.g, Roughness
//   materials/detail.jpg  Displacement, AmbientOcclusion, Metalness
//   skies/<asset>.jpg     the HDRI's tonemapped equirectangular, 2048x1024
//   urls.ts               generated static imports for all of the above
//
// The JPEGs are written with 4:4:4 chroma. 4:2:0 averages red and green over
// 2x2 blocks, and in a strip where red and green are *different data* (a normal's
// two axes, or displacement next to AO) that mixing is not a softening, it is
// one map bleeding into another along every edge.

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MATERIALS, MATERIAL_SIZE, SKIES, SKY_WIDTH } from './manifest'


const HERE  = path.dirname(fileURLToPath(import.meta.url))
const CACHE = process.env.TEXTURE_CACHE ?? path.join(os.tmpdir(), 'ambientcg-cache')
const size  = Number((/--size=(\d+)/).exec(process.argv.join(' '))?.[1] ?? MATERIAL_SIZE)

const run = (cmd, args) => execFileSync(cmd, args, { stdio: [ 'ignore', 'pipe', 'inherit' ]})

async function fetchZip (asset, variant, test) {
  const dir = path.join(CACHE, `${asset}_${variant}`)
  if (existsSync(dir) && (await readdir(dir)).some(f => test.test(f)))
    return dir

  await mkdir(dir, { recursive: true })

  const zip = path.join(dir, `${asset}.zip`)
  // /get answers with a redirect to the CDN; fetch follows it.
  const res = await fetch(`https://ambientcg.com/get?file=${asset}_${variant}.zip`)
  if (!res.ok)
    throw new Error(`${asset}: HTTP ${res.status}`)
  await writeFile(zip, Buffer.from(await res.arrayBuffer()))
  run('unzip', [ '-o', '-q', zip, '-d', dir ])
  return dir
}

async function mapOf (dir, suffix) {
  const hit = (await readdir(dir)).find(f => f.toLowerCase().endsWith(`_${suffix.toLowerCase()}.jpg`))
  return hit ? path.join(dir, hit) : null
}

const jpeg = [ '-sampling-factor', '4:4:4', '-strip', '-interlace', 'none' ]

// --- materials -------------------------------------------------------------

const work = path.join(CACHE, `_delta-${size}`)
await mkdir(work, { recursive: true })
await mkdir(path.join(HERE, 'materials'), { recursive: true })

const strips = { color: [], normal: [], detail: []}
for (const [ i, m ] of MATERIALS.entries()) {
  const dir   = await fetchZip(m.asset, '1K-JPG', /Color\.jpg$/i)
  const color = await mapOf(dir, 'Color')
  const nrm   = await mapOf(dir, 'NormalGL')
  const rough = await mapOf(dir, 'Roughness')
  const disp  = await mapOf(dir, 'Displacement')
  const ao    = await mapOf(dir, 'AmbientOcclusion')
  const metal = await mapOf(dir, 'Metalness')
  if (!color || !nrm || !rough)
    throw new Error(`${m.asset}: missing Color/NormalGL/Roughness`)

  const geo  = `${size}x${size}!`
  const grey = (file, fallback) => file
    ? [ '(', file, '-resize', geo, '-colorspace', 'Gray', ')' ]
    : [ '(', '-size', `${size}x${size}`, `xc:${fallback}`, '-colorspace', 'Gray', ')' ]
  // `-channel` is a *setting* in ImageMagick 6 and outlives its parentheses, so
  // it is reset with +channel each time, or -combine writes one channel only.
  const channel = (file, c) => [ '(', file, '-resize', geo, '-channel', c, '-separate', '+channel', ')' ]

  const out = { color: path.join(work, `${i}-c.png`), normal: path.join(work, `${i}-n.png`), detail: path.join(work, `${i}-d.png`) }
  run('convert', [ color, '-resize', geo, out.color ])
  run('convert', [
    ...channel(nrm, 'R'), ...channel(nrm, 'G'), ...grey(rough, 'gray50'),
    '+channel', '-set', 'colorspace', 'sRGB', '-combine', '-type', 'TrueColor', out.normal,
  ])
  run('convert', [
    ...grey(disp, 'gray50'), ...grey(ao, 'white'), ...grey(metal, 'black'),
    '+channel', '-set', 'colorspace', 'sRGB', '-combine', '-type', 'TrueColor', out.detail,
  ])
  for (const k of Object.keys(strips))
    strips[k].push(out[k])

  const missing = [ !disp && 'displacement', !ao && 'AO', !metal && 'metalness' ].filter(Boolean)
  console.log(`  ${String(i).padStart(2)}  ${m.id.padEnd(11)} ${m.asset.padEnd(20)} ${missing.length ? `(no ${missing.join(', ')})` : ''}`)
}

run('convert', [ ...strips.color, '-append', ...jpeg, '-quality', '84', path.join(HERE, 'materials/color.jpg') ])
// The other two strips are data, not pictures: a higher quality, no profile.
run('convert', [ ...strips.normal, '-append', ...jpeg, '-quality', '90', path.join(HERE, 'materials/normal.jpg') ])
run('convert', [ ...strips.detail, '-append', ...jpeg, '-quality', '90', path.join(HERE, 'materials/detail.jpg') ])

// --- skies -----------------------------------------------------------------

await mkdir(path.join(HERE, 'skies'), { recursive: true })
for (const sky of SKIES) {
  const dir = await fetchZip(sky.asset, '2K', /_TONEMAPPED\.jpg$/i)
  const src = (await readdir(dir)).find(f => (/_TONEMAPPED\.jpg$/i).test(f))
  if (!src)
    throw new Error(`${sky.asset}: no tonemapped JPEG in the 2K set`)
  run('convert', [
    path.join(dir, src), '-resize', `${SKY_WIDTH}x${SKY_WIDTH / 2}!`,
    ...jpeg, '-quality', '82', path.join(HERE, 'skies', `${sky.asset}.jpg`),
  ])
  console.log(`  sky ${sky.id.padEnd(9)} ${sky.asset}`)
}

// --- urls.ts ---------------------------------------------------------------

const ident = s => s.replace(/[^A-Za-z0-9]/g, '_')
const lines = [
  '// GENERATED by delta/build.mjs — do not edit.',
  '//',
  '// Static imports, so the bundler owns the URLs: Next emits each file under',
  '// _next/static/media with a content hash and the basePath already applied,',
  '// and bun\'s file loader does the same for the bare harness. An import',
  '// resolves to a string under bun and to StaticImageData under Next, which',
  '// is all `staticUrl` exists to paper over.',
  '',
  'import { staticUrl } from \'@wjh/web/assetUrl\'',
  'import colorStrip from \'./materials/color.jpg\'',
  'import normalStrip from \'./materials/normal.jpg\'',
  'import detailStrip from \'./materials/detail.jpg\'',
  ...SKIES.map(s => `import sky_${ident(s.asset)} from './skies/${s.asset}.jpg'`),
  '',
  'export const MATERIAL_URLS = {',
  '  color:  staticUrl(colorStrip),',
  '  normal: staticUrl(normalStrip),',
  '  detail: staticUrl(detailStrip),',
  '}',
  '',
  '/** Sky URL by ambientCG asset id. */',
  'export const SKY_URLS: Readonly<Record<string, string>> = {',
  ...SKIES.map(s => `  ${s.asset}: staticUrl(sky_${ident(s.asset)}),`),
  '}',
  '',
]
await writeFile(path.join(HERE, 'urls.ts'), lines.join('\n'))
console.log('-> delta/{materials,skies}/*.jpg, delta/urls.ts')
