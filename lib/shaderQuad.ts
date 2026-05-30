// Reusable full-screen-quad fragment-shader runner for raw WebGL 1.0.
//
// Shared by the landing-page hover previews (one program per journey, all in a
// single GL context) and by lightweight standalone journey routes. Keeps the
// quad/compile/uniform boilerplate that used to live inline in LiminalJourney
// in one place. Fragment shaders are driven by three optional uniforms:
//   uniform vec2  iResolution;  // canvas pixel size
//   uniform float iTime;        // seconds
//   uniform vec2  uPointer;     // normalized pointer, -1..1 (y up)

const QUAD_VS = `
  attribute vec2 position;
  void main() {
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

const QUAD_VERTS = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);

export interface QuadFrameUniforms {
  time: number;
  pointer?: { x: number; y: number };
}

export interface ShaderQuad {
  /** Render one frame at the canvas's current pixel size. */
  draw(uniforms: QuadFrameUniforms): void;
  /** Release GL resources (program, shaders, buffer). */
  dispose(): void;
}

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    // A null/empty info log on a failed compile almost always means the GL
    // context was lost or exhausted (e.g. a reused canvas whose context was
    // previously released) rather than a genuine source error.
    const log = gl.getShaderInfoLog(shader);
    const reason = gl.isContextLost()
      ? 'context lost — cannot compile'
      : log || 'no info log (context likely lost or unavailable)';
    console.error('[shaderQuad] compile error:', reason);
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/**
 * Build a renderable full-screen quad from a fragment shader. Returns null if
 * compilation/linking fails (callers should fall back to a static poster).
 * Multiple quads can share one WebGLRenderingContext — each owns its own
 * program + tiny vertex buffer, so switching previews is just a useProgram.
 */
export function createShaderQuad(
  gl: WebGLRenderingContext,
  fragmentSource: string,
): ShaderQuad | null {
  const vs = compileShader(gl, gl.VERTEX_SHADER, QUAD_VS);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  if (!vs || !fs) return null;

  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('[shaderQuad] link error:', gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, QUAD_VERTS, gl.STATIC_DRAW);

  const posLoc = gl.getAttribLocation(program, 'position');
  const resLoc = gl.getUniformLocation(program, 'iResolution');
  const timeLoc = gl.getUniformLocation(program, 'iTime');
  const pointerLoc = gl.getUniformLocation(program, 'uPointer');

  return {
    draw({ time, pointer }: QuadFrameUniforms) {
      const canvas = gl.canvas as HTMLCanvasElement;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

      if (resLoc) gl.uniform2f(resLoc, canvas.width, canvas.height);
      if (timeLoc) gl.uniform1f(timeLoc, time);
      if (pointerLoc) gl.uniform2f(pointerLoc, pointer?.x ?? 0, pointer?.y ?? 0);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    dispose() {
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    },
  };
}
