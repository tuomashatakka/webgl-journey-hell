// Letter-spaced text on a 2D canvas, positioned by hand: ctx.letterSpacing is
// not available everywhere yet. Used by the signal-loss caption and the title
// card.

/** Width of `text` in the context's current font, `spacing` px between letters. */
export function spacedWidth (ctx: CanvasRenderingContext2D, text: string, spacing: number): number {
  const chars = [ ...text ]
  return chars.reduce((a, ch) => a + ctx.measureText(ch).width, 0) + spacing * Math.max(0, chars.length - 1)
}

/** Draw `text` centred on `cx`, `spacing` px between letters. */
export function spacedText (ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, spacing: number): void {
  const chars   = [ ...text ]
  const widths  = chars.map(ch => ctx.measureText(ch).width)
  const total   = widths.reduce((a, b) => a + b, 0) + spacing * Math.max(0, chars.length - 1)
  const align   = ctx.textAlign
  ctx.textAlign = 'left'

  let x = cx - total / 2
  chars.forEach((ch, i) => {
    ctx.fillText(ch, x, y)
    x += widths[i] + spacing
  })
  ctx.textAlign = align
}
