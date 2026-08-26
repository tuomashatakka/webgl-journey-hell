import type { JourneyRenderer } from '@/components/withJourneyShell'
import type { CustomUniforms, QuadFrameUniforms } from '@/lib/shaderQuad'
import { fsPost, fsScene, vsQuad } from './shaders'


interface ProgramBundle {
  program:  WebGLProgram;
  vertex:   WebGLShader;
  fragment: WebGLShader;
  position: number;
  uniforms: Map<string, WebGLUniformLocation | null>;
}

const QUAD = new Float32Array([ -1, -1, 1, -1, -1, 1, 1, 1 ])

function compile (gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader)
    return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('[stairwell] shader compile error:', gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    return null
  }
  return shader
}

function createProgram (
  gl: WebGLRenderingContext,
  fragmentSource: string,
): ProgramBundle | null {
  const vertex   = compile(gl, gl.VERTEX_SHADER, vsQuad)
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource)
  if (!vertex || !fragment)
    return null

  const program = gl.createProgram()
  if (!program)
    return null
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('[stairwell] program link error:', gl.getProgramInfoLog(program))
    gl.deleteProgram(program)
    gl.deleteShader(vertex)
    gl.deleteShader(fragment)
    return null
  }

  return {
    program,
    vertex,
    fragment,
    position: gl.getAttribLocation(program, 'position'),
    uniforms: new Map(),
  }
}

function location (
  gl: WebGLRenderingContext,
  bundle: ProgramBundle,
  name: string,
): WebGLUniformLocation | null {
  if (bundle.uniforms.has(name))
    return bundle.uniforms.get(name) ?? null

  const loc = gl.getUniformLocation(bundle.program, name)
  bundle.uniforms.set(name, loc)
  return loc
}

function uploadFrame (
  gl: WebGLRenderingContext,
  bundle: ProgramBundle,
  canvas: HTMLCanvasElement,
  frame: QuadFrameUniforms,
): void {
  const res     = location(gl, bundle, 'iResolution')
  const time    = location(gl, bundle, 'iTime')
  const pointer = location(gl, bundle, 'uPointer')
  const heavy   = location(gl, bundle, 'uHeavy')
  if (res)
    gl.uniform2f(res, canvas.width, canvas.height)
  if (time)
    gl.uniform1f(time, frame.time)
  if (pointer)
    gl.uniform2f(pointer, frame.pointer?.x ?? 0, frame.pointer?.y ?? 0)
  if (heavy)
    gl.uniform1f(heavy, frame.heavy ?? 0)

  uploadCustom(gl, bundle, frame.custom)
}

function uploadCustom (
  gl: WebGLRenderingContext,
  bundle: ProgramBundle,
  custom: CustomUniforms | undefined,
): void {
  if (!custom)
    return
  for (const name in custom) {
    const value = custom[name]
    const loc   = location(gl, bundle, name)
    if (!loc || typeof value !== 'number')
      continue
    gl.uniform1f(loc, value)
  }
}

function disposeProgram (gl: WebGLRenderingContext, bundle: ProgramBundle): void {
  gl.deleteProgram(bundle.program)
  gl.deleteShader(bundle.vertex)
  gl.deleteShader(bundle.fragment)
}

export function createStairwellRenderer (
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
): JourneyRenderer | null {
  const context = gl as WebGLRenderingContext
  const scene   = createProgram(context, fsScene)
  const post    = createProgram(context, fsPost)
  if (!scene || !post) {
    if (scene)
      disposeProgram(context, scene)
    if (post)
      disposeProgram(context, post)
    return null
  }

  const buffer  = context.createBuffer()
  const target  = context.createFramebuffer()
  const texture = context.createTexture()
  if (!buffer || !target || !texture)
    return null

  context.bindBuffer(context.ARRAY_BUFFER, buffer)
  context.bufferData(context.ARRAY_BUFFER, QUAD, context.STATIC_DRAW)
  context.bindTexture(context.TEXTURE_2D, texture)
  context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.LINEAR)
  context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.LINEAR)
  context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE)
  context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE)

  let targetWidth  = 0
  let targetHeight = 0

  const bindQuad = (bundle: ProgramBundle) => {
    context.useProgram(bundle.program)
    context.bindBuffer(context.ARRAY_BUFFER, buffer)
    context.enableVertexAttribArray(bundle.position)
    context.vertexAttribPointer(bundle.position, 2, context.FLOAT, false, 0, 0)
  }

  const resizeTarget = () => {
    if (targetWidth === canvas.width && targetHeight === canvas.height)
      return
    targetWidth = canvas.width
    targetHeight = canvas.height
    context.bindTexture(context.TEXTURE_2D, texture)
    context.texImage2D(
      context.TEXTURE_2D,
      0,
      context.RGBA,
      targetWidth,
      targetHeight,
      0,
      context.RGBA,
      context.UNSIGNED_BYTE,
      null,
    )
    context.bindFramebuffer(context.FRAMEBUFFER, target)
    context.framebufferTexture2D(
      context.FRAMEBUFFER,
      context.COLOR_ATTACHMENT0,
      context.TEXTURE_2D,
      texture,
      0,
    )
    if (context.checkFramebufferStatus(context.FRAMEBUFFER) !== context.FRAMEBUFFER_COMPLETE)
      console.error('[stairwell] incomplete scene framebuffer')
  }

  return {
    draw (frame) {
      resizeTarget()
      context.disable(context.BLEND)
      context.bindFramebuffer(context.FRAMEBUFFER, target)
      context.viewport(0, 0, canvas.width, canvas.height)
      bindQuad(scene)
      uploadFrame(context, scene, canvas, frame)
      context.drawArrays(context.TRIANGLE_STRIP, 0, 4)

      context.bindFramebuffer(context.FRAMEBUFFER, null)
      context.viewport(0, 0, canvas.width, canvas.height)
      bindQuad(post)
      uploadFrame(context, post, canvas, frame)
      context.activeTexture(context.TEXTURE0)
      context.bindTexture(context.TEXTURE_2D, texture)

      const textureLoc = location(context, post, 'uTexture')
      if (textureLoc)
        context.uniform1i(textureLoc, 0)
      context.drawArrays(context.TRIANGLE_STRIP, 0, 4)
    },

    dispose () {
      context.deleteBuffer(buffer)
      context.deleteFramebuffer(target)
      context.deleteTexture(texture)
      disposeProgram(context, scene)
      disposeProgram(context, post)
    },
  }
}

// perf: medium; two full-screen passes, one rgba8 target, no per-frame allocations.
