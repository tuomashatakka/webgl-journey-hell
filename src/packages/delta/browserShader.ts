// The /assets page's one shader: a lit sphere per material, a slow pan per sky.
// Index into MAP_MODES is the shader's uMode.

import { ACES } from '@wjh/glsl/color'
import { MATERIAL_GLSL, SKY_GLSL, SURFACE_GLSL } from './glsl'


/** What a material card shows. Index is the shader's uMode. */
export const MAP_MODES = [
  { id: 'lit', label: 'Lit' },
  { id: 'color', label: 'Color' },
  { id: 'displacement', label: 'Displacement' },
  { id: 'normal', label: 'Normal' },
  { id: 'roughness', label: 'Roughness' },
  { id: 'ao', label: 'Ambient Occlusion' },
  { id: 'metalness', label: 'Metalness' },
] as const

export const VERT = `#version 300 es
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main () {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`

export const FRAG = `#version 300 es
precision highp float;
${MATERIAL_GLSL}
${SURFACE_GLSL}
${SKY_GLSL}

in vec2 vUv;
uniform float uKind;       // 0 material sphere, 1 sky pan
uniform float uLayer;
uniform float uMode;
uniform float uTime;
uniform vec2 uSize;
uniform sampler2D uSky;
uniform float uSkyExposure;
uniform vec3 uSun;
out vec4 fragColor;

${ACES}

mat3 rotY (float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }

void main () {
  vec2 p = (vUv - 0.5) * vec2(uSize.x / uSize.y, 1.0);
  vec3 col;
  if (uKind > 0.5) {
    // A slow pan around the horizon, looking a little up.
    float yaw = uTime * 0.03;
    vec3 fwd = normalize(vec3(cos(yaw), 0.18, sin(yaw)));
    vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, fwd);
    vec3 rd = normalize(fwd + p.x * right * 1.3 + p.y * up * 1.3);
    col = aces(skyRadiance(skyTexel(uSky, rd, 0.0), uSkyExposure));
    fragColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
    return;
  }

  vec3 ro = vec3(0.0, 0.0, 3.2);
  vec3 rd = normalize(vec3(p * 0.82, -1.0));
  float b = dot(ro, rd);
  float c = dot(ro, ro) - 1.0;
  float h = b * b - c;
  float t = h > 0.0 ? -b - sqrt(h) : 1e3;
  vec3 hit = ro + rd * min(t, 6.0);
  // Gradients for the triplanar lookup, taken before the branch.
  mat3 R = rotY(uTime * 0.12);
  vec3 q = R * hit * 1.6;
  vec3 dqx = dFdx(q);
  vec3 dqy = dFdy(q);
  vec3 bg = skyRadiance(skyTexel(uSky, rd, 0.0), uSkyExposure * 0.35);

  if (h <= 0.0) {
    col = aces(bg * 0.6);
  } else {
    vec3 n = normalize(hit);
    vec3 nl = R * n;
    Surface s = sampleTriplanarGrad(uLayer, q, nl, 4.0, dqx, dqy);
    s.normal = transpose(R) * s.normal;
    int mode = int(uMode + 0.5);
    if (mode == 0) {
      vec3 V = -rd;
      vec3 L = normalize(uSun);
      col = shadeBrdf(s, V, L) * vec3(1.0, 0.95, 0.88) * 3.2;
      vec3 irr = skyIrradiance(uSky, s.normal, 0.0, uSkyExposure);
      vec3 refl = textureLod(uSky, equirectUv(reflect(rd, s.normal), 0.0), 1.0 + s.rough * 7.0).rgb * uSkyExposure;
      col += shadeAmbient(s, V, irr, refl, mix(0.5, 1.0, s.height));
      col = aces(col);
    }
    else if (mode == 1) col = s.albedo;
    else if (mode == 2) col = vec3(s.height);
    else if (mode == 3) {
      // The tangent-space map itself, as the file stores it: re-sample the
      // dominant projection rather than show the world-space normal.
      vec3 w = abs(nl);
      float k = matScale(uLayer);
      bool xd = w.x > w.y && w.x > w.z;
      bool yd = !xd && w.y > w.z;
      vec2 uv = xd ? q.zy : yd ? q.xz : q.xy;
      vec2 gx = xd ? dqx.zy : yd ? dqx.xz : dqx.xy;
      vec2 gy = xd ? dqy.zy : yd ? dqy.xz : dqy.xy;
      col = textureGrad(uMatNormal, vec3(uv * k, uLayer), gx * k, gy * k).rgb;
      col = vec3(col.xy, sqrt(max(1.0 - dot(col.xy * 2.0 - 1.0, col.xy * 2.0 - 1.0), 0.0)) * 0.5 + 0.5);
      col = pow(col, vec3(2.2));
    }
    else if (mode == 4) col = vec3(s.rough);
    else if (mode == 5) col = vec3(s.ao);
    else col = vec3(s.metal);
    if (mode != 0 && mode != 1 && mode != 3) col = pow(col, vec3(2.2));
    // Antialias the rim against the backdrop.
    float rim = smoothstep(0.0, 0.0025, h);
    col = mix(aces(bg * 0.6), col, rim);
  }
  fragColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
}
`
