// Δ/glsl — the shading code that goes with the library, as GLSL ES 3.00
// strings to paste after a shader's `#version` and precision lines.
//
// Three chunks, independent of each other:
//
//   MATERIAL_GLSL  `#define MAT_<ID> n.0` for every layer, matScale(), matDepth()
//   SURFACE_GLSL   sampling every map: colour, normal, roughness, displacement,
//                  AO, metalness — with parallax occlusion, a derivative-built
//                  tangent frame, a triplanar variant, and a GGX BRDF
//   SKY_GLSL       equirectangular lookup without the mip seam, irradiance from
//                  the mip chain, and the tonemapped JPEG lifted back to radiance
//
// References: tangent frames without precomputed tangents follow Christian
// Schüler, "Followup: Normal Mapping Without Precomputed Tangents" (2013); the
// triplanar normal blend is Ben Golus's whiteout blend ("Normal Mapping for a
// Triplanar Shader", 2017); the BRDF is the usual GGX / Smith-Schlick /
// Schlick-Fresnel triple as in Karis, "Real Shading in Unreal Engine 4" (2013).

import { MATERIALS } from './manifest'


export const MATERIAL_GLSL = [
  ...MATERIALS.map((m, i) => `#define MAT_${m.id} ${i}.0`),
  `#define MAT_COUNT ${MATERIALS.length}.0`,
  '',
  '// Texture repeats per metre.',
  'float matScale (float layer) {',
  ...MATERIALS.map((m, i) => `  if (layer < ${i}.5) return ${(1 / m.metres).toFixed(5)};`),
  '  return 1.0;',
  '}',
  '',
  '// Relief depth of the displacement map, in metres.',
  'float matDepth (float layer) {',
  ...MATERIALS.map((m, i) => `  if (layer < ${i}.5) return ${m.depth.toFixed(4)};`),
  '  return 0.0;',
  '}',
].join('\n')

export const SURFACE_GLSL = /* glsl */`
precision highp sampler2DArray;
uniform sampler2DArray uMatColor;   // sRGB colour
uniform sampler2DArray uMatNormal;  // normal.xy (GL), roughness
uniform sampler2DArray uMatDetail;  // displacement, AO, metalness

struct Surface {
  vec3  albedo;
  vec3  normal;   // world space, normal-mapped
  float rough;
  float ao;       // the map's own occlusion, for indirect light only
  float metal;
  float height;   // 0..1 displacement at the (parallax-shifted) sample
};

// Cotangent frame from screen-space derivatives: T and B along +u and +v,
// scaled so that the frame maps uv differentials back to world ones. Needs no
// tangents in the vertex format, works on any uv layout including box mapping,
// and costs four derivative reads.
mat3 cotangentFrame (vec3 N, vec3 p, vec2 uv) {
  vec3 dp1 = dFdx(p);
  vec3 dp2 = dFdy(p);
  vec2 duv1 = dFdx(uv);
  vec2 duv2 = dFdy(uv);
  vec3 dp2perp = cross(dp2, N);
  vec3 dp1perp = cross(N, dp1);
  vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
  vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;
  float invmax = inversesqrt(max(dot(T, T), dot(B, B)) + 1e-20);
  return mat3(T * invmax, B * invmax, N);
}

// Parallax occlusion: march the view ray down through the displacement map
// and return the uv where it enters the surface. Gradients are taken from the
// unshifted uv and passed explicitly — the shifted uv is discontinuous at
// every occlusion edge, and implicit derivatives there pick the wrong mip and
// draw a seam of noise along every brick.
vec2 parallaxUv (vec2 uv, vec3 viewTS, float layer, float depthUv, vec2 gx, vec2 gy, int steps) {
  if (depthUv <= 0.0 || viewTS.z <= 0.05)
    return uv;
  float n = float(steps);
  vec2 shift = viewTS.xy / viewTS.z * depthUv;
  vec2 stepUv = shift / n;
  float layerH = 1.0 / n;
  float rayH = 1.0;
  vec2 cur = uv;
  float h = textureGrad(uMatDetail, vec3(cur, layer), gx, gy).r;
  float prevH = h;
  float prevRay = rayH;
  for (int i = 0; i < 24; i++) {
    if (i >= steps || rayH <= h) break;
    prevH = h;
    prevRay = rayH;
    cur -= stepUv;
    rayH -= layerH;
    h = textureGrad(uMatDetail, vec3(cur, layer), gx, gy).r;
  }
  // One secant step between the last two samples.
  float a = rayH - h;
  float b = prevRay - prevH;
  float t = clamp(a / (a - b + 1e-5), 0.0, 1.0);
  return mix(cur, cur + stepUv, t);
}

vec3 unpackNormal (vec2 xy) {
  vec2 n = xy * 2.0 - 1.0;
  return vec3(n, sqrt(max(1.0 - dot(n, n), 0.0)));
}

// Sample every map of one layer at a metric uv. \`pomSteps\` 0 turns parallax
// off (distance, cost, or a surface whose relief would read as wrong).
Surface sampleMaterial (float layer, vec2 uvMetres, vec3 N, vec3 P, vec3 V, int pomSteps) {
  float scale = matScale(layer);
  vec2 uv = uvMetres * scale;
  vec2 gx = dFdx(uv);
  vec2 gy = dFdy(uv);
  mat3 TBN = cotangentFrame(N, P, uv);

  if (pomSteps > 0) {
    vec3 viewTS = normalize(vec3(dot(V, TBN[0]), dot(V, TBN[1]), dot(V, N)));
    uv = parallaxUv(uv, viewTS, layer, matDepth(layer) * scale, gx, gy, pomSteps);
  }

  vec4 c = textureGrad(uMatColor, vec3(uv, layer), gx, gy);
  vec4 n = textureGrad(uMatNormal, vec3(uv, layer), gx, gy);
  vec4 d = textureGrad(uMatDetail, vec3(uv, layer), gx, gy);

  Surface s;
  s.albedo = c.rgb;
  s.normal = normalize(TBN * unpackNormal(n.xy));
  s.rough  = clamp(n.z, 0.04, 1.0);
  s.ao     = d.g;
  s.metal  = d.b;
  s.height = d.r;
  return s;
}

// Triplanar variant for surfaces with no uv at all (the raymarched stairwell).
// Three projections, weighted by the normal; the normal maps are combined with
// the whiteout blend so a slope is not lit as if it were facing the camera.
Surface sampleTriplanar (float layer, vec3 p, vec3 N, float sharpness) {
  float scale = matScale(layer);
  vec3 w = pow(abs(N), vec3(sharpness));
  w /= (w.x + w.y + w.z);
  vec2 ux = p.zy * scale;
  vec2 uy = p.xz * scale;
  vec2 uz = p.xy * scale;

  vec4 cx = texture(uMatColor, vec3(ux, layer));
  vec4 cy = texture(uMatColor, vec3(uy, layer));
  vec4 cz = texture(uMatColor, vec3(uz, layer));
  vec4 nx = texture(uMatNormal, vec3(ux, layer));
  vec4 ny = texture(uMatNormal, vec3(uy, layer));
  vec4 nz = texture(uMatNormal, vec3(uz, layer));
  vec4 dx = texture(uMatDetail, vec3(ux, layer));
  vec4 dy = texture(uMatDetail, vec3(uy, layer));
  vec4 dz = texture(uMatDetail, vec3(uz, layer));

  // Whiteout: add the tangent normal's xy to the surface normal's own two
  // in-plane components for each projection, multiply the z's.
  vec3 tx = unpackNormal(nx.xy);
  vec3 ty = unpackNormal(ny.xy);
  vec3 tz = unpackNormal(nz.xy);
  tx = vec3(tx.xy + N.zy, abs(tx.z) * N.x);
  ty = vec3(ty.xy + N.xz, abs(ty.z) * N.y);
  tz = vec3(tz.xy + N.xy, abs(tz.z) * N.z);

  Surface s;
  s.albedo = cx.rgb * w.x + cy.rgb * w.y + cz.rgb * w.z;
  s.normal = normalize(tx.zyx * w.x + ty.xzy * w.y + tz.xyz * w.z);
  s.rough  = clamp(nx.z * w.x + ny.z * w.y + nz.z * w.z, 0.04, 1.0);
  vec3 d   = dx.rgb * w.x + dy.rgb * w.y + dz.rgb * w.z;
  s.height = d.r;
  s.ao     = d.g;
  s.metal  = d.b;
  return s;
}

// The same, with explicit gradients: for a raymarcher, which samples inside a
// branch on whether the ray hit anything, where implicit derivatives are
// undefined. dpx/dpy are the screen-space derivatives of the hit position,
// taken in uniform control flow before the branch.
Surface sampleTriplanarGrad (float layer, vec3 p, vec3 N, float sharpness, vec3 dpx, vec3 dpy) {
  float scale = matScale(layer);
  vec3 w = pow(abs(N), vec3(sharpness));
  w /= (w.x + w.y + w.z);
  vec2 ux = p.zy * scale, uy = p.xz * scale, uz = p.xy * scale;
  vec2 gxx = dpx.zy * scale, gxy = dpy.zy * scale;
  vec2 gyx = dpx.xz * scale, gyy = dpy.xz * scale;
  vec2 gzx = dpx.xy * scale, gzy = dpy.xy * scale;

  vec4 cx = textureGrad(uMatColor, vec3(ux, layer), gxx, gxy);
  vec4 cy = textureGrad(uMatColor, vec3(uy, layer), gyx, gyy);
  vec4 cz = textureGrad(uMatColor, vec3(uz, layer), gzx, gzy);
  vec4 nx = textureGrad(uMatNormal, vec3(ux, layer), gxx, gxy);
  vec4 ny = textureGrad(uMatNormal, vec3(uy, layer), gyx, gyy);
  vec4 nz = textureGrad(uMatNormal, vec3(uz, layer), gzx, gzy);
  vec4 dx = textureGrad(uMatDetail, vec3(ux, layer), gxx, gxy);
  vec4 dy = textureGrad(uMatDetail, vec3(uy, layer), gyx, gyy);
  vec4 dz = textureGrad(uMatDetail, vec3(uz, layer), gzx, gzy);

  vec3 tx = unpackNormal(nx.xy);
  vec3 ty = unpackNormal(ny.xy);
  vec3 tz = unpackNormal(nz.xy);
  tx = vec3(tx.xy + N.zy, abs(tx.z) * N.x);
  ty = vec3(ty.xy + N.xz, abs(ty.z) * N.y);
  tz = vec3(tz.xy + N.xy, abs(tz.z) * N.z);

  Surface s;
  s.albedo = cx.rgb * w.x + cy.rgb * w.y + cz.rgb * w.z;
  s.normal = normalize(tx.zyx * w.x + ty.xzy * w.y + tz.xyz * w.z);
  s.rough  = clamp(nx.z * w.x + ny.z * w.y + nz.z * w.z, 0.04, 1.0);
  vec3 d   = dx.rgb * w.x + dy.rgb * w.y + dz.rgb * w.z;
  s.height = d.r;
  s.ao     = d.g;
  s.metal  = d.b;
  return s;
}

// GGX specular + Lambert diffuse for one light, radiance already applied by
// the caller. Returns reflected radiance per unit incoming.
vec3 shadeBrdf (Surface s, vec3 V, vec3 L) {
  vec3 N = s.normal;
  vec3 H = normalize(V + L);
  float ndl = max(dot(N, L), 0.0);
  float ndv = max(dot(N, V), 1e-3);
  float ndh = max(dot(N, H), 0.0);
  float vdh = max(dot(V, H), 0.0);
  float a  = s.rough * s.rough;
  float a2 = a * a;
  float dd = ndh * ndh * (a2 - 1.0) + 1.0;
  float D  = a2 / (3.14159 * dd * dd);
  float k  = (s.rough + 1.0) * (s.rough + 1.0) / 8.0;
  float G  = ndv / (ndv * (1.0 - k) + k) * ndl / (ndl * (1.0 - k) + k);
  vec3 F0 = mix(vec3(0.04), s.albedo, s.metal);
  vec3 F  = F0 + (1.0 - F0) * pow(1.0 - vdh, 5.0);
  vec3 spec = D * G * F / (4.0 * ndv * max(ndl, 1e-3));
  vec3 kd = (1.0 - F) * (1.0 - s.metal);
  return (kd * s.albedo / 3.14159 + spec) * ndl;
}

// Split-sum-ish ambient: diffuse irradiance plus a crude specular term from
// the same colour, both darkened by the map's AO and the caller's occlusion.
vec3 shadeAmbient (Surface s, vec3 V, vec3 irradiance, vec3 reflected, float occlusion) {
  float ndv = max(dot(s.normal, V), 0.0);
  vec3 F0 = mix(vec3(0.04), s.albedo, s.metal);
  vec3 F  = F0 + (max(vec3(1.0 - s.rough), F0) - F0) * pow(1.0 - ndv, 5.0);
  vec3 diffuse = irradiance * s.albedo * (1.0 - s.metal);
  vec3 spec = reflected * F * (1.0 - s.rough * 0.7);
  return (diffuse * (1.0 - F) + spec) * s.ao * occlusion;
}
`

export const SKY_GLSL = /* glsl */`
// Equirectangular direction -> uv. Zenith at v = 0, the top row of the JPEG.
vec2 equirectUv (vec3 d, float yaw) {
  float u = atan(d.z, d.x) * 0.15915494 + 0.5 + yaw;
  float v = acos(clamp(d.y, -1.0, 1.0)) * 0.31830989;
  return vec2(u, v);
}

// Lookup without the seam: atan wraps from 1 to 0 at the back of the sphere,
// and the implicit derivative across that wrap selects the smallest mip — a
// one-pixel vertical line through every sky. Taking the u-gradient from
// whichever of u and fract(u + 0.5) is continuous here removes it.
vec3 skyTexel (sampler2D sky, vec3 d, float yaw) {
  vec2 uv = equirectUv(d, yaw);
  vec2 uv2 = vec2(fract(uv.x + 0.5), uv.y);
  vec2 gx = dFdx(uv);
  vec2 gy = dFdy(uv);
  vec2 gx2 = dFdx(uv2);
  vec2 gy2 = dFdy(uv2);
  if (abs(gx2.x) < abs(gx.x)) gx.x = gx2.x;
  if (abs(gy2.x) < abs(gy.x)) gy.x = gy2.x;
  return textureGrad(sky, uv, gx, gy).rgb;
}

// The map is a tonemapped JPEG; scene lighting is not. Lift the highlights
// back toward radiance with an inverse Reinhard on the brightest values, so a
// sun behind cloud blooms and a grey cloud does not.
vec3 skyRadiance (vec3 c, float exposure) {
  float m = max(c.r, max(c.g, c.b));
  float lift = 1.0 / max(1.0 - m * 0.86, 0.14);
  return c * mix(1.0, lift, smoothstep(0.55, 1.0, m)) * exposure;
}

// Irradiance by mip chain: a high LOD around the normal is a blurred
// hemisphere, close enough to a cosine convolution for an overcast sky.
vec3 skyIrradiance (sampler2D sky, vec3 n, float yaw, float exposure) {
  vec3 a = textureLod(sky, equirectUv(normalize(n + vec3(0.0, 0.35, 0.0)), yaw), 7.5).rgb;
  vec3 b = textureLod(sky, equirectUv(vec3(0.0, 1.0, 0.0), yaw), 9.0).rgb;
  return mix(b, a, 0.7) * exposure;
}
`
