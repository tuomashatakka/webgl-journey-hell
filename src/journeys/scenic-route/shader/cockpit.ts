import { ACES } from '@wjh/glsl/color'
import { brdfChunk, lightingChunk, noiseChunk, skyLookupChunk } from './common'

// ---------------------------------------------------------------------------
// the cockpit
// ---------------------------------------------------------------------------

/**
 * Car-space geometry into the world by the car's frame, with an optional
 * rotation about a pivot first (the wheel by steer, a needle by reading).
 */
export const cockpitVert = /* glsl */`#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUv;
uniform mat4  uViewProj;
uniform mat4  uCarMat;
uniform vec3  uPivot;
uniform vec3  uAxis;
uniform float uAngle;
out vec3 vWorld;
out vec3 vNormal;
out vec2 vUv;
out vec3 vLocal;
vec3 rotAxis (vec3 v, vec3 k, float a) {
  float c = cos(a), s = sin(a);
  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}
void main () {
  vec3 p = aPos;
  vec3 n = aNormal;
  if (uAngle != 0.0) {
    p = uPivot + rotAxis(aPos - uPivot, uAxis, uAngle);
    n = rotAxis(aNormal, uAxis, uAngle);
  }
  vLocal  = p;
  vWorld  = (uCarMat * vec4(p, 1.0)).xyz;
  vNormal = mat3(uCarMat) * n;
  vUv     = aUv;
  gl_Position = uViewProj * vec4(vWorld, 1.0);
}
`

/**
 * The cabin's materials by tag, lit by the same sun and sky as the world, then
 * tonemapped here: this pass draws after the composite, so it carries its own
 * exposure and ACES and no bloom.
 */
export const cockpitFrag = /* glsl */`#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
in vec2 vUv;
in vec3 vLocal;
uniform sampler2D uDial;
uniform vec4  uDialRect;    // car-space: cx, cy, cz, half width (for face uv)
uniform float uExposure;
uniform vec4  uLamps;       // four warning lamps, 0..1 each
uniform float uBlink;
uniform mat4  uCarMat;
uniform sampler2D uMirror;  // the world drawn once more, small, looking back
uniform vec4  uMirrorRect;  // car-space: x0, y0, width, height of the glass
out vec4 fragColor;
${brdfChunk}
${noiseChunk}
${skyLookupChunk}
${lightingChunk}
${ACES}
void main () {
  vec3 p = vWorld;
  vec3 n = normalize(vNormal);
  if (dot(n, uCamPos - p) < 0.0) n = -n;
  int tag = int(vUv.x + 0.5);
  vec3 albedo = vec3(0.03);
  float rough = 0.8;
  float metal = 0.0;
  vec3 emit = vec3(0.0);
  if (tag == 0) {                                   // soft plastic
    albedo = vec3(0.035, 0.034, 0.036) * (0.9 + 0.2 * vnoise(vLocal.xz * 400.0));
    rough = 0.75;
  } else if (tag == 1) {                            // leather
    albedo = vec3(0.045, 0.03, 0.025) * (0.85 + 0.3 * vnoise(vLocal.xy * 300.0 + vLocal.z * 100.0));
    rough = 0.6;
  } else if (tag == 2) {                            // dial face
    // Face uv from car-space x and the face's own vertical.
    vec2 faceUv = vec2((vLocal.x - uDialRect.x) / (2.0 * uDialRect.w) + 0.5, 0.0);
    float dy = (vLocal.y - uDialRect.y);
    float dz = (vLocal.z - uDialRect.z);
    faceUv.y = (dy * cos(0.2443) + dz * sin(0.2443)) / 0.2 + 0.5;
    vec3 tex = texture(uDial, vec2(faceUv.x, 1.0 - faceUv.y)).rgb;
    albedo = tex * 0.6;
    emit = tex * vec3(0.9, 0.85, 0.75) * 0.9;        // backlit markings
    rough = 0.35;
  } else if (tag == 3) {                            // chrome
    albedo = vec3(0.8); metal = 1.0; rough = 0.2;
  } else if (tag == 4) {                            // paint
    albedo = vec3(0.32, 0.02, 0.025); metal = 0.25; rough = 0.22;
  } else if (tag == 5) {                            // mirror: the road behind
    // A mirror keeps left on the left, so the rear camera's image is flipped.
    vec2 muv = (vLocal.xy - uMirrorRect.xy) / uMirrorRect.zw;
    muv.x = 1.0 - muv.x;
    vec3 seen = texture(uMirror, clamp(muv, 0.0, 1.0)).rgb;
    float vig = 1.0 - 0.35 * dot(muv - 0.5, muv - 0.5) * 4.0;
    fragColor = vec4(aces(seen * uExposure * 0.9 * vig), 1.0);
    return;
  } else if (tag == 6) {                            // needle
    albedo = vec3(0.9, 0.2, 0.12);
    emit = vec3(1.0, 0.25, 0.12) * 1.2;
    rough = 0.5;
  } else if (tag == 7) {                            // warning lamps
    int i = int(vUv.y + 0.5);
    float on = i == 0 ? uLamps.x : i == 1 ? uLamps.y : i == 2 ? uLamps.z : uLamps.w;
    vec3 lampCol = i == 0 ? vec3(1.0, 0.6, 0.1) : i == 1 ? vec3(1.0, 0.15, 0.1) : i == 2 ? vec3(1.0, 0.2, 0.1) : vec3(0.2, 0.9, 1.0);
    albedo = vec3(0.05);
    emit = lampCol * on * 3.0;
    if (i == 1 || i == 2) emit *= uBlink;
    rough = 0.3;
  }
  vec3 col = lightSurface(p, n, albedo, rough, metal, 0.6, 1.0) + emit;
  fragColor = vec4(aces(col * uExposure), 1.0);
}
`
