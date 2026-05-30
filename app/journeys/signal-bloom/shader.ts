// SIGNAL BLOOM — a compact, dependency-free fragment shader.
// Domain-warped iridescent plasma with a faint CRT scanline to stay on-brand
// with the repo's liminal/glitch aesthetic. Cheap enough to run both as the
// full journey route and as its own hover preview on the landing grid.
//
// Uniforms (set by lib/shaderQuad.ts): iResolution, iTime, uPointer.
export const signalBloomFrag = `
  precision highp float;
  uniform vec2 iResolution;
  uniform float iTime;
  uniform vec2 uPointer;

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    uv += uPointer * 0.2;

    float t = iTime * 0.4;
    vec2 p = uv * 3.0;

    // Iterative domain warp — folds the field into organic filaments.
    for (int i = 0; i < 4; i++) {
      p += 0.5 * vec2(sin(p.y * 1.5 + t), cos(p.x * 1.5 - t));
    }

    float v = sin(p.x) + sin(p.y) + sin((p.x + p.y) * 0.7 + t);

    // Iridescent cosine palette (Inigo Quilez style).
    vec3 col = 0.5 + 0.5 * cos(vec3(0.0, 2.094, 4.188) + v * 1.5 + t);

    // Radial breathing bloom.
    col *= 0.55 + 0.45 * sin(length(uv) * 4.0 - t * 2.0);

    // Faint CRT scanline veil.
    col -= sin(gl_FragCoord.y * 1.2 + iTime * 8.0) * 0.03;

    gl_FragColor = vec4(col, 1.0);
  }
`;
