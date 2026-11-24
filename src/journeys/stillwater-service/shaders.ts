import { SURFACE } from './geometry'
import { ACTS } from './timeline'


const materials = Object.entries(SURFACE).map(([ name, id ]) => `const int ${name.toUpperCase()} = ${id};`)
  .join('\n')

const scenes = ACTS.map(({ id }, i) => `const int ${id.toUpperCase()} = ${i};`).join('\n')

const waves = /* glsl */`
  vec2 wave(vec2 p, vec2 direction, float k, float rate, float height) {
    float phase = dot(p, direction) * k - rate * uTime;
    float s = sin(phase);
    float sharp = s * (0.86 + 0.19 * s);
    return vec2(sharp * height, k * cos(phase) * (0.86 + 0.38 * s) * height);
  }

  vec3 sea(vec2 p) {
    float strength = 1.0 + uLap * 0.29;
    vec2 d0 = vec2(0.86, 0.51);
    vec2 d1 = vec2(-0.57, 0.82);
    vec2 d2 = vec2(0.18, -0.98);
    vec2 a = wave(p, d0, 0.043, 0.77, 5.1 * strength);
    vec2 b = wave(p, d1, 0.064, 1.08, 3.4 * strength);
    vec2 c = wave(p, d2, 0.105, 1.44, 2.0 * strength);
    return vec3(a.x + b.x + c.x, a.y * d0 + b.y * d1 + c.y * d2);
  }
`

const noise = /* glsl */`
  float hash(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }

  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
      mix(hash(i + vec2(0, 1)), hash(i + 1.0), u.x), u.y);
  }
`

export const worldVert = /* glsl */`#version 300 es
  precision highp float;
  precision highp int;
  layout(location = 0) in vec3 aPosition;
  layout(location = 1) in vec3 aNormal;
  uniform mat4 uViewProjection;
  uniform vec3 uOffset;
  uniform int uMaterial;
  uniform float uLap;
  uniform float uTime;
  out vec3 vWorld;
  out vec3 vNormal;
  ${materials}
  ${waves}

  void main() {
    vec3 p = aPosition + uOffset;
    if (uMaterial == OCEAN)
      p.y = sea(p.xz).x;
    if (uMaterial == POOLWATER)
      p.y += 0.18 * uLap + 0.005 * sin(p.x * 2.6 + p.z * 1.1 - uTime * 1.3);
    vWorld = p;
    vNormal = aNormal;
    gl_Position = uViewProjection * vec4(p, 1.0);
  }
`

export const worldFrag = /* glsl */`#version 300 es
  precision highp float;
  precision highp int;
  uniform vec3 uEye;
  uniform vec3 uColor;
  uniform vec4 uAir;
  uniform float uLap;
  uniform float uTime;
  uniform int uMaterial;
  uniform int uScene;
  uniform int uHigh;
  in vec3 vWorld;
  in vec3 vNormal;
  out vec4 fragColor;
  ${materials}
  ${scenes}
  ${noise}
  ${waves}

  const vec3 moon = vec3(-0.41, 0.31, 0.857);

  float joints(vec2 p, float width) {
    vec2 line = abs(fract(p + 0.5) - 0.5);
    float closest = min(line.x, line.y);
    float aa = min(max(fwidth(closest), 0.001), 0.2);
    return 1.0 - smoothstep(width, width + aa, closest);
  }

  float caustic(vec2 p) {
    float a = sin(p.x * 3.6 + p.y * 0.84 + sin(p.y * 3.0 - uTime * 0.45));
    float b = sin(p.y * 4.5 - p.x * 0.82 + sin(p.x * 2.7 + uTime * 0.68));
    float signal = abs(a + b);
    return (1.0 - smoothstep(0.01, 0.18, signal)) * 0.62
      + (1.0 - smoothstep(0.04, 0.34, signal)) * 0.38;
  }

  vec3 poolWater(vec3 p, vec3 view) {
    vec2 floorUV = p.xz + vec2(sin(p.z * 2.9 - uTime), sin(p.x * 3.1 + uTime)) * (0.025 + 0.009 * uLap);
    float phase = abs(fract((floorUV.x + 9.05) / 2.36) - 0.5);
    float line = (1.0 - smoothstep(0.028, 0.065, phase)) * smoothstep(4.7, 6.1, floorUV.y)
      * (1.0 - smoothstep(25.8, 27.0, floorUV.y));
    float end = (1.0 - smoothstep(0.1, 0.16, phase))
      * (1.0 - smoothstep(0.08, 0.22, min(abs(floorUV.y - 6.1), abs(floorUV.y - 25.9))));
    float reflected = pow(1.0 - max(0.0, view.y), 3.25);
    float skylight = smoothstep(0.08, 0.31, abs(fract((p.z + 0.2 + view.z * 4.8) * 0.25) - 0.5));
    vec3 floorColor = mix(uColor, vec3(0.025, 0.17, 0.19), max(line, end) * 0.81);
    floorColor *= 0.64 + 0.265 * caustic(floorUV) - joints(floorUV * 3.8, 0.034) * 0.16;
    return mix(floorColor, mix(vec3(0.16, 0.40, 0.39), vec3(0.63, 0.80, 0.73), skylight), reflected * 0.83);
  }

  vec3 ocean(vec3 p, vec3 view) {
    vec3 swell = sea(p.xz);
    float depth = length(uEye - p);
    float detail = 1.0 - smoothstep(160.0, 420.0, depth);
    vec2 skin = vec2(sin(p.x * 0.88 + p.z * 0.4 - uTime * 1.5),
      cos(p.z * 0.87 - p.x * 0.62 + uTime * 1.25)) * detail * (uHigh == 1 ? 0.07 : 0.024);
    vec3 normal = normalize(vec3(-swell.y + skin.x, 1.0, -swell.z + skin.y));
    float fresnel = pow(1.0 - max(dot(normal, view), 0.0), 4.0);
    float spec = pow(max(dot(normal, normalize(view + moon)), 0.0), 32.0);
    float crest = max(p.y, swell.x * 0.77) / (1.0 + uLap * 0.29);
    float torn = noise(p.xz * 0.18 + vec2(uTime * 0.44, -uTime * 0.25));
    float lace = uHigh == 1 ? noise(p.xz * 0.80 - uTime * 0.18) : 0.45;
    float foam = smoothstep(5.0, 7.6, crest + 2.3 * torn + 0.9 * lace)
      * smoothstep(0.22, 0.55, torn + 0.13 * lace);
    foam *= 0.48 + 0.52 * detail;
    vec3 c = mix(vec3(0.022, 0.057, 0.071), vec3(0.18, 0.26, 0.29), fresnel * 0.76);
    c += vec3(0.32, 0.42, 0.44) * spec * 0.44;
    return mix(c, vec3(0.66, 0.78, 0.76), foam * 0.81);
  }

  void main() {
    vec3 p = vWorld;
    vec3 normal = normalize(vNormal);
    vec3 view = normalize(uEye - p);
    vec2 uv = abs(normal.y) > 0.6 ? p.xz : abs(normal.x) > 0.6 ? p.zy : p.xy;
    float grain = noise(uv * 18.0);
    float daylight = 0.58 + 0.26 * max(dot(normal, normalize(vec3(-0.25, 0.86, -0.48))), 0.0);
    vec3 color = uColor * daylight;
    float distanceFromEye = length(uEye - p);

    if (uMaterial == TILE) {
      float grout = joints(uv * 3.56, 0.021);
      color *= (0.92 + 0.16 * hash(floor(uv * 3.56 + 0.5))) * (1.0 - grout * 0.26);
      color += vec3(0.11, 0.15, 0.13) * pow(1.0 - abs(dot(view, normal)), 5.0);
      if (uScene == POOL)
        color *= 0.52 + 0.55 * exp(-abs(p.x + 3.7) * 0.112) + 0.05 * cos(p.z * 1.57);
    }
    if (uMaterial == CARPET) {
      float wet = exp(-abs(p.x - 0.48 * p.z + 1.9) * 2.5) * (0.5 + 0.5 * noise(p.xz * 0.41));
      color *= (0.61 + 0.42 * grain) * (1.0 - min(uLap, 1.0) * wet * 0.55);
    }
    if (uMaterial == ACOUSTIC) {
      float ceiling = step(0.6, abs(normal.y));
      float seams = joints(uv * mix(1.0, 1.67, ceiling), mix(0.012, 0.023, ceiling));
      color *= 0.84 + 0.16 * noise(uv * 1.8) + 0.07 * grain - 0.21 * seams;
      color *= 0.87 + 0.13 * smoothstep(0.0, 2.8, p.y);
    }
    if (uMaterial == CONCRETE) {
      float casting = sin(uv.y * 13.0) * 0.05;
      color *= 0.81 + casting + 0.16 * noise(uv * 3.0) + 0.11 * grain;
    }
    if (uMaterial == STEEL) {
      color *= 0.75 + 0.24 * noise(uv * vec2(4, 37));
      color += vec3(0.07, 0.09, 0.08) * pow(1.0 - abs(dot(view, normal)), 3.0);
    }
    if (uMaterial == GLASS) {
      color = uColor * (0.29 + 0.52 * pow(1.0 - abs(dot(view, normal)), 2.0));
      color += vec3(0.07, 0.13, 0.12) * smoothstep(0.47, 0.54, fract(uv.y * 1.1 + uv.x * 0.2));
    }
    if (uMaterial == BELT) {
      float rubber = smoothstep(0.2, 0.66, fract(length(p.xz - vec2(0, 8)) * 20.0));
      color *= 0.56 + 0.22 * rubber + 0.14 * grain;
    }
    if (uMaterial == LIGHT) {
      float bank = hash(floor(p.xz * 0.31 + 0.4) + floor(p.y * 0.16));
      float powered = 1.0 - step(bank, uLap * 0.31) * 0.92;
      if (uScene == BREAKWATER || uScene == LOUNGE)
        powered = 1.0;
      color = uColor * powered * (0.94 + 0.06 * sin(p.z * 84.0));
    }
    if (uMaterial == POOLWATER)
      color = poolWater(p, view);
    if (uMaterial == OCEAN)
      color = ocean(p, view);

    if (uScene == POOL) {
      float emergency = step(1.5, uLap);
      color *= mix(vec3(0.89, 1.0, 0.96), vec3(0.37, 0.53, 0.52), emergency);
      color += vec3(0.23, 0.09, 0.045) * emergency * exp(-5.0 * abs(sin(p.z * 0.79))) * exp(-abs(p.y - 1.2));
    }
    if (uScene == ANNEX)
      color *= mix(vec3(1.0, 0.96, 0.75), vec3(0.47, 0.46, 0.35), uLap * 0.5);
    if (uScene == LIFT && uMaterial != LIGHT) {
      float slit = exp(-0.99 * abs(mod(p.y + 0.54, 6.0) - 2.75));
      color *= (0.56 + 0.44 * slit) * (1.0 - uLap * 0.18);
      color += vec3(0.16, 0.126, 0.086) * slit * (0.52 - 0.14 * uLap);
    }
    if (uScene == LOUNGE && uMaterial != LIGHT) {
      float ripple = caustic(p.xz * 1.28 + p.y * vec2(0.6, 0.93));
      color *= vec3(0.32, 0.73, 0.81) * (0.57 + 0.27 * ripple - uLap * 0.08);
      color += vec3(0.035, 0.16, 0.18) * ripple * exp(-p.y * 0.12);
    }
    if (uScene == CAROUSEL && uMaterial == TILE) {
      float damp = 1.0 - smoothstep(0.11, 0.82, abs(length(p.xz - vec2(0, 8)) - 5.44));
      color *= 1.0 - damp * uLap * 0.17 * noise(p.xz * 3.5);
    }

    float fog = 1.0 - exp(-distanceFromEye * uAir.w);
    float distanceFactor = smoothstep(55.0, 280.0, distanceFromEye);
    float horizon = 1.0 - smoothstep(0.035, 0.16, abs(normalize(p - uEye).y));
    vec3 fogColor = uAir.rgb;
    if (uScene == BREAKWATER) {
      fog *= mix(0.96, 0.59 + 0.35 * horizon, distanceFactor);
      if (uMaterial == OCEAN)
        fogColor *= mix(0.68, 1.0, horizon);
    }
    fragColor = vec4(clamp(mix(color, fogColor, fog), 0.0, 1.0), 1.0);
  }
`

export const screenFrag = /* glsl */`#version 300 es
  precision highp float;
  precision highp int;
  uniform mat4 uInverse;
  uniform vec3 uEye;
  uniform vec4 uAir;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uLap;
  uniform float uShutter;
  uniform int uScreen;
  uniform int uDoor;
  out vec4 fragColor;
  ${noise}

  void main() {
    vec2 uv = gl_FragCoord.xy / uResolution;
    if (uScreen == 1) {
      float edge = uDoor == 1 ? uv.x : uDoor == 2 ? uv.y : 1.0 - uv.y;
      if (edge > uShutter)
        discard;
      float slats = 1.0 - smoothstep(0.015, 0.11, abs(fract(edge * 14.0) - 0.5));
      float falloff = smoothstep(0.04, 0.5, 0.5 - abs(uv.x - 0.5));
      vec3 skin = vec3(0.035, 0.058, 0.063) * (0.75 + 0.37 * falloff - 0.35 * slats);
      skin += vec3(0.11, 0.105, 0.077) * (1.0 - smoothstep(0.009, 0.026, uShutter - edge));
      fragColor = vec4(skin, 1.0);
    }
    else if (uScreen == 2) {
      vec2 p = uv * vec2(130.0 * uResolution.x / uResolution.y, 130.0)
        + vec2(-uTime * 0.82, uTime * 0.58);
      vec2 i = floor(p);
      vec2 q = fract(p) - vec2(hash(i), hash(i + 17.1));
      float mote = (1.0 - smoothstep(0.03, 0.15, length(q))) * step(0.88 - uLap * 0.035, hash(i + 33.0));
      fragColor = vec4(0.59, 0.85, 0.79, mote * (0.23 + uLap * 0.075));
    }
    else {
      vec4 farPoint = uInverse * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
      vec3 ray = normalize(farPoint.xyz / farPoint.w - uEye);
      float lift = smoothstep(-0.035, 0.74, ray.y);
      vec3 sky = mix(uAir.rgb, vec3(0.051, 0.076, 0.092), lift);
      vec2 clouds = vec2(atan(ray.x, ray.z) * 4.0, ray.y * 21.0);
      float low = noise(clouds + vec2(uTime * 0.031, 0)) * 0.63;
      float high = noise(clouds * vec2(2.1, 0.84) - vec2(uTime * 0.017, 5.8)) * 0.37;
      float bands = smoothstep(0.20, 0.76, low + high) * smoothstep(0.018, 0.29, ray.y);
      sky *= 1.0 - 0.34 * bands;
      float light = pow(max(dot(ray, normalize(vec3(-0.41, 0.31, 0.857))), 0.0), 28.0);
      sky += vec3(0.20, 0.18, 0.14) * light * (1.0 - bands);
      fragColor = vec4(sky, 1.0);
    }
  }
`
