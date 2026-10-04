import { MATERIAL_GLSL, SURFACE_GLSL } from '@wjh/delta/glsl'
import { coreGlsl } from './glsl/core'
import { paletteGlsl } from './glsl/palette'
import { setpiecesGlsl } from './glsl/setpieces'
import { marchGlsl } from './glsl/march'
import { shadingGlsl } from './glsl/shading'


// GLSL ES 3.00 on WebGL 2: the walls are Δ scans. The phone build is this
// with LITE defined after the version line (see renderer.ts).
export const fsScene = `#version 300 es\n${coreGlsl}${MATERIAL_GLSL}\n${SURFACE_GLSL}${paletteGlsl}${setpiecesGlsl}${marchGlsl}${shadingGlsl}`

export const fsPost = `#version 300 es

    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif
    uniform sampler2D uTexture;
    uniform vec2 iResolution;
    uniform float iTime;
    uniform vec2 uPointer;
    uniform float uIteration;
    uniform float uPlayerZ;
    out vec4 fragColor;

    float hash(vec2 p) {
        return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453123);
    }

    float sdStar5(vec2 p, float r, float rf) {
        const vec2 k1 = vec2(0.80901699, -0.58778525);
        const vec2 k2 = vec2(-0.80901699, 0.30901699);
        p.x = abs(p.x);
        p -= 2.0 * max(dot(k1, p), 0.0) * k1;
        p -= 2.0 * max(dot(k2, p), 0.0) * k2;
        p.x = abs(p.x);
        p.y -= r;
        vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0, 1) * r;
        float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, 1.0);
        return length(p - ba * h) * sign(p.y - ba.y * h);
    }

    void getSegmentDataPost(float z, out float sector, out float isFall) {
        if (z >= 2000.0) {
            sector = 666.0;
            isFall = 1.0;
            return;
        }
        float loop = floor(z / 500.0);
        float lz = mod(z, 500.0);
        isFall = 0.0;
        if (lz < 60.0)       { sector = 1.0; }
        else if (lz < 130.0) { sector = 2.0; }
        else if (lz < 210.0) { sector = 3.0; }
        else if (lz < 280.0) { sector = 4.0; }
        else if (lz < 360.0) { sector = 5.0; }
        else {
            if (loop == 0.0) {
                sector = 6.0;
            } else {
                sector = 666.0;
                float local666 = lz - 360.0;
                if (local666 >= 30.0 && local666 < 120.0) {
                    isFall = 1.0;
                }
            }
        }
    }

    void main() {
        vec2 uv = gl_FragCoord.xy / iResolution.xy;
        vec2 dist = uv - 0.5;

        // --- 1. FISHEYE CRT LENS EFFECTS (INTENSE FISHEYE) ---
        float r2 = dot(dist, dist);
        vec2 uvDistorted = uv + dist * r2 * 0.42; // Highly intense barrel distortion

        // --- 2. REDUCED CHROMATIC ABERRATION AT EDGES ---
        vec2 chromAbOffset = dist * (r2 + 0.02) * 0.12; 

        float sector, isFall;
        getSegmentDataPost(uPlayerZ, sector, isFall);

        float loopVal = floor(uPlayerZ / 500.0);
        float decayFactor = clamp(smoothstep(0.5, 1.0, loopVal) * 0.42 + max(loopVal - 1.0, 0.0) * 0.2, 0.0, 0.95);
        // As the journey STOPS in the abyss, calm the post FX toward the still reference look.
        float calm = smoothstep(2000.0, 2300.0, uPlayerZ);
        chromAbOffset *= (1.0 - calm * 0.6);

        bool is666 = (sector == 666.0);
        if (is666 && isFall < 0.5) {
            float tG = iTime * 65.0;
            vec2 glitchOff = vec2(
                sin(tG * 1.5) * 0.012 * step(0.72, sin(tG)),
                cos(tG * 0.9) * 0.008 * step(0.82, cos(tG * 1.1))
            );
            uvDistorted += glitchOff;
            chromAbOffset *= 2.2; // Spectrum fringing boost
        }

        vec3 col = vec3(0.0);
        col.r += texture(uTexture, uvDistorted - chromAbOffset).r;
        col.g += texture(uTexture, uvDistorted).g;
        col.b += texture(uTexture, uvDistorted + chromAbOffset).b;

        // --- 3. HORIZONTAL ANAMORPHIC FLARES & SUPER LONG-RADIUS BLOOM ---
        float flarePower = (decayFactor * 0.35 + (is666 ? 0.45 : 0.0)) * (1.0 - calm * 0.9);
        vec3 flare = vec3(0.0);
        for (int i = 1; i <= 6; i++) {
            float flOffset = float(i) * 0.022; // super long sweep
            vec3 tapL = texture(uTexture, uvDistorted - vec2(flOffset, 0.0)).rgb;
            vec3 tapR = texture(uTexture, uvDistorted + vec2(flOffset, 0.0)).rgb;
            flare += max(tapL - 0.28, 0.0);
            flare += max(tapR - 0.28, 0.0);
        }
        col += flare * flarePower * vec3(1.0, 0.3, 0.06); // Anamorphic oxblood flare streak

        vec3 bloom = vec3(0.0);
        float bloomPower = decayFactor * 0.55 * (1.0 - calm * 0.85);
        for (int i = 1; i <= 4; i++) {
            float bOff = float(i) * 0.018;
            bloom += texture(uTexture, uvDistorted + vec2(bOff, bOff)).rgb;
            bloom += texture(uTexture, uvDistorted + vec2(-bOff, bOff)).rgb;
            bloom += texture(uTexture, uvDistorted + vec2(bOff, -bOff)).rgb;
            bloom += texture(uTexture, uvDistorted + vec2(-bOff, -bOff)).rgb;
        }
        col += (bloom / 16.0) * bloomPower;

        // --- 4. DIGITAL INTERFERENCE GLITCHES ---
        float glitchStrength = (decayFactor * 0.22 + (is666 ? 0.45 : 0.0)) * (1.0 - calm * 0.9);
        if (glitchStrength > 0.05) {
            float bandY = floor(uvDistorted.y * 28.0 + iTime * 35.0);
            float hashVal = hash(vec2(bandY, 91.0));
            if (hashVal < glitchStrength * 0.25) {
                uvDistorted.x += (hash(vec2(bandY, 15.0)) - 0.5) * glitchStrength * 0.07;
            }
            if (hash(vec2(floor(iTime * 18.0), 3.0)) < glitchStrength * 0.18) {
                col += vec3(0.18, 0.01, 0.02) * glitchStrength * sin(uvDistorted.y * 30.0);
            }
        }

        // --- 5. ENCLOSING SHADOWS / VIGNETTE ---
        float vignette = smoothstep(0.95, 0.38, length(dist));
        col *= mix(0.18, 1.0, vignette);

        // Thin TV scanlines
        float scanline = sin(uvDistorted.y * iResolution.y * 1.5 + iTime * 12.0) * 0.06;
        col -= vec3(scanline);

        // Color modulation
        if (decayFactor > 0.05) {
            vec3 decayTone = vec3(col.r * 1.15, col.g * 0.72, col.b * 0.65);
            col = mix(col, decayTone, decayFactor * 0.75);
        }

        // --- 6. PENTAGRAM LIGHT LEAK (LAST 666 ENDLESS FALL) ---
        if (uPlayerZ > 2000.0) {
            vec2 starP = dist;
            float angle = iTime * 0.22;
            float cStar = cos(angle), sStar = sin(angle);
            starP = vec2(starP.x * cStar - starP.y * sStar, starP.x * sStar + starP.y * cStar);
            
            float dStar = sdStar5(starP, 0.26, 0.38);
            float starOutline = smoothstep(0.06, 0.0, abs(dStar) - 0.005);
            
            float dCircle = abs(length(starP) - 0.26);
            float circleOutline = smoothstep(0.06, 0.0, dCircle - 0.005);
            
            float pentaLeak = max(starOutline, circleOutline);
            float pentaIntensity = clamp((uPlayerZ - 2000.0) * 0.005, 0.0, 0.88);
            col += vec3(1.0, 0.12, 0.06) * pentaLeak * pentaIntensity * (1.2 + 0.8 * sin(iTime * 18.0));
        }

        // --- 7. TRANSITION FADE TO BLACK & SMOOTH LOOP RE-ENTRY ---
        float lzPost = mod(uPlayerZ, 500.0);
        float fade = 1.0;
        if (uPlayerZ < 2000.0) {
            if (lzPost > 460.0) {
                // Fade out over the last 40 units (460 to 500)
                fade = clamp(1.0 - (lzPost - 460.0) / 40.0, 0.0, 1.0);
            } else if (lzPost < 15.0) {
                // Fade in over the first 15 units (0 to 15)
                fade = clamp(lzPost / 15.0, 0.0, 1.0);
            }
        }
        col *= fade;

        fragColor = vec4(col, 1.0);
    }
`
