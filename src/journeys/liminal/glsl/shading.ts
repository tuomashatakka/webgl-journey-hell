export const shadingGlsl = `    // Standard Normal Calculation
    vec3 calcNormal(vec3 p, float ignoreWater) {
        vec2 e = vec2(1.0, -1.0) * 0.5773 * 0.005;
        return normalize(
            e.xyy * map(p + e.xyy, ignoreWater).x +
            e.yyx * map(p + e.yyx, ignoreWater).x +
            e.yxy * map(p + e.yxy, ignoreWater).x +
            e.xxx * map(p + e.xxx, ignoreWater).x
        );
    }

    // Ambient Occlusion
    float calcAO(vec3 p, vec3 n, float ignoreWater) {
        float occ = 0.0;
        float sca = 1.0;
        for(int i = 0; i < AO_STEPS; i++) {
            float h = 0.02 + AO_SPAN * float(i);
            float d = map(p + h * n, ignoreWater).x;
            occ += (h - d) * sca;
            sca *= AO_DECAY;
        }
        return clamp(1.0 - 2.5 * occ * (5.0 / float(AO_STEPS)), 0.0, 1.0);
    }

    #ifdef LITE
    // What a reflection would have found, without marching for it: the room
    // itself, as dimly as the full build lights what its reflections hit —
    // ceilings at the ambient term, walls a little above it. (Distance fog is
    // the primary hit's to apply, as it is for the real thing.)
    vec3 cheapReflection(vec3 p, vec3 dir) {
        return getBiomeColor(p.z + 6.0) * mix(0.28, 0.42, 1.0 - abs(dir.y));
    }
    #endif


    // Blood and the glowing cracks: what the laps do to any matte surface.
    vec3 decayDecals(vec3 albedo, vec3 p, float lZ, float lp, float decayFactor) {
        // BLOOD DECALS: Large, non-uniform biological projections
        if (decayFactor > 0.01) {
            float splatter = sin(p.x * 0.22 + cos(p.z * 0.15)) * cos(p.y * 0.28) * sin(p.z * 0.14 + sin(p.x * 0.08));
            splatter += sin(p.x * 12.0) * cos(p.z * 15.0) * 0.04;

            // Grows in size and fades in seamlessly depending on decayFactor
            float bloodThresh = mix(0.95, 0.12, decayFactor);
            float sharpSplatter = smoothstep_custom(0.0, 0.08, splatter - bloodThresh);

            vec3 bloodSpill = vec3(0.35, 0.002, 0.005) * (0.15 + 0.85 * smoothstep_custom(-0.2, 0.2, sin(p.y * 8.0)));
            albedo = mix(albedo, bloodSpill, sharpSplatter * 0.96);
        }

        float fCrack = getFloorCrack(p, lZ, lp);
        if (fCrack > 0.01) {
            vec3 crackCol = vec3(1.5, 0.02, 0.01) * (1.0 + 8.0 * decayFactor);
            albedo = mix(albedo, crackCol, fCrack);
        }
        return albedo;
    }

    // ---- THE TILED HALLS: the poolrooms (sector 1) and the hall back up to them (sector 6) ----
    //
    // All of it is shading at the hit point; the map is as it was. The halls
    // are lit by three rows of ceiling panels, one a bay, treated as line
    // lights down the hall, and everything glazed mirrors those panels.

    // How much of the tiled-hall look a route position has.
    float hallWeight(float z) {
        if (z >= 2000.0) return 0.0;
        float lz = mod(z, 500.0);
        float w = 1.0 - smoothstep_custom(50.0, 66.0, lz);
        if (z < 500.0) w = max(w, smoothstep_custom(345.0, 365.0, lz));
        return w;
    }

    // The hall at z, the way the map builds it: floor, ceiling, squeeze, lap.
    void hallFrame(float z, out float fY, out float ceilY, out float cF, out float sl) {
        float lz = mod(z, 500.0);
        sl = floor(z / 500.0);
        if (z < 500.0 && lz > 400.0) sl += smoothstep_custom(400.0, 500.0, lz);
        cF = 1.0 - clamp(sl * 0.14, 0.0, 0.72);
        fY = getFloorY(z);
        ceilY = fY + 7.0 * mix(1.0, 0.45, 1.0 - cF);
    }

    // One panel: lit, flickering or dead. Every one is lit on the first lap
    // but a few that stutter; the laps put them out.
    float panelState(float cell, float row, float decay) {
        float h = hash(vec2(cell, row * 7.3 + 1.7));
        float dead = decay * 1.25;
        float on = step(dead, h) * (0.9 + 0.1 * hash(vec2(row, cell)));
        if (h < dead + 0.07 + decay * 0.5) {
            float tick = mod(floor(iTime * 14.0), 89.0);
            on *= 0.25 + 0.75 * step(0.42, hash(vec2(tick, cell + row * 3.0)));
        }
        return on;
    }

    // A row of panels as a line light at a point: the two nearest panels, eased.
    float rowState(float z, float row, float decay) {
        float zc = z / 6.0 - 0.5;
        float f = fract(zc);
        f = f * f * (3.0 - 2.0 * f);
        return mix(panelState(floor(zc), row, decay), panelState(floor(zc) + 1.0, row, decay), f);
    }

    // The panels on the ceiling plane: x = how lit, y = distance to the nearest panel's edge.
    vec2 hallPanel(vec2 xz, float cF, float decay) {
        float pitch = 8.25 * cF;
        float row = clamp(floor(xz.x / pitch + 0.5), -1.0, 1.0);
        float d = max(abs(xz.x - row * pitch) - 1.2 * cF, abs(mod(xz.y, 6.0) - 3.0) - 1.8);
        float state = panelState(floor(xz.y / 6.0), row, decay);
        return vec2((1.0 - smoothstep_custom(-0.03, 0.03, d)) * state, d);
    }

    // Light through moving water: two ridged webs.
    float hallCaustic(vec2 x, float tm) {
        vec2 q = x * 1.6;
        q += 0.35 * vec2(sin(q.y * 1.3 + tm * 0.9), cos(q.x * 1.1 - tm * 0.7));
        float a = sin(q.x * 1.9 + tm * 0.6) + sin(q.y * 2.3 - tm * 0.8) + sin((q.x + q.y) * 1.4 + tm * 0.5);
        q = x * 2.7 + 11.0;
        q += 0.30 * vec2(cos(q.y * 1.7 - tm * 1.1), sin(q.x * 1.5 + tm * 0.8));
        float b = sin(q.x * 2.1 - tm * 0.7) + sin(q.y * 1.7 + tm * 0.9) + sin((q.x - q.y) * 1.6 - tm * 0.6);
        a = 1.0 - abs(a) / 3.0;
        b = 1.0 - abs(b) / 3.0;
        a *= a; a *= a; a *= a;
        b *= b; b *= b; b *= b;
        return a + 0.6 * b;
    }

    // The slope of the water's surface: four trains of ripples.
    vec2 hallRipple(vec2 x, float tm) {
        vec2 g = vec2(0.0);
        g += vec2(0.80, 0.60) * cos(dot(x, vec2(0.80, 0.60)) * 1.9 + tm * 1.3) * 0.030;
        g += vec2(-0.55, 0.83) * cos(dot(x, vec2(-0.55, 0.83)) * 3.1 - tm * 1.7) * 0.022;
        g += vec2(0.25, -0.97) * cos(dot(x, vec2(0.25, -0.97)) * 5.3 + tm * 2.3) * 0.014;
        g += vec2(-0.93, -0.37) * cos(dot(x, vec2(-0.93, -0.37)) * 8.7 - tm * 3.1) * 0.008;
        return g;
    }

    // A surface of the hall, lit. dist is how far the eye is, for the tile's fade.
    vec3 shadeHall(vec3 p, vec3 n, vec3 rd, float ao, float dist) {
        float fY, ceilY, cF, sl;
        hallFrame(p.z, fY, ceilY, cF, sl);
        float decay = clamp(sl * 0.15, 0.0, 0.95);
        float waterY = fY + 0.3 + sl * 0.6;
        vec3 base = getBiomeColor(p.z);
        // (the hall back up climbs steeply, so its soffit leans: told by where it is, not only by its normal)
        bool isCeil = n.y < -0.25 && p.y > 0.5 * (fY + ceilY);

        // --- the surface ---
        vec3 albedo;
        vec3 nt = n;
        float gloss = 0.0;
        if (isCeil) {
            // painted soffit, in 1.2 m boards
            vec2 b = abs(fract(p.xz / 1.2) - 0.5);
            float seam = smoothstep_custom(0.47, 0.5, max(b.x, b.y)) / (1.0 + dist * 0.08);
            albedo = base * (0.86 - 0.16 * seam);
        } else {
            vec2 uv = abs(n.y) > 0.6 ? p.xz : (abs(n.x) > 0.6 ? p.zy : p.xy);
            vec2 g = uv / 0.25;
            vec2 id = floor(g);
            vec2 f = abs(fract(g) - 0.5);
            float fw = dist * 0.0022 / max(abs(dot(n, rd)), 0.2) / 0.25;
            float w = 0.04 + fw;
            float lod = 1.0 - smoothstep_custom(0.25, 0.8, fw);
            float grout = mix(0.15, smoothstep_custom(0.5 - w, 0.5 - w * 0.35, max(f.x, f.y)), lod);
            float tone = hash(id);
            vec3 tile = base * (0.90 + 0.10 * tone * lod);
            // a few tiles a shade of pool blue, and a course of them round the walls
            tile = mix(tile, base * vec3(0.72, 0.90, 0.98), step(0.93, tone) * 0.6 * lod);
            if (n.y < 0.6) {
                float hgt = p.y - fY;
                float course = step(1.5, hgt) * step(hgt, 1.75);
                tile = mix(tile, base * vec3(0.24, 0.56, 0.72), course);
                // damp just over the water, a tide mark above that
                float wet = p.y - waterY;
                tile *= 0.72 + 0.28 * smoothstep_custom(0.0, 0.35, wet);
                tile *= 1.0 - 0.10 * smoothstep_custom(0.05, 0.0, abs(wet - 0.42 - 0.03 * sin(uv.x * 2.3)));
                // run-off under the soffit
                float run = hash(vec2(floor(uv.x * 3.0), 3.0));
                tile *= 1.0 - 0.22 * step(0.8, run) * smoothstep_custom(2.2 + 2.0 * run, 0.0, ceilY - p.y);
            }
            albedo = mix(tile, base * 0.60, grout);
            gloss = 1.0 - grout;
            // each tile is set a little off flat
            vec2 tilt = (vec2(hash(id + 3.1), hash(id + 7.7)) - 0.5) * 0.05 * lod;
            nt = normalize(n + (abs(n.y) > 0.6 ? vec3(tilt.x, 0.0, tilt.y) : (abs(n.x) > 0.6 ? vec3(0.0, tilt.y, tilt.x) : vec3(tilt.x, tilt.y, 0.0))));
        }
        albedo = decayDecals(albedo, p, mod(p.z, 500.0), sl, decay);

        // --- the light: three rows of panels as line lights ---
        vec3 lamp = mix(vec3(1.0, 0.98, 0.93), vec3(1.0, 0.62, 0.48), decay);
        float pitch = 8.25 * cF;
        // (a line down the hall lights a face that looks along it from both
        // sides, at half strength; the soffit they hang from gets none)
        float E = 0.0;
        if (!isCeil) {
            for (int i = -1; i <= 1; i++) {
                float row = float(i);
                vec2 v = vec2(row * pitch - p.x, ceilY - 0.05 - p.y);
                float d = length(v);
                float ndl = max(dot(nt.xy, v / max(d, 0.001)), 0.0) + 0.5 * abs(nt.z);
                E += rowState(p.z, row, decay) * (0.25 + 0.75 * ndl) * ndl / (0.7 + d);
            }
        }
        // what comes back off the water and the far walls
        vec3 amb = mix(vec3(0.20, 0.27, 0.29), vec3(0.30, 0.31, 0.32), 0.5 + 0.5 * n.y) * (1.0 - 0.45 * decay);
        vec3 col = albedo * (amb * ao + lamp * E * 3.4 * (0.45 + 0.55 * ao));

        vec2 own = hallPanel(p.xz, cF, decay);
        if (isCeil) {
            // the panel itself, a dark frame round it, and its spill on the soffit
            float ribs = 0.92 + 0.08 * cos(p.x * 52.0);
            float frame = smoothstep_custom(0.10, 0.03, abs(own.y - 0.05));
            col *= 1.0 - 0.6 * frame;
            col += albedo * lamp * 0.55 * exp(-max(own.y, 0.0) * 1.1) * rowState(p.z, clamp(floor(p.x / pitch + 0.5), -1.0, 1.0), decay);
            col = mix(col, lamp * ribs, own.x);
        } else {
            // the glaze mirrors the panels
            vec3 r = reflect(rd, nt);
            if (r.y > 0.02) {
                vec3 c = p + r * ((ceilY - p.y) / r.y);
                float fres = 0.04 + 0.96 * pow(1.0 - max(dot(nt, -rd), 0.0), 5.0);
                col += lamp * hallPanel(c.xz, cF, decay).x * fres * gloss * 0.9;
            }
            // light thrown up off the water
            float h = p.y - waterY;
            if (h > 0.0 && h < 3.5) {
                float c = hallCaustic(vec2(p.x + p.z, p.y * 0.7 + p.z * 0.3), iTime);
                col += albedo * lamp * c * 0.38 * exp(-h * 0.8) * E * 3.4 / (1.0 + dist * 0.04);
            }
        }
        return col;
    }

    // The hall as a ray leaving a point finds it, with no march: the ceiling
    // or a side wall. What a reflection settles for when it has no march to
    // spend, or has spent it.
    vec3 hallEnv(vec3 p, vec3 r, float dist) {
        float fY, ceilY, cF, sl;
        hallFrame(p.z, fY, ceilY, cF, sl);
        float tc = r.y > 0.001 ? (ceilY - p.y) / r.y : 100000.0;
        float tw = abs(r.x) > 0.001 ? (sign(r.x) * 12.0 * cF - p.x) / r.x : 100000.0;
        float tt = min(tc, tw);
        vec3 far = getBiomeColor(p.z + 30.0);
        if (tt > 90.0) return far;
        vec3 nq = tc < tw ? vec3(0.0, -1.0, 0.0) : vec3(-sign(r.x), 0.0, 0.0);
        vec3 col = shadeHall(p + r * tt, nq, r, 1.0, dist + tt);
        return mix(col, far, 1.0 - exp(-0.012 * tt));
    }

    // The floor through the water: refracted, absorbed per channel, with the
    // caustics on it and the columns standing in it.
    vec3 hallUnderwater(vec3 p, vec3 n, vec3 wn, vec3 rd, float dist) {
        float fY, ceilY, cF, sl;
        hallFrame(p.z, fY, ceilY, cF, sl);
        vec3 rr = refract(rd, wn, 0.75);
        float path = (0.3 + sl * 0.6) * n.y / max(-dot(rr, n), 0.2);
        vec3 pf = p + rr * path;
        vec3 fl = shadeHall(pf, n, rr, 1.0, dist + path);
        vec2 q = vec2(abs(pf.x) - 4.5 * cF, mod(pf.z + 3.0, 6.0) - 3.0);
        // (the columns stand in the pool, and again where the hall runs back into it)
        float lz = mod(pf.z, 500.0);
        float cols = max(1.0 - smoothstep_custom(50.0, 70.0, lz), smoothstep_custom(450.0, 500.0, lz));
        fl *= 1.0 - 0.65 * cols * smoothstep_custom(0.3, 0.0, max(abs(q.x), abs(q.y)) - 0.45);
        fl *= 0.78 + 1.0 * hallCaustic(pf.xz, iTime) / (1.0 + dist * 0.05);
        vec3 absorb = exp(-(path + 0.35) * vec3(0.60, 0.13, 0.09));
        vec3 body = getBiomeColor(p.z) * vec3(0.05, 0.30, 0.34);
        return fl * absorb + body * (1.0 - absorb.r);
    }

    void main() {
        vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;

        // Synchronize camera track
        float camZ = uPlayerZ;

        float walkBob = abs(sin(iTime * 4.0)) * 0.18 - 0.09;
        float walkSway = cos(iTime * 2.0) * 0.1;

        float loop, sector, descent, setpieceA, setpieceB, blend, localZ, secLen, fallAmt, isCrystal;
        getSegmentData(camZ, loop, sector, descent, setpieceA, setpieceB, blend, localZ, secLen, fallAmt, isCrystal);

        bool is666 = (sector == 666.0);
        if (is666 && fallAmt < 0.5) {
            // Intense scary rumbling screenshakes during the walls sequence
            walkBob += sin(iTime * 85.0) * 0.35;
            walkSway += cos(iTime * 75.0) * 0.35;
        }

        float camX = getCamX(camZ) + walkSway;
        float minCamY = getFloorY(camZ) + getCamOffset(camZ);
        float currentWaterY = -1000.0;

        if (sector == 1.0) {
            currentWaterY = 0.3 + loop * 0.6;
        } else if (sector == 2.0) {
            float t = clamp(localZ / secLen, 0.0, 1.0);
            currentWaterY = mix(0.3 + loop * 0.6, -22.0 + loop * 0.6 * 0.3, pow(t, 0.7));
        }

        float camY = getCamY(camZ) + getCamOffset(camZ) + walkBob;
        camY = max(camY, minCamY + 0.05);
        camY = max(camY, currentWaterY + 1.15);

        // Global descent measure + finale fall distance (used for FOV & perpetual drift)
        float gd = loop + (is666 ? descent : clamp(mod(camZ, 500.0) / 360.0, 0.0, 0.999));
        float zFinale = max(camZ - 2000.0, 0.0);

        // Perpetual always-on drift (walk-speed independent)
        float driftAmt = mix(0.06, 0.5, clamp(zFinale / 300.0, 0.0, 1.0));

        vec3 ro = vec3(camX, camY, camZ);
        ro.x += sin(iTime * 0.23) * driftAmt;
        ro.y += cos(iTime * 0.17) * driftAmt * 0.6;

        vec3 ta = vec3(
            getCamX(camZ + 15.0),
            getCamY(camZ + 15.0) + getCamOffset(camZ + 15.0),
            camZ + 15.0
        );

        // The camera faces +z with right = cross(fwd, Y) = -x, so a pointer on
        // the right moves the target toward -x.
        ta.xy += vec2(-uPointer.x * 6.8, uPointer.y * 5.5);

        // Continuous fall pitch driven by fallAmt (keeps the up-vector stable, no straight-down snap)
        ta.y -= fallAmt * 22.0;
        vec3 fwd = ta - ro;
        fwd.z = mix(fwd.z, fwd.z * 0.15, fallAmt);
        ta = ro + fwd;
        vec3 cw = normalize(ta - ro);
        vec3 cp = vec3(0.0, 1.0, 0.0);

        vec3 cu = normalize(cross(cw, cp));
        vec3 cv = cross(cu, cw);

        // Gentle continuous roll proportional to fallAmt
        float tiltAngle = fallAmt * 0.15 * sin(iTime * 0.7);

        if (abs(tiltAngle) > 0.01) {
            float cT = cos(tiltAngle), sT = sin(tiltAngle);
            vec3 original_cu = cu;
            cu = original_cu * cT - cv * sT;
            cv = original_cu * sT + cv * cT;
        }

        // Continuous FOV: focalLength is inverse FOV (smaller = wider).
        float f = mix(1.0, 0.40, clamp(gd / 3.0, 0.0, 1.0));
        if (zFinale > 0.0) {
            f = mix(0.40, 0.24, clamp(zFinale / 400.0, 0.0, 1.0));
        }
        float focalLength = max(f, 0.22);

        vec3 rd = normalize(uv.x * cu + uv.y * cv + focalLength * cw);

        // --- PRIMARY RAYMARCH ---
        float t = 0.0;
        float matID = 0.0;
        float godRayAccum = 0.0;
        float decayFactor = clamp(loop * 0.15, 0.0, 0.9);

        float crystalGlow = 0.0;
        float fogTension = 0.0;
        float voidGlow = 0.0;

        for (int i = 0; i < MAX_STEPS; i++) {
            if (uHeavy < 0.5 && i >= 50) break;
            vec3 p = ro + rd * t;
            vec2 res = map(p, 0.0);

        #ifndef LITE
            // Accumulate volumetric oxblood vein/smoke glow during sector 666 falls (heavy effects only)
            if (uHeavy > 0.5) {
                float l_g, s_g, dc_g, sa_g, sb_g, bl_g, lZ_g, sLen_g, iF_g, iC_g;
                getSegmentData(p.z, l_g, s_g, dc_g, sa_g, sb_g, bl_g, lZ_g, sLen_g, iF_g, iC_g);
                if (s_g == 666.0 && iF_g > 0.3) {
                    // Rising red flame-smoke tendrils near surfaces (vein fog tension)
                    float vt = veinField(p, iTime);
                    fogTension += max(0.0, 0.012 - res.x) * (0.5 + vt) * iF_g;
                    voidGlow += vt * exp(-abs(res.x) * 4.0) * 0.02 * iF_g;
                }
            }

            if (uHeavy > 0.5 && decayFactor > 0.05) {
                float l, s, dc, sa, sb, bl, lZ, sLen, iF, iC;
                getSegmentData(p.z, l, s, dc, sa, sb, bl, lZ, sLen, iF, iC);
                float fY_p = getFloorY(p.z);
                float heightAboveFloor = p.y - fY_p;
                if (heightAboveFloor > 0.0 && heightAboveFloor < 15.0) {
                    float fCrack = getFloorCrack(p, lZ, loop);
                    godRayAccum += fCrack * exp(-heightAboveFloor * 0.28) * 0.02 * (1.0 + 3.0 * decayFactor);
                }
            }
        #endif

            if (res.x < SURF_DIST) { matID = res.y; break; }
            if (t > MAX_DIST) break;
            t += res.x;
        }

        vec3 col = vec3(0.0);
        vec3 fogColor = getBiomeColor(ro.z + 30.0);
        vec3 sunDir = normalize(vec3(0.3, 0.8, 0.1));

        if (t < MAX_DIST) {
            vec3 p = ro + rd * t;
            float l_p, s_p, dc_p, sa_p, sb_p, bl_p, lZ_p, sLen_p, fA_p, iC_p;
            getSegmentData(p.z, l_p, s_p, dc_p, sa_p, sb_p, bl_p, lZ_p, sLen_p, fA_p, iC_p);

            // The pool's water lies level, so its normal needs no taps.
            vec3 n = vec3(0.0, 1.0, 0.0);
            if (matID != MAT_WATER || s_p != 1.0) n = calcNormal(p, 0.0);

            // How much of the tiled halls is in this hit.
            float hw = (s_p == 666.0) ? 0.0 : hallWeight(p.z);

        #ifdef LITE
            float aoHit = max(calcAO(p, n, 0.0), 0.35);
            #define HIT_AO aoHit
        #else
            #define HIT_AO max(calcAO(p, n, 0.0), 0.35)
        #endif

            if (s_p == 666.0) {
                // Unified ABYSS palette: oxblood rock + glowing lava-blood veins, cross-faded across set-pieces.
                float ao = HIT_AO;
                float dif = max(dot(n, sunDir), 0.0);

                vec3 tint = mix(pieceTint(sa_p), pieceTint(sb_p), bl_p);
                float vInt = mix(pieceVeinInt(sa_p), pieceVeinInt(sb_p), bl_p);
                vec3 albedo = mix(ABYSS_ROCK, ABYSS_DEEP, clamp(dc_p, 0.0, 1.0)) * tint;

                col = albedo * (dif * 0.45 + 0.12) * ao;
                float deepen = 1.0 + dc_p * 0.8;
                col += abyssEmissive(p, iTime, vInt * deepen);
            } else if (matID == MAT_WATER) {
                float flow = iTime * 3.0;
                if (s_p == 2.0) flow = iTime * 12.0;

                vec3 waterNormal = n;
                waterNormal.x += sin(p.x * 6.0 + flow) * 0.06;
                waterNormal.z += cos(p.z * 6.0 + flow * 1.5) * 0.06;
                waterNormal = normalize(waterNormal);
                if (hw > 0.001) {
                    vec2 ripple = hallRipple(p.xz, iTime) / (1.0 + t * 0.05);
                    waterNormal = normalize(mix(waterNormal, normalize(n + vec3(-ripple.x, 0.0, -ripple.y)), hw));
                }

                float fresnel = pow(1.0 - max(dot(waterNormal, -rd), 0.0), 5.0);
                vec3 waterReflDir = reflect(rd, waterNormal);
            #ifdef LITE
                vec3 reflCol = cheapReflection(p, waterReflDir);
                if (hw > 0.001) reflCol = mix(reflCol, hallEnv(p, waterReflDir, t), hw);
            #else
                vec3 reflCol = fogColor;
                float wt = 0.1;
                float wHit = 0.0;

                for (int i = 0; i < 40; i++) {
                    vec3 wp = p + waterReflDir * wt;
                    vec2 wres = map(wp, 1.0);
                    if (wres.x < SURF_DIST) { wHit = 1.0; break; }
                    if (wt > 40.0) break;
                    wt += wres.x;
                }

                if (wt < 40.0) {
                    vec3 wp = p + waterReflDir * wt;
                    vec3 wn = calcNormal(wp, 1.0);
                    float rDif = max(dot(wn, sunDir), 0.0);
                    vec3 rAlbedo = getBiomeColor(wp.z);
                    float rAo = calcAO(wp, wn, 1.0);
                    reflCol = rAlbedo * (rDif * 0.6 + 0.4) * rAo;
                    float hwR = hallWeight(wp.z);
                    if (hwR > 0.001) {
                        vec3 lit = shadeHall(wp, wn, waterReflDir, rAo, t + wt);
                        reflCol = mix(reflCol, mix(lit, fogColor, 1.0 - exp(-0.012 * wt)), hwR);
                    }
                }
                // A march that ran out short of a surface settles for the hall solved in closed form.
                if (hw > 0.001 && wHit < 0.5) reflCol = mix(reflCol, hallEnv(p, waterReflDir, t), hw);
            #endif

                vec3 refrCol = (s_p == 666.0) ? vec3(0.3, 0.01, 0.02) : vec3(0.01, 0.12, 0.16);
                refrCol = getBiomeColor(p.z) * 0.2 + refrCol * 0.8;

                col = mix(refrCol, reflCol, mix(0.12, 0.88, fresnel));
                if (hw > 0.001) {
                    vec3 seen = hallUnderwater(p, n, waterNormal, rd, t);
                    col = mix(col, mix(seen, reflCol, 0.02 + 0.98 * fresnel), hw);
                }
            } else {
                float dif = max(dot(n, sunDir), 0.0);
                float ao = HIT_AO;

                vec3 albedo = getBiomeColor(p.z);

                if (matID == MAT_MATTE) {
                    if (s_p == 1.0 || s_p == 5.0 || s_p == 6.0) {
                        vec3 grid = smoothstep_custom(0.0, 0.05, abs(fract(p * 2.0) - 0.5));
                        float lines = grid.x * grid.y * grid.z;
                        albedo *= mix(0.6, 1.0, lines);
                    }

                    albedo = decayDecals(albedo, p, lZ_p, loop, decayFactor);
                }

                if (matID == MAT_FLESH) {
                    float vein = sin(p.x * 12.0) * cos(p.y * 12.0) * sin(p.z * 12.0);
                    vec3 fleshBase = vec3(0.55, 0.02, 0.04);
                    vec3 veinCol = vec3(0.18, 0.0, 0.12);
                    if (vein > 0.5) fleshBase = mix(fleshBase, veinCol, 0.6);
                    albedo = fleshBase;
                }

                col = albedo * (dif * 0.6 + 0.4) * ao;
                if (matID == MAT_MATTE && hw > 0.001) col = mix(col, shadeHall(p, n, rd, ao, t), hw);

                if (matID == MAT_FLESH) {
                    vec3 refDir = reflect(rd, n);
                    float spec = pow(max(dot(refDir, sunDir), 0.0), 12.0) * 0.4;
                    col += vec3(0.9, 0.15, 0.25) * spec;
                }

                if (matID == MAT_GLASS) {
                    if (isCrystal > 0.5) {
                        // High-tech self-luminous holographic crystal tube simulation
                        vec3 crystalGlowVal = vec3(0.01, 0.65, 0.98) * (0.65 + 0.35 * sin(p.z * 0.9 + iTime * 6.0));
                        crystalGlowVal += vec3(0.12, 0.32, 0.55) * step(0.85, sin(p.z * 1.5 - iTime * 4.0));
                        col = crystalGlowVal;
                    } else {
                        vec3 refDir = reflect(rd, n);
                    #ifdef LITE
                        vec3 refCol = cheapReflection(p, refDir);
                    #else
                        vec3 refCol = fogColor;
                        float rt = 0.05;
                        for (int i = 0; i < 40; i++) {
                            vec3 rp = p + refDir * rt;
                            vec2 rres = map(rp, 0.0);
                            if (rres.x < SURF_DIST) break;
                            if (rt > 50.0) break;
                            rt += rres.x;
                        }

                        if (rt < 50.0) {
                            vec3 rp = p + refDir * rt;
                            vec3 wn = calcNormal(rp, 0.0);
                            float rDif = max(dot(wn, sunDir), 0.0);
                            vec3 rAlbedo = getBiomeColor(rp.z);
                            refCol = rAlbedo * (rDif * 0.6 + 0.4) * max(calcAO(rp, wn, 0.0), 0.35);
                            float rFog = 1.0 - exp(-0.02 * rt);
                            refCol = mix(refCol, getBiomeColor(rp.z + 30.0), rFog);
                        }
                    #endif

                        float fresnel = pow(1.0 - max(dot(n, -rd), 0.0), 5.0);
                        float refAmount = mix(0.15, 0.85, fresnel);
                        col = mix(col, refCol, refAmount);
                    }
                }
            }
        } else {
            if (is666 && fallAmt > 0.5) {
                if (loop < 3.0) {
                    col = vec3(0.04, 0.012, 0.012);
                } else {
                    col = vec3(0.02, 0.004, 0.006);
                }
            } else {
                col = fogColor;
            }
        }

        float fogFactor = 1.0 - exp(-0.012 * t);
        if (is666) {
            fogFactor = 1.0 - exp(-0.025 * t);
        }

        col = mix(col, fogColor, fogFactor);
        col += vec3(1.3, 0.05, 0.01) * godRayAccum;

        // Apply accumulated atmospheric volumetric glows
        if (is666 && fallAmt > 0.5) {
            if (loop < 3.0) {
                col += vec3(1.3, 0.25, 0.05) * crystalGlow * 0.025;
                col += vec3(1.0, 0.12, 0.03) * fogTension * 0.04;
            } else {
                col += vec3(0.8, 0.1, 0.0) * voidGlow * 0.035;
            }
        }

        gl_FragColor = vec4(col, t);
    }
`
