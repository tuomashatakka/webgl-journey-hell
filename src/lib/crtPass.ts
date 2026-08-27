// The one post-process every journey shares: barrel curvature, chromatic
// offset, aperture mask, vignette — and the VHS scrub treatment the transport
// controls play over the top of it.
//
// The reason this is 200 lines and not a re-plumbing of eight renderers: every
// journey already finishes its frame on the *default* framebuffer. A
// conventional post chain would have to hand each renderer a target to draw
// into instead, which means touching shaderQuad, the geometry path, and both
// hand-rolled two-pass routes. So this pass reads what is already there —
// copyTexSubImage2D pulls the back buffer into a texture mid-frame — and then
// draws over it. Nothing upstream knows this exists.
//
//   renderer.draw(...)            // unchanged, presents to the back buffer
//   copyTexSubImage2D(...)        // back buffer -> our texture
//   crt.draw({ ... })             // fullscreen quad, samples it, writes back
//
// GLSL ES 1.00 throughout, because the shell hands out both `webgl` and
// `webgl2` contexts (withJourneyShell's `contextType`) and 1.00 compiles under
// either.

const CRT_VS = `
  attribute vec2 position;
  varying vec2 vUv;
  void main () {
    vUv = position * 0.5 + 0.5;
    gl_Position = vec4(position, 0.0, 1.0);
  }
`

const CRT_FS = `
  precision highp float;

  uniform sampler2D uTex;
  uniform vec2  uRes;
  uniform float uTime;
  uniform float uCurve;
  uniform float uAberration;
  uniform float uScanline;
  uniform float uVignette;

  /** -1 rewinding, +1 fast-forwarding, 0 idle. Signs the tape motion. */
  uniform float uScrub;

  /** 0..1 — how much of the scrub treatment is mixed in. */
  uniform float uScrubMix;

  /** The reception failing. x: 0..1 level, y: 1 when an overlay is bound. */
  uniform vec2 uSignal;

  /** The signal-loss caption, drawn on the CPU (lib/signalOverlay). Unit 1. */
  uniform sampler2D uOverlay;

  varying vec2 vUv;

  float hash (vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  /**
   * The clock, quantised and wrapped, for anything that hashes on time.
   *
   * hash() takes sin() of a dot product, and a journey here can run for an hour.
   * Feed that clock in unwrapped and the argument runs past what a highp float
   * can carry, at which point sin() stops varying with it: the "noise" freezes
   * into a constant. A constant offset does not read as noise — it reads as the
   * picture being subtracted, and at signal-loss amplitudes it subtracts all of
   * it. Wrapping every 512 ticks is far longer than anyone will notice a repeat
   * over and short enough that the hash stays honest.
   */
  float tickAt (float rate) {
    return floor(fract(uTime * rate / 512.0) * 512.0);
  }

  void main () {
    vec2 c = vUv * 2.0 - 1.0;

    // Barrel distortion. Squaring the radius keeps the centre of the picture
    // untouched and pushes the corners outward, which is the shape a real tube
    // has — a linear term would bow the middle too.
    c *= 1.0 + dot(c, c) * uCurve;

    float mix_ = uScrubMix;

    // --- tape transport ---------------------------------------------------
    // Everything below is inert at mix_ = 0, so the idle path pays for a few
    // multiplies rather than a branch.
    float roll = 0.0;
    float tear = 0.0;
    if (mix_ > 0.001) {
      // The head-switching band: one bright, torn strip crawling up or down
      // the frame depending on which way the tape is moving.
      float bandPos = fract(uTime * 0.9 * -uScrub);
      float band    = smoothstep(0.10, 0.0, abs(vUv.y - bandPos));

      // Per-scanline horizontal displacement, hash-gated so only some lines
      // tear — a uniform shift reads as a pan, not as damage.
      float line = floor(vUv.y * 120.0 + tickAt(90.0) * uScrub);
      float gate = step(0.62, hash(vec2(line, 3.0)));
      tear  = (hash(vec2(line, 11.0)) - 0.5) * gate * 0.09 * mix_;
      tear += band * (hash(vec2(line, 27.0)) - 0.5) * 0.16 * mix_;

      // Vertical roll — the picture never quite locks while it is moving.
      roll = (sin(uTime * 5.3) * 0.008 + band * 0.05) * mix_;
    }

    // --- the signal going -------------------------------------------------
    // Deliberately a different vocabulary from the tape above. That is a
    // transport *action* — something is being done to the picture on purpose,
    // and it travels in the direction of the shuttle. This is reception: nothing
    // is moving, there is simply less and less arriving.
    float sig = uSignal.x;
    if (sig > 0.001) {
      // Sync tearing. Finer lines than the tape's and hash-gated per frame
      // rather than per position, so lines drop out at random instead of
      // crawling — a weak signal loses individual lines, it does not shuttle.
      float sline = floor(vUv.y * 190.0);
      float sgate = step(0.90 - sig * 0.44, hash(vec2(sline, tickAt(24.0))));
      tear += (hash(vec2(sline, 61.0)) - 0.5) * sgate * (0.02 + sig * 0.11);

      // Vertical hold: a slow slip, and every so often it lets go of a whole
      // frame. The occasional total loss of lock is what says "weak" rather
      // than "noisy" — a picture that only ever wobbles reads as an effect.
      float slipT = tickAt(2.0);
      float slip  = step(0.88 - sig * 0.30, hash(vec2(slipT, 5.0)));
      roll += sig * 0.010 * sin(uTime * 1.7)
        + slip * sig * hash(vec2(slipT, 9.0)) * 0.7;
    }

    vec2 uv = c * 0.5 + 0.5;
    uv.x   += tear;
    uv.y    = fract(uv.y + roll);

    // Out-of-bounds after curvature is the bezel, not clamped edge pixels.
    vec2 edge = step(vec2(0.0), uv) * step(uv, vec2(1.0));
    float inside = edge.x * edge.y;

    // --- chromatic offset -------------------------------------------------
    // Radial rather than fixed: a lens separates wavelengths more the further
    // from the axis you look, so the fringe belongs in the corners.
    float ab = uAberration * (1.0 + mix_ * 3.0);
    vec2  dir = c * (dot(c, c) + 0.05) * ab;

    vec3 col = vec3(
      texture2D(uTex, uv + dir).r,
      texture2D(uTex, uv).g,
      texture2D(uTex, uv - dir).b
    );

    if (sig > 0.001) {
      // Multipath: a second, later, weaker copy of the picture offset to the
      // right. Taken as a max rather than a sum so the ghost sits *behind* the
      // image instead of doubling its brightness.
      vec2 gh = vec2(0.006 + sig * 0.022, 0.0);
      vec3 ghost = vec3(
        texture2D(uTex, uv + gh + dir).r,
        texture2D(uTex, uv + gh).g,
        texture2D(uTex, uv + gh - dir).b
      );
      col = mix(col, max(col, ghost * 0.82), sig * 0.55);

      // Chroma first, then level. The colour burst is the first thing a weak
      // signal loses, which is why a failing picture goes grey before it goes
      // dark rather than the other way round.
      float luma = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(luma), sig * 0.78);
      col *= 1.0 - sig * 0.46;
    }

    // The caption, sampled at the same warped uv and through the same chromatic
    // offset as the picture — that is the whole reason it is composited here and
    // not in DOM. It goes in *after* the level collapse above, because a warning
    // is generated at the receiver rather than transmitted: the tube distorts it,
    // the failing signal does not dim it, and it stays readable at the floor.
    if (uSignal.y > 0.5) {
      // Curved and fringed exactly like the picture, but taking only a third of
      // the tearing and none of the lost lock. At full amplitude the words stop
      // being words, which loses the one thing an overlay is for — and a warning
      // caption is generated at the receiver, so it has no reason to carry the
      // transmission's every fault.
      vec2 ouv = c * 0.5 + 0.5;
      ouv.x += tear * 0.22;
      ouv.y  = fract(ouv.y + roll * 0.30);

      vec4 og = texture2D(uOverlay, ouv);
      vec3 oc = vec3(
        texture2D(uOverlay, ouv + dir).r,
        og.g,
        texture2D(uOverlay, ouv - dir).b
      );
      col = mix(col, oc, og.a);
    }

    // --- tape damage ------------------------------------------------------
    if (mix_ > 0.001) {
      float bandPos = fract(uTime * 0.9 * -uScrub);
      float band    = smoothstep(0.10, 0.0, abs(uv.y - bandPos));

      // Luminance crush toward monochrome: a VHS in shuttle has no colour
      // burst to lock onto, so the chroma is the first thing to go.
      float luma = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(luma), mix_ * 0.55);
      col = mix(col, vec3(luma * 1.35 + 0.06), band * mix_);

      // Dropout speckle, dense inside the head-switching band.
      float snow = hash(vUv * uRes * 0.5 + tickAt(60.0));
      col += (snow - 0.5) * (0.10 + band * 0.55) * mix_;
    }

    if (sig > 0.001) {
      // Snow. Last, so it lands on the caption too — it is in front of the
      // picture, not behind it.
      //
      // Scaled by local brightness rather than added flat. Several of these
      // journeys end somewhere very dark, and a flat offset on a picture whose
      // mean is a few percent does not sit *on* the image, it replaces it: the
      // switchback's shaft went to pure static with the journey still running
      // underneath. A small floor keeps the black areas from being clean.
      float lum  = dot(col, vec3(0.299, 0.587, 0.114));
      float snow = hash(vUv * uRes * 0.7 + tickAt(30.0) * 13.0);
      col += (snow - 0.5) * sig * (0.045 + lum * 0.85);
    }

    // --- tube treatment ---------------------------------------------------
    float scan = 1.0 - uScanline * (0.5 + 0.5 * sin(uv.y * uRes.y * 3.14159));
    col *= scan;

    // Aperture grille: a soft three-phase stripe across x. Kept shallow —
    // at full strength it eats a third of the brightness.
    float slot = 0.94 + 0.06 * sin(vUv.x * uRes.x * 2.0943951);
    col *= mix(1.0, slot, uScanline * 3.0);

    float v = 1.0 - dot(c, c) * uVignette;
    col *= clamp(v, 0.0, 1.0);

    gl_FragColor = vec4(col * inside, 1.0);
  }
`

const QUAD_VERTS = new Float32Array([ -1, -1, 1, -1, -1, 1, 1, 1 ])

export interface CrtDrawOptions {
  time:       number;
  curve:      number;
  aberration: number;
  scanline:   number;
  vignette:   number;

  /** -1 rewind, 0 idle, +1 fast-forward. */
  scrub:    number;
  scrubMix: number;

  /** 0..1 how far the reception has failed. See lib/signalLoss. */
  signal: number;
}

export interface CrtPass {

  /** Re-allocate the capture texture. Call whenever the backing store resizes. */
  resize(w: number, h: number): void;

  /**
   * Upload the signal-loss caption, or clear it with null. The overlay only
   * redraws a few times a second (lib/signalOverlay), so callers should only
   * call this when it reports that it changed.
   */
  setOverlay(source: HTMLCanvasElement | null): void;

  /** Capture the current back buffer and composite the treatment over it. */
  draw(options: CrtDrawOptions): void;
  dispose(): void;
}

function compile (
  gl:     WebGLRenderingContext,
  type:   number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader)
    return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log    = gl.getShaderInfoLog(shader)
    const reason = gl.isContextLost()
      ? 'context lost — cannot compile'
      : log || 'no info log (context likely lost or unavailable)'
    console.error('[crtPass] compile error:', reason)
    gl.deleteShader(shader)
    return null
  }
  return shader
}

/**
 * Build the shared CRT pass for a context. Returns null if it cannot compile,
 * which callers should treat as "render without it" rather than as fatal — the
 * journey underneath is complete on its own.
 */
export function createCrtPass (gl: WebGLRenderingContext): CrtPass | null {
  const vs = compile(gl, gl.VERTEX_SHADER, CRT_VS)
  const fs = compile(gl, gl.FRAGMENT_SHADER, CRT_FS)
  if (!vs || !fs)
    return null

  const program = gl.createProgram()
  if (!program)
    return null
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('[crtPass] link error:', gl.getProgramInfoLog(program))
    gl.deleteProgram(program)
    return null
  }

  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, QUAD_VERTS, gl.STATIC_DRAW)

  // Two constraints meet here.
  //
  // NPOT: CLAMP_TO_EDGE + LINEAR + no mipmaps is the one NPOT configuration
  // WebGL 1 allows, and it is exactly what a screen copy wants anyway.
  //
  // RGB, not RGBA: the shell asks for `alpha: false` contexts, so the default
  // framebuffer has no alpha channel — and copyTexSubImage2D into a texture
  // whose format needs a component the read buffer does not have is an
  // INVALID_OPERATION. It fails silently, the texture stays black, and every
  // journey renders as an empty tube. Match the read buffer's format instead.
  const tex = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

  // The caption's texture. Uploaded from a 2D canvas rather than copied from the
  // framebuffer, so unlike the capture texture above it can be — and has to be —
  // RGBA: the alpha is what says where the caption is not.
  const overlayTex = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, overlayTex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  let hasOverlay = false

  const posLoc      = gl.getAttribLocation(program, 'position')
  const loc         = (name: string) => gl.getUniformLocation(program, name)
  const uTex        = loc('uTex')
  const uRes        = loc('uRes')
  const uTime       = loc('uTime')
  const uCurve      = loc('uCurve')
  const uAberration = loc('uAberration')
  const uScanline   = loc('uScanline')
  const uVignette   = loc('uVignette')
  const uScrub      = loc('uScrub')
  const uScrubMix   = loc('uScrubMix')
  const uSignal     = loc('uSignal')
  const uOverlay    = loc('uOverlay')

  let texW = 0
  let texH = 0

  const resize = (w: number, h: number) => {
    if (w === texW && h === texH || w <= 0 || h <= 0)
      return
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, w, h, 0, gl.RGB, gl.UNSIGNED_BYTE, null)
    texW = w
    texH = h
  }

  return {
    resize,

    setOverlay (source) {
      if (!source || source.width <= 0 || source.height <= 0) {
        hasOverlay = false
        return
      }

      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, overlayTex)

      // A canvas is top-down and a GL texture is bottom-up. The capture texture
      // above comes from copyTexSubImage2D and is already in GL's order, so the
      // flip has to happen here or the caption arrives upside down.
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
      gl.activeTexture(gl.TEXTURE0)
      hasOverlay = true
    },

    draw (o: CrtDrawOptions) {
      const canvas = gl.canvas as HTMLCanvasElement
      const w      = canvas.width
      const h      = canvas.height
      if (w <= 0 || h <= 0)
        return

      resize(w, h)

      // Grab the frame the journey just presented. This is the whole trick:
      // the back buffer is still intact until the compositor swaps it, so it
      // can be read now and written back to in the same pass.
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, w, h)

      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, w, h)
      gl.disable(gl.DEPTH_TEST)
      gl.disable(gl.BLEND)
      gl.disable(gl.CULL_FACE)

      gl.useProgram(program)
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.enableVertexAttribArray(posLoc)
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

      if (uTex)
        gl.uniform1i(uTex, 0)
      if (uRes)
        gl.uniform2f(uRes, w, h)
      if (uTime)
        gl.uniform1f(uTime, o.time)
      if (uCurve)
        gl.uniform1f(uCurve, o.curve)
      if (uAberration)
        gl.uniform1f(uAberration, o.aberration)
      if (uScanline)
        gl.uniform1f(uScanline, o.scanline)
      if (uVignette)
        gl.uniform1f(uVignette, o.vignette)
      if (uScrub)
        gl.uniform1f(uScrub, o.scrub)
      if (uScrubMix)
        gl.uniform1f(uScrubMix, o.scrubMix)

      const showOverlay = hasOverlay && o.signal > 0.001
      if (uSignal)
        gl.uniform2f(uSignal, o.signal, showOverlay ? 1 : 0)
      if (uOverlay)
        gl.uniform1i(uOverlay, 1)
      if (showOverlay) {
        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_2D, overlayTex)
        gl.activeTexture(gl.TEXTURE0)
      }

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

      // Hand the attribute back. The geometry path binds its own arrays each
      // frame, but leaving a stale enabled attrib pointing at our quad buffer
      // is the kind of thing that only breaks on one driver.
      gl.disableVertexAttribArray(posLoc)
    },

    dispose () {
      gl.deleteBuffer(buffer)
      gl.deleteTexture(tex)
      gl.deleteTexture(overlayTex)
      gl.deleteProgram(program)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
    },
  }
}

/** The idle look. Subtle by design — every journey already grades its own image. */
export const CRT_DEFAULTS = {
  curve:      0.055,
  aberration: 0.0022,
  scanline:   0.045,
  vignette:   0.22,
} as const

/**
 * The tube switched off, for when the CRT setting is off but the pass still has
 * to run. The signal loss is a story beat rather than a display treatment, so it
 * does not belong behind that toggle: curvature and scanlines go, the caption and
 * the tearing and the snow stay.
 */
export const CRT_BYPASS = {
  curve:      0,
  aberration: 0,
  scanline:   0,
  vignette:   0,
} as const
