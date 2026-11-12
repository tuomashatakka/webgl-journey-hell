// A GIF89a encoder small enough to read: one palette for the whole film, no
// dithering, LZW. Used by tools/shoot-gifs.mjs.
//
// One global palette rather than one per frame, because these films are a
// single place seen from a moving cart: the colours of frame forty are the
// colours of frame one, and a palette each is 768 bytes a frame for nothing.
// No dithering, because a dither is noise and noise is exactly what LZW cannot
// compress: an undithered frame of a raymarch is long runs of one index.

/** Bits kept per channel when colours are counted: 32768 bins. */
const BITS = 5

const BINS = 1 << BITS * 3

function bin (r, g, b) {
  return r >> 8 - BITS << BITS * 2 | g >> 8 - BITS << BITS | b >> 8 - BITS
}

/**
 * Median cut over every frame's colours, counted in 15 bits.
 *
 * Returns the palette as RGB triples and a table from colour bin to palette
 * index, so mapping a pixel afterwards is one lookup.
 */
function buildPalette (frames, colours) {
  const count = new Uint32Array(BINS)
  for (const rgba of frames)
    for (let i = 0; i < rgba.length; i += 4)
      count[bin(rgba[i], rgba[i + 1], rgba[i + 2])]++

  const used = []
  for (let i = 0; i < BINS; i++)
    if (count[i])
      used.push(i)

  const channel = (i, c) => i >> BITS * (2 - c) & (1 << BITS) - 1
  const measure = members => {
    const lo = [ 255, 255, 255 ]
    const hi = [ 0, 0, 0 ]
    let total = 0
    for (const i of members) {
      total += count[i]
      for (let c = 0; c < 3; c++) {
        lo[c] = Math.min(lo[c], channel(i, c))
        hi[c] = Math.max(hi[c], channel(i, c))
      }
    }

    const range = hi.map((h, c) => h - lo[c])
    const axis  = range.indexOf(Math.max(...range))
    return { members, total, axis, spread: range[axis] }
  }

  // Split whichever box holds the most pixels across more than one colour,
  // along its longest axis, at the pixel that halves it.
  const boxes = [ measure(used) ]
  while (boxes.length < colours) {
    let pick = -1
    for (let i = 0; i < boxes.length; i++)
      if (boxes[i].spread > 0 && (pick < 0 || boxes[i].total > boxes[pick].total))
        pick = i
    if (pick < 0)
      break

    const box = boxes[pick]
    box.members.sort((a, b) => channel(a, box.axis) - channel(b, box.axis))

    let acc = 0
    let cut = 1
    for (let i = 0; i < box.members.length - 1; i++) {
      acc += count[box.members[i]]
      cut  = i + 1
      if (acc * 2 >= box.total)
        break
    }
    boxes.splice(pick, 1, measure(box.members.slice(0, cut)), measure(box.members.slice(cut)))
  }

  const palette = new Uint8Array(colours * 3)
  const lookup  = new Uint8Array(BINS)
  const up      = v => Math.round(v * 255 / ((1 << BITS) - 1))
  boxes.forEach((box, index) => {
    const sum = [ 0, 0, 0 ]
    for (const i of box.members) {
      for (let c = 0; c < 3; c++)
        sum[c] += channel(i, c) * count[i]
      lookup[i] = index
    }
    for (let c = 0; c < 3; c++)
      palette[index * 3 + c] = up(sum[c] / box.total)
  })
  return { palette, lookup }
}

/**
 * LZW, as GIF wants it: codes packed low bit first into blocks of at most 255
 * bytes. The width of a code grows one entry *after* the table would overflow
 * it, because the decoder builds its table one code behind the encoder.
 */
function lzw (indices, minCodeSize) {
  const clear = 1 << minCodeSize
  const eoi   = clear + 1
  const bytes = []
  let size  = minCodeSize + 1
  let next  = eoi + 1
  let acc   = 0
  let bits  = 0
  let table = new Map()

  const emit = code => {
    acc  |= code << bits
    bits += size
    while (bits >= 8) {
      bytes.push(acc & 255)
      acc >>>= 8
      bits -= 8
    }
  }

  emit(clear)

  let run = indices[0]
  for (let i = 1; i < indices.length; i++) {
    const k     = indices[i]
    const key   = run << 8 | k
    const known = table.get(key)
    if (known !== undefined) {
      run = known
      continue
    }

    emit(run)
    if (next === 4096) {
      emit(clear)
      table = new Map()
      next  = eoi + 1
      size  = minCodeSize + 1
    }
    else {
      if (next >= 1 << size)
        size++
      table.set(key, next++)
    }
    run = k
  }
  emit(run)
  emit(eoi)
  if (bits > 0)
    bytes.push(acc & 255)

  const blocks = []
  for (let i = 0; i < bytes.length; i += 255) {
    const block = bytes.slice(i, i + 255)
    blocks.push(block.length, ...block)
  }
  blocks.push(0)
  return blocks
}

/**
 * Encode RGBA frames (top row first, all the same size) as a looping GIF.
 *
 * `colours` must be a power of two, at most 256. `delayMs` is rounded to the
 * hundredths of a second the format counts in.
 */
export function encodeGif ({ width, height, frames, delayMs, colours }) {
  const depth = Math.log2(colours)
  if (!Number.isInteger(depth) || depth < 1 || depth > 8)
    throw new Error(`a GIF palette is a power of two up to 256, not ${colours}`)

  const { palette, lookup } = buildPalette(frames, colours)
  const word                = v => [ v & 255, v >> 8 & 255 ]
  const out                 = [
    ...Buffer.from('GIF89a'),
    ...word(width), ...word(height),
    0x80 | depth - 1 << 4 | depth - 1, 0, 0,
    ...palette,
    // Loop for ever.
    0x21, 0xff, 11, ...Buffer.from('NETSCAPE2.0'), 3, 1, 0, 0, 0,
  ]

  const delay = word(Math.max(2, Math.round(delayMs / 10)))
  const index = new Uint8Array(width * height)
  for (const rgba of frames) {
    for (let i = 0; i < index.length; i++)
      index[i] = lookup[bin(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2])]

    out.push(
      0x21, 0xf9, 4, 0, ...delay, 0, 0,
      0x2c, 0, 0, 0, 0, ...word(width), ...word(height), 0,
      Math.max(2, depth),
    )

    const blocks = lzw(index, Math.max(2, depth))
    for (let i = 0; i < blocks.length; i += 65536)
      out.push(...blocks.slice(i, i + 65536))
  }
  out.push(0x3b)
  return Buffer.from(out)
}
