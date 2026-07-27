// THE STAIRWELL — a first-person raymarched descent through an endless
// brutalist concrete stairwell that, every flight, folds into an M.C. Escher
// impossible loop. Two-pass pipeline (matches app/journeys/liminal):
//   fsScene → FBO  (SDF raymarch + realistic lighting + ACES tonemap)
//   fsPost  → screen (subtle CA + threshold bloom + grain + vignette)
//
// The whole world descends continuously in world-Z, so the camera (driven by
// uPlayerZ from the page) walks downstairs forever with no seam. Only the
// atmosphere + the Escher overlay loop, keyed off mod(uPlayerZ, 500).
//
// Uniform contract (set by page.tsx):
//   scene: iResolution, iTime, uIteration, uPointer, uPlayerZ, uHeavy
//   post : iResolution, iTime, uPointer, uIteration, uPlayerZ, uBrightness, uTexture

export const vsQuad = `
    attribute vec2 position;
    void main() {
        gl_Position = vec4(position, 0.0, 1.0);
    }
`

export const fsScene = `
    precision highp float;
    uniform vec2 iResolution;
    uniform float iTime;
    uniform float uIteration;
    uniform vec2 uPointer;
    uniform float uPlayerZ;
    uniform float uHeavy;

    #define MAX_STEPS 100
    #define MAX_DIST 130.0
    #define SURF_DIST 0.02

    // Material IDs
    #define MAT_CONCRETE 1.0
    #define MAT_STEEL    2.0

    // Path / stair constants. The journey is a chain of SEG-long sections that
    // turn +/-90 at junctions. SLOPE = STEP_RISE / STEP_RUN. Keep SEG == SEG_LEN
    // in kinematics.ts.
    #define SEG 70.0
    #define SLOPE 0.42
    #define STEP_RUN 1.7
    #define STEP_RISE 0.714
    #define STAIR_HW 1.7
    #define EYE 1.7

    // Per-frame path globals (set once in main()).
    float gKc, gU, gTurnCur, gTurnNext, gRoomCur;

    float hash(vec2 p) {
        return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453123);
    }

    float vnoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }

    float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 4; i++) {
            v += a * vnoise(p);
            p *= 2.02;
            a *= 0.5;
        }
        return v;
    }

    mat2 rot2(float a) {
        float c = cos(a), s = sin(a);
        return mat2(c, -s, s, c);
    }

    float sdBox(vec3 p, vec3 b) {
        vec3 d = abs(p) - b;
        return length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0);
    }

    // Turn (degrees) applied entering section 'seg', and its room type. The
    // pattern winds the tower with an occasional straight run (the 0).
    float turnDeg(float seg) {
        float k = mod(seg, 6.0);
        if (k < 0.5) return 0.0;
        if (k < 1.5) return 90.0;
        if (k < 2.5) return 90.0;
        if (k < 3.5) return -90.0;
        if (k < 4.5) return 90.0;
        return -90.0;
    }
    float roomType(float seg) { return mod(seg, 6.0); }

    // --- Per-section primitives, evaluated in a section-local frame where the
    //     floor descends as y = -SLOPE * q.z and the section spans q.z in [0,SEG] ---

    // The room's air volume (negative inside). Rooms differ in width/height/offset
    // so each section is a distinct kind of space.
    float roomAir(vec3 q, float type) {
        float fY = -SLOPE * q.z;
        float halfW = 2.8, roomH = 5.0, cx = 0.0;
        if (type == 1.0)      { halfW = 5.6; roomH = 12.0; cx = 2.6; }  // atrium: wide + tall, opens to +x
        else if (type == 2.0) { halfW = 4.7; roomH = 4.2; }            // vault: wide + low (columns)
        else if (type == 3.0) { halfW = 4.2; roomH = 8.0; }            // impossible crossing chamber
        else if (type == 4.0) { halfW = 3.3; roomH = 10.0; }           // skylight well (tall)
        else if (type == 5.0) { halfW = 3.8; roomH = 5.6; }            // gallery
        float cy = fY + roomH * 0.5;
        // +pad along z so neighbouring sections' air overlaps and corners open.
        return sdBox(q - vec3(cx, cy, SEG * 0.5), vec3(halfW, roomH * 0.5, SEG * 0.5 + 7.0));
    }

    // A vertical light-well punched through the ceiling, open to the sky.
    float skylightAir(vec3 q) {
        float fY = -SLOPE * q.z;
        return sdBox(q - vec3(0.0, fY + 16.0, SEG * 0.5), vec3(1.9, 12.0, 4.5));
    }

    // Window apertures punched through both side walls (repeating along z).
    float galleryAir(vec3 q) {
        float fY = -SLOPE * q.z;
        vec3 qq = q; qq.z = mod(q.z, 14.0) - 7.0;
        return sdBox(qq - vec3(0.0, fY + 2.7, 0.0), vec3(7.0, 1.3, 1.5));
    }

    float sectionAir(vec3 q, float type) {
        float a = roomAir(q, type);
        if (type == 4.0) a = min(a, skylightAir(q));
        if (type == 5.0) a = min(a, galleryAir(q));
        return a;
    }

    // Solid descending staircase (positive outside), central flight of half-width STAIR_HW.
    float sdStairsLocal(vec3 q) {
        float n = floor(q.z / STEP_RUN);
        vec3 b = vec3(STAIR_HW, 30.0, STEP_RUN * 0.5);
        vec3 c = vec3(0.0, -STEP_RISE * n - 30.0, (n + 0.5) * STEP_RUN);
        vec3 d = abs(q - c) - b;
        float s0 = length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0);
        float n2 = n + 1.0;
        c = vec3(0.0, -STEP_RISE * n2 - 30.0, (n2 + 0.5) * STEP_RUN);
        d = abs(q - c) - b;
        float s1 = length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0);
        return min(s0, s1);
    }

    // Square pillars at |x| = 3.3, repeating along z (vault rooms).
    float sdColumns(vec3 q) {
        float fY = -SLOPE * q.z;
        float zc = mod(q.z, 15.0) - 7.5;
        vec3 pc = vec3(abs(q.x) - 3.3, q.y - (fY + 2.0), zc);
        vec3 d = abs(pc) - vec3(0.5, 2.4, 0.5);
        return length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0);
    }

    // Inverted staircase mirrored across the ceiling, climbing the opposite way.
    float invStairs(vec3 q) {
        float fY = -SLOPE * q.z;
        vec3 iq = q;
        iq.y = 2.0 * (fY + 7.0) - q.y;
        iq.z = -q.z;
        return sdStairsLocal(iq);
    }

    // Steel handrails flanking the flight.
    float railSDF(vec3 q) {
        float ry = -SLOPE * q.z + 1.0;
        float rl = length(vec2(q.x + (STAIR_HW + 0.25), q.y - ry)) - 0.06;
        float rr = length(vec2(q.x - (STAIR_HW + 0.25), q.y - ry)) - 0.06;
        return min(rl, rr);
    }

    // Section solids (stairs + per-type features), clipped to the section's air.
    float sectionSolid(vec3 q, float type, float air) {
        float s = max(sdStairsLocal(q), air);
        if (type == 2.0) s = min(s, max(sdColumns(q), air));
        if (type == 3.0) {
            // Escher: a second flight mirrored onto the ceiling, climbing the
            // opposite way. Kept up near the ceiling so it never blocks the path.
            s = min(s, max(invStairs(q), air));
        }
        return s;
    }

    // Scene SDF -> vec2(distance, materialId). Renders the camera's section plus
    // its two neighbours, each transformed into the camera-aligned frame so the
    // corridor turns at the junctions.
    vec2 map(vec3 p) {
        // Current section (identity frame).
        vec3 q0 = p;
        // Next section: rotate about the far landing pivot by -turnNext.
        vec2 rn = rot2(-gTurnNext) * vec2(p.x, p.z - SEG);
        vec3 pp = vec3(rn.x, p.y + SLOPE * SEG, rn.y);
        // Previous section: rotate about the near landing pivot by +turnCur.
        vec2 rm = rot2(gTurnCur) * vec2(p.x, p.z);
        vec3 pm = vec3(rm.x, p.y - SLOPE * SEG, rm.y + SEG);

        float t0 = gRoomCur, t1 = roomType(gKc + 1.0), tm = roomType(gKc - 1.0);
        float a0 = sectionAir(q0, t0);
        float a1 = sectionAir(pp, t1);
        float am = sectionAir(pm, tm);

        float air = min(a0, min(a1, am));   // union of walkable air
        float scene = -air;                  // concrete shell
        float mat = MAT_CONCRETE;

        scene = min(scene, sectionSolid(q0, t0, a0));
        scene = min(scene, sectionSolid(pp, t1, a1));
        scene = min(scene, sectionSolid(pm, tm, am));

        float rail = min(max(railSDF(q0), a0),
                     min(max(railSDF(pp), a1), max(railSDF(pm), am)));
        if (rail < scene) { scene = rail; mat = MAT_STEEL; }

        return vec2(scene, mat);
    }

    vec3 calcNormal(vec3 p) {
        vec2 e = vec2(0.0018, 0.0);
        float d = map(p).x;
        return normalize(vec3(
            map(p + e.xyy).x - d,
            map(p + e.yxy).x - d,
            map(p + e.yyx).x - d
        ));
    }

    float softShadow(vec3 ro, vec3 rd, float mint, float maxt) {
        float res = 1.0;
        float t = mint;
        for (int i = 0; i < 22; i++) {
            float h = map(ro + rd * t).x;
            if (h < 0.001) return 0.0;
            res = min(res, 9.0 * h / t);
            t += clamp(h, 0.05, 0.7);
            if (t > maxt) break;
        }
        return clamp(res, 0.0, 1.0);
    }

    float calcAO(vec3 p, vec3 n) {
        float occ = 0.0;
        float sca = 1.0;
        for (int i = 0; i < 5; i++) {
            float hr = 0.02 + 0.13 * float(i);
            float dd = map(p + n * hr).x;
            occ += (hr - dd) * sca;
            sca *= 0.74;
        }
        return clamp(1.0 - 1.5 * occ, 0.0, 1.0);
    }

    // Narkowicz ACES filmic approximation.
    vec3 aces(vec3 x) {
        float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
        return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
    }

    void main() {
        vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;

        // Re-anchor the world to the camera's current section every frame.
        gKc = floor(uPlayerZ / SEG);
        gU = uPlayerZ - gKc * SEG;
        gTurnCur = radians(turnDeg(gKc));
        gTurnNext = radians(turnDeg(gKc + 1.0));
        gRoomCur = roomType(gKc);

        float age = clamp(uIteration * 0.12, 0.0, 0.7);

        // --- Camera: above the descending treads, turning its head toward the
        //     next corridor as it nears the landing ---
        float camFloor = -SLOPE * gU;
        vec3 ro = vec3(0.0, camFloor + EYE, gU);

        float basePitch = -atan(SLOPE);
        float camYaw = gTurnNext * smoothstep(0.6, 1.0, gU / SEG) + uPointer.x * 0.5;
        float pitch = basePitch + uPointer.y * 0.30;
        vec3 fwd = vec3(sin(camYaw) * cos(pitch), sin(pitch), cos(camYaw) * cos(pitch));
        vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
        vec3 up = cross(right, fwd);
        vec3 rd = normalize(uv.x * right + uv.y * up + 1.4 * fwd);

        // --- March ---
        float t = 0.0;
        float mat = 0.0;
        bool hit = false;
        for (int i = 0; i < MAX_STEPS; i++) {
            vec3 p = ro + rd * t;
            vec2 res = map(p);
            if (res.x < SURF_DIST) { mat = res.y; hit = true; break; }
            t += res.x;
            if (t > MAX_DIST) break;
        }

        // --- Per-room mood ---
        vec3 L = normalize(vec3(-0.55, 0.72, -0.30));
        float keyBoost = 1.0;
        vec3 fogCol = vec3(0.12, 0.14, 0.17);
        if (gRoomCur == 1.0)      { keyBoost = 1.4; fogCol = vec3(0.16, 0.19, 0.24); } // atrium — airy
        else if (gRoomCur == 2.0) { keyBoost = 0.8; fogCol = vec3(0.13, 0.12, 0.11); } // vault — warm dim
        else if (gRoomCur == 3.0) { keyBoost = 1.05; fogCol = vec3(0.13, 0.14, 0.17); } // crossing — eerie but readable
        else if (gRoomCur == 4.0) { keyBoost = 2.2; fogCol = vec3(0.45, 0.45, 0.42); } // skylight — bright
        else if (gRoomCur == 5.0) { keyBoost = 1.1; fogCol = vec3(0.15, 0.15, 0.16); } // gallery
        vec3 keyCol = vec3(1.0, 0.92, 0.74) * keyBoost;
        vec3 sky = vec3(0.34, 0.40, 0.50);
        vec3 grd = vec3(0.17, 0.15, 0.12);

        // Background: brighter overhead so skylight openings read as light.
        vec3 col = mix(fogCol, vec3(0.78, 0.76, 0.68) * keyBoost, smoothstep(0.1, 0.7, rd.y));

        if (hit) {
            vec3 p = ro + rd * t;
            vec3 n = calcNormal(p);
            vec3 V = -rd;
            float pFloor = -SLOPE * p.z;   // floor height beneath this point (current frame)

            vec3 albedo;
            float specAmt;
            if (mat == MAT_STEEL) {
                albedo = vec3(0.30, 0.32, 0.36);
                specAmt = 0.55;
            } else {
                float stain = fbm(p.xz * 0.6 + p.y * 0.3);
                float streak = fbm(vec2(p.x * 3.0, p.y * 0.5));
                float c = 0.55 + 0.12 * stain - 0.14 * streak;
                c *= 1.0 - 0.20 * age;
                albedo = vec3(c, c * 0.99, c * 0.96);
                specAmt = 0.07;
            }

            float ao = calcAO(p, n);
            float sh = softShadow(p + n * 0.03, L, 0.06, 26.0);
            float dif = max(dot(n, L), 0.0) * sh;
            vec3 amb = mix(grd, sky, n.y * 0.5 + 0.5);

            vec3 H = normalize(L + V);
            float spec = pow(max(dot(n, H), 0.0), mix(18.0, 130.0, specAmt)) * specAmt * sh;
            float fres = pow(1.0 - max(dot(n, V), 0.0), 4.0);

            col = albedo * (amb * ao + keyCol * dif);
            col += keyCol * spec;
            col += amb * fres * 0.25;

            // Crossing chamber: a cool fill from below reveals the inverted
            // (Escher) ceiling stairs that otherwise sit in pure shadow.
            if (gRoomCur == 3.0) {
                vec3 Lf = normalize(vec3(0.15, -0.9, 0.2));
                col += albedo * max(dot(n, Lf), 0.0) * vec3(0.42, 0.46, 0.60) * 1.2 * ao;
            }

            // Blown-out window slots high on the side walls — periodic bloom sources.
            float onWall = step(2.6, abs(p.x));
            float winZ = pow(0.5 + 0.5 * sin(p.z * 0.55), 14.0);
            float winY = smoothstep(pFloor + 1.8, pFloor + 3.6, p.y);
            col += vec3(1.0, 0.92, 0.74) * onWall * winZ * winY * (2.2 + keyBoost);

            float fogF = 1.0 - exp(-0.020 * t);
            col = mix(col, fogCol, fogF);
        }

        // --- Cheap volumetric dust shafts (heavy effects only) ---
        if (uHeavy > 0.5) {
            float gr = 0.0;
            float tt = 2.0;
            for (int i = 0; i < 18; i++) {
                vec3 sp = ro + rd * tt;
                float band = pow(0.5 + 0.5 * sin(sp.z * 0.55), 8.0);
                float high = smoothstep(-SLOPE * sp.z + 1.5, -SLOPE * sp.z + 4.0, sp.y);
                gr += band * high;
                tt += 1.0;
                if (tt > min(t, 40.0)) break;
            }
            col += keyCol * (gr / 18.0) * 0.5;
        }

        gl_FragColor = vec4(aces(col), 1.0);
    }
`

export const fsPost = `
    precision highp float;
    uniform sampler2D uTexture;
    uniform vec2 iResolution;
    uniform float iTime;
    uniform vec2 uPointer;
    uniform float uIteration;
    uniform float uPlayerZ;
    uniform float uBrightness;

    float hash(vec2 p) {
        return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453123);
    }

    void main() {
        vec2 uv = gl_FragCoord.xy / iResolution.xy;
        vec2 d = uv - 0.5;
        float r2 = dot(d, d);

        // Subtle lens: gentle barrel + edge chromatic aberration (photographic, not CRT).
        vec2 wuv = uv + d * r2 * 0.05;
        vec2 ca = d * (r2 + 0.01) * 0.05;

        vec3 col;
        col.r = texture2D(uTexture, wuv - ca).r;
        col.g = texture2D(uTexture, wuv).g;
        col.b = texture2D(uTexture, wuv + ca).b;

        // Threshold bloom — the blown-out windows + light shafts spill softly.
        float px = 1.0 / iResolution.y;
        vec3 bloom = vec3(0.0);
        for (int i = 1; i <= 4; i++) {
            float o = float(i) * 2.5 * px;
            bloom += max(texture2D(uTexture, wuv + vec2(o, o)).rgb - 0.62, 0.0);
            bloom += max(texture2D(uTexture, wuv + vec2(-o, o)).rgb - 0.62, 0.0);
            bloom += max(texture2D(uTexture, wuv + vec2(o, -o)).rgb - 0.62, 0.0);
            bloom += max(texture2D(uTexture, wuv + vec2(-o, -o)).rgb - 0.62, 0.0);
            bloom += max(texture2D(uTexture, wuv + vec2(o, 0.0)).rgb - 0.62, 0.0);
            bloom += max(texture2D(uTexture, wuv + vec2(-o, 0.0)).rgb - 0.62, 0.0);
            bloom += max(texture2D(uTexture, wuv + vec2(0.0, o)).rgb - 0.62, 0.0);
            bloom += max(texture2D(uTexture, wuv + vec2(0.0, -o)).rgb - 0.62, 0.0);
        }
        col += bloom * 0.07;

        // Fluorescent flicker — gets twitchier the deeper you've descended.
        float age = clamp(uIteration * 0.10, 0.0, 0.4);
        float flick = 1.0 - age * 0.5 * step(0.96, hash(vec2(floor(iTime * 14.0), 7.0)));
        col *= flick;

        // Film grain
        float g = (hash(gl_FragCoord.xy + fract(iTime) * 91.7) - 0.5) * 0.05;
        col += g;

        // Vignette
        float vig = smoothstep(1.05, 0.32, length(d));
        col *= mix(0.5, 1.0, vig);

        col *= uBrightness;

        gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
`
