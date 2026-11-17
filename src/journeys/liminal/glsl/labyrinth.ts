export const labyrinthGlsl = `    // ---- SECTOR 5: THE STAIR LABYRINTH ----
    //
    // The walked stair is the floor's own gait built in stone: every 3.25 m
    // a landing for 1.95 m, then a flight of twelve risers up the 3.44 m to
    // the next, sixteen storeys, a newel with a lamp on each landing and an
    // iron balustrade both sides. It ends at a broken landing over the drop.
    // Round it, a lattice of 20 m cells: in some a module of two landings and
    // a flight of sixteen risers with a parapet and a lamp of its own, turned
    // to any of twelve orientations, so stairs hang sideways and upside down
    // in the void. A cell whose centre is near the walked line stays empty.

    #define LAB_CYCLE 3.25
    #define LAB_LAND 1.95
    #define LAB_STOREY 3.44
    #define LAB_RISE 0.286667
    #define LAB_TREAD 0.118182
    #define LAB_CELL 20.0

    // The route's own sway in sector 5 (getCamX), by z5 = loop-local z - 280.
    float labSway(float z5) {
        return (z5 >= 0.0 && z5 < 80.0) ? sin(z5 / 80.0 * 3.14159265 * 3.0) * 3.5 : 0.0;
    }

    float labBox2(vec2 p, vec2 b) {
        vec2 d = abs(p) - b;
        return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
    }

    // A flight in profile: q.x from its first riser, q.y from the landing at
    // its foot; n risers of rise r on treads tr, a soffit th under the inner corners.
    float labFlight(vec2 q, float r, float tr, float n, float th) {
        float j = floor(q.x / tr);
        float d = 1000.0;
        for (int i = -1; i <= 1; i++) {
            float k = clamp(j + float(i), 0.0, n - 2.0);
            d = min(d, max(abs(q.x - (k + 0.5) * tr) - 0.5 * tr, q.y - (k + 1.0) * r));
        }
        float soffit = (q.x * r - q.y * tr) / sqrt(r * r + tr * tr) - th;
        return max(max(d, soffit), max(-q.x, q.x - (n - 1.0) * tr));
    }

    // Distance from a point to a segment, in profile.
    float labSeg(vec2 p, vec2 a, vec2 b) {
        vec2 pa = p - a, ba = b - a;
        return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
    }

    // A cell's orientation: x = permutation (0..2), y and z = the flips of
    // the module's x and up, w = 1 if its lamp is lit, 0 if the cell is empty: -1.
    vec4 labCell(vec3 c, float base) {
        float h1 = hash(vec2(dot(c, vec3(0.131, 0.217, 0.173)), 3.7));
        float h2 = hash(vec2(dot(c, vec3(0.311, 0.097, 0.251)), 9.1));
        float h3 = hash(vec2(dot(c, vec3(0.071, 0.389, 0.113)), 5.3));
        // clear of the walked line: the climb, the drop, the floor it lands on
        float cz5 = c.z - base;
        vec2 cp = vec2(cz5, c.y);
        float dl = min(labSeg(cp, vec2(-10.0, -124.0), vec2(52.0, -69.0)),
                   min(labSeg(cp, vec2(52.0, -69.0), vec2(72.0, -178.0)), labSeg(cp, vec2(72.0, -178.0), vec2(110.0, -178.0))));
        if (h1 < 0.42 || length(vec2(dl, c.x - labSway(cz5))) < 11.0 || c.y < -170.0) return vec4(-1.0);
        float upright = step(h2, 0.4);
        float perm = upright > 0.5 ? 0.0 : floor(fract(h2 * 7.31) * 3.0);
        float fx = fract(h3 * 5.17) < 0.5 ? -1.0 : 1.0;
        float fy = upright > 0.5 ? 1.0 : (fract(h3 * 11.3) < 0.5 ? -1.0 : 1.0);
        return vec4(perm, fx, fy, step(0.3, fract(h1 * 13.7)));
    }

    vec3 labOrient(vec3 v, vec4 o) {
        vec3 m = o.x < 0.5 ? v : (o.x < 1.5 ? v.yzx : v.zxy);
        return m * vec3(o.y, o.z, 1.0);
    }

    // The sector's solid. part: 1 the walked stone, 2 iron, 3 a lamp globe,
    // 4 a module's stone, 5 the floor of the void. lm is the point in the
    // hit module's frame and orient that module's orientation.
    float labField(vec3 p, float z5, float cF, out float part, out vec3 lm, out vec4 orient) {
        float W = 2.5 * cF;
        float u = p.x - labSway(z5);
        float stone = 1000.0;
        float iron = 1000.0;
        float globe = 1000.0;

        // --- the walked stair: this cycle and its neighbours ---
        float kc = floor(z5 / LAB_CYCLE);
        for (int i = -1; i <= 1; i++) {
            float k = kc + float(i);
            if (k < 0.0 || k > 16.0) continue;
            float zk = k * LAB_CYCLE;
            float Yk = -125.0 + k * LAB_STOREY;
            vec2 q = vec2(z5 - zk, p.y - Yk);
            if (k > 15.5) {
                // the last landing, broken off over the drop
                float edge = 1.1 + 0.35 * sin(u * 2.7 + 1.3) + 0.18 * sin(u * 7.9);
                float brk = max(labBox2(q - vec2(0.5 * edge, -0.2), vec2(0.5 * edge, 0.2)), abs(u) - W);
                stone = min(stone, brk);
                continue;
            }
            // the first landing reaches back into the hydraulics
            float l0 = k < 0.5 ? 12.0 : 0.0;
            float land = labBox2(q - vec2(0.5 * (LAB_LAND - l0), -0.175), vec2(0.5 * (LAB_LAND + l0), 0.175));
            float fl = labFlight(vec2(q.x - LAB_LAND, q.y), LAB_RISE, LAB_TREAD, 12.0, 0.3);
            stone = min(stone, max(min(land, fl), abs(u) - W));

            // the balustrade: a rail 0.95 m over the landing and the pitch line, balusters every 0.36 m
            float zf = q.x - LAB_LAND;
            float slope = (zf > 0.0 && zf < 1.3) ? LAB_STOREY / 1.3 : 0.0;
            float railY = 0.95 + clamp(zf * LAB_STOREY / 1.3, 0.0, LAB_STOREY);
            float ux = abs(u) - (W - 0.06);
            float zr = q.x + l0;
            if (zr > -0.05 && zr < LAB_CYCLE + l0 + 0.05) {
                iron = min(iron, length(vec2(ux, (q.y - railY) / sqrt(1.0 + slope * slope))) - 0.032);
                float zb = mod(z5, 0.36) - 0.18;
                iron = min(iron, max(length(vec2(ux, zb)) - 0.015, max(q.y - railY, railY - 1.25 - q.y)));
            }
            // a newel with a lamp at the head of every landing, the sides alternating
            float side = mod(k, 2.0) < 0.5 ? 1.0 : -1.0;
            vec3 nq = vec3(u - side * (W - 0.06), q.y, q.x - 0.12);
            iron = min(iron, max(length(nq.xz) - 0.045, abs(nq.y - 0.65) - 0.65));
            globe = min(globe, length(nq - vec3(0.0, 1.42, 0.0)) - 0.11);
        }

        // --- the floor the drop lands on ---
        float floorD = p.y + 180.0;

        // --- the lattice ---
        vec3 c = (floor(p / LAB_CELL) + 0.5) * LAB_CELL;
        vec3 l = p - c;
        float wall = 0.5 * LAB_CELL - max(abs(l.x), max(abs(l.y), abs(l.z)));
        float modD = wall + 5.0;
        float mod5 = 1000.0;
        orient = labCell(c, p.z - z5);
        lm = vec3(0.0);
        if (orient.x > -0.5) {
            vec3 m = labOrient(l, orient);
            m.y += 1.5;
            lm = m;
            vec2 q = vec2(m.z, m.y);
            float la = labBox2(q - vec2(-2.9, -0.15), vec2(0.8, 0.15));
            float lb = labBox2(q - vec2(2.9, 2.85), vec2(0.8, 0.15));
            float fl = labFlight(vec2(q.x + 2.1, q.y), 0.1875, 0.28, 16.0, 0.22);
            float md = max(min(min(la, lb), fl), abs(m.x) - 1.2);
            // a solid parapet on one side, following the landings and the pitch
            float bz = clamp(q.x + 2.1, 0.0, 4.2);
            float pb = bz * (3.0 / 4.2);
            float ps = (q.x > -2.1 && q.x < 2.1) ? 3.0 / 4.2 : 0.0;
            float par = max(max(abs(m.x - 1.26) - 0.06, (abs(q.y - pb - 0.3) - 0.6) / sqrt(1.0 + ps * ps)), abs(q.x) - 3.7);
            md = min(md, par);
            // its newel and lamp
            vec3 nq = vec3(m.x + 1.08, m.y, m.z + 3.55);
            float post = max(length(nq.xz) - 0.04, abs(nq.y - 0.62) - 0.62);
            float gl = length(nq - vec3(0.0, 1.36, 0.0)) - 0.1;
            mod5 = md;
            iron = min(iron, post);
            globe = min(globe, gl);
        }

        float d = min(min(stone, iron), min(globe, min(floorD, mod5)));
        part = d == stone ? 1.0 : (d == iron ? 2.0 : (d == globe ? 3.0 : (d == mod5 ? 4.0 : 5.0)));
        return min(d, modD);
    }

    // How much of the labyrinth's look a route position has, and how far the
    // camera's clearance tightens to let the walked treads stand under it.
    float labWeight(float z) {
        if (z >= 2000.0) return 0.0;
        float lz = mod(z, 500.0);
        return smoothstep_custom(282.0, 292.0, lz) * (1.0 - smoothstep_custom(352.0, 362.0, lz));
    }

    float labTight(float lz) {
        return smoothstep_custom(284.0, 290.0, lz) * (1.0 - smoothstep_custom(328.0, 332.0, lz));
    }

    float labNoise(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float n = dot(mod(i, 289.0), vec3(1.0, 57.0, 113.0));
        return mix(mix(mix(hash1d(n), hash1d(n + 1.0), f.x), mix(hash1d(n + 57.0), hash1d(n + 58.0), f.x), f.y),
                   mix(mix(hash1d(n + 113.0), hash1d(n + 114.0), f.x), mix(hash1d(n + 170.0), hash1d(n + 171.0), f.x), f.y), f.z);
    }

    // A lamp: lit, stuttering or dead. A few stutter on the first lap; the laps put them out.
    float labLamp(float id, float decay) {
        float h = hash(vec2(id, 41.3));
        float on = step(decay * 1.25, h);
        if (h < decay * 1.25 + 0.06 + decay * 0.5) {
            float tick = mod(floor(iTime * 12.0), 97.0);
            on *= 0.2 + 0.8 * step(0.4, hash(vec2(tick, id)));
        }
        return on;
    }

    vec3 labLampColour(float decay) {
        return mix(vec3(1.0, 0.70, 0.40), vec3(1.0, 0.34, 0.18), decay);
    }

    // The walked lamp at the head of landing k, in world space.
    vec3 labLampAt(float k, float base, float W) {
        float side = mod(k, 2.0) < 0.5 ? 1.0 : -1.0;
        float zk = k * LAB_CYCLE + 0.12;
        return vec3(labSway(zk) + side * (W - 0.06), -125.0 + k * LAB_STOREY + 1.42, base + zk);
    }

    // The haze: lit from far above, black below, warmed by the lamps.
    vec3 labFog(vec3 rd, float lp) {
        vec3 c = mix(vec3(0.018, 0.016, 0.015), vec3(0.150, 0.140, 0.125), smoothstep_custom(-0.7, 0.9, rd.y));
        float up = max(rd.y, 0.0);
        up *= up; up *= up;
        c += vec3(0.20, 0.18, 0.15) * up;
        return mix(c, c * vec3(1.3, 0.45, 0.4), clamp(lp * 0.18, 0.0, 0.9));
    }

    // A surface of the labyrinth, lit: the walked lamps, a module's own, the
    // skylight far above and what the void gives back.
    vec3 shadeLab(vec3 p, vec3 n, vec3 rd, float ao, float dist) {
        float lp = floor(p.z / 500.0);
        float decay = clamp(lp * 0.15, 0.0, 0.95);
        float cF = 1.0 - clamp(lp * 0.14, 0.0, 0.72);
        float W = 2.5 * cF;
        float z5 = mod(p.z, 500.0) - 280.0;
        float base = p.z - z5;
        float part;
        vec3 lm;
        vec4 orient;
        labField(p, z5, cF, part, lm, orient);
        vec3 lampC = labLampColour(decay);
        float u = p.x - labSway(z5);
        // grain fades to its mean with the pixel's footprint
        float lod = 1.0 / (1.0 + dist * 0.06);
        float grain = 0.5 + (labNoise(p * 3.1) * 0.6 + labNoise(p * 9.7) * 0.4 - 0.5) * lod;

        // --- the surface ---
        vec3 albedo = vec3(0.56, 0.53, 0.48);
        float gloss = 0.05;
        vec3 mn = labOrient(n, orient);
        if (part < 1.5) {
            // limestone: a tone a step and a slab, the treads worn pale down the middle
            float k = floor(z5 / LAB_CYCLE);
            float zc = z5 - k * LAB_CYCLE - LAB_LAND;
            float id = zc > 0.0 ? floor(zc / LAB_TREAD) : floor(u / 1.25) * 7.0 + floor(zc / 0.975) * 3.0 - 40.0;
            albedo *= 0.86 + 0.16 * hash(vec2(id + k * 17.0, lp + 3.0));
            albedo *= 0.8 + 0.4 * grain;
            if (n.y > 0.6) {
                float wear = exp(-u * u * 0.8);
                albedo = mix(albedo, albedo * 1.14 + 0.015, wear * 0.55);
                gloss = 0.08 + 0.3 * wear;
                if (zc < 0.0) {
                    vec2 j = abs(fract(vec2(u / 1.25, zc / 0.975)) - 0.5);
                    albedo *= 1.0 - 0.35 * smoothstep_custom(0.47, 0.5, max(j.x, j.y)) * lod;
                }
                albedo *= mix(1.0, 0.6, smoothstep_custom(W - 0.6, W - 0.05, abs(u)));
            } else if (n.y < -0.4) {
                // the soffit, damp
                albedo *= 0.5 + 0.3 * labNoise(vec3(p.x * 0.7, p.y * 0.25, p.z * 0.7));
            } else {
                // risers and string faces: run-off from the treads above
                albedo *= 0.78 + 0.22 * labNoise(vec3(p.x * 7.0, p.y * 0.5, p.z * 7.0));
            }
        } else if (part < 2.5) {
            albedo = vec3(0.045, 0.042, 0.040) * (0.8 + 0.4 * grain);
            gloss = 0.7;
        } else if (part < 4.5) {
            // a module: dressed stone in 0.6 m courses, dusty where its own up faces, stained beneath
            albedo = vec3(0.50, 0.48, 0.44) * (0.8 + 0.4 * grain);
            albedo *= 0.88 + 0.2 * hash(vec2(floor(lm.y / 0.6) + floor(lm.z / 1.1) * 5.0, dot(orient, vec4(3.0, 5.0, 7.0, 11.0))));
            float course = abs(fract(lm.y / 0.6) - 0.5);
            if (abs(mn.y) < 0.5) albedo *= 1.0 - 0.3 * smoothstep_custom(0.46, 0.5, course) * lod;
            if (mn.y > 0.6) albedo = albedo * 1.06 + 0.02;
            if (mn.y < -0.5) albedo *= 0.55;
        } else {
            // the floor of the void: wet flags
            vec2 j = abs(fract(p.xz / vec2(1.4, 0.9)) - 0.5);
            albedo = vec3(0.20, 0.19, 0.18) * (0.75 + 0.5 * grain) * (1.0 - 0.4 * smoothstep_custom(0.46, 0.5, max(j.x, j.y)));
            gloss = 0.5;
        }
        albedo = mix(albedo, albedo * vec3(1.05, 0.42, 0.36), clamp(lp * 0.18, 0.0, 0.9) * 0.8);

        // --- the light ---
        vec3 r = reflect(rd, n);
        vec3 E = vec3(0.0);
        vec3 S = vec3(0.0);
        float k0 = clamp(floor(z5 / LAB_CYCLE), 0.0, 15.0);
        for (int i = -1; i <= 2; i++) {
            float k = k0 + float(i);
            if (k < 0.0 || k > 15.0) continue;
            vec3 v = labLampAt(k, base, W) - p;
            float d2 = dot(v, v);
            vec3 l = v * inversesqrt(d2);
            float s = labLamp(k + lp * 20.0, decay) * 4.5 / (d2 + 0.5);
            E += lampC * s * max(dot(n, l), 0.0);
            float rl = max(dot(r, l), 0.0);
            rl *= rl; rl *= rl; rl *= rl; rl *= rl;
            S += lampC * s * rl;
        }
        if (part > 3.5 && orient.w > 0.5) {
            vec3 v = vec3(-1.08, 1.36, -3.55) - lm;
            float d2 = dot(v, v);
            E += lampC * max(dot(mn, v * inversesqrt(d2)), 0.0) * 1.6 / (d2 + 0.8);
        }
        vec3 Ls = normalize(vec3(0.25, 1.0, 0.35));
        vec3 sky = vec3(0.50, 0.48, 0.44) * max(dot(n, Ls), 0.0) * 0.9;
        vec3 amb = mix(vec3(0.08, 0.075, 0.07), vec3(0.26, 0.25, 0.235), 0.5 + 0.5 * n.y);
        vec3 col = albedo * ((amb + sky) * (1.0 - 0.5 * decay) * ao + E * (0.4 + 0.6 * ao)) + S * gloss * 0.6;

        if (part > 2.5 && part < 3.5) {
            // a globe: the module's if it is in one, else the landing's
            float on = 0.0;
            if (orient.x > -0.5 && length(lm - vec3(-1.08, 1.36, -3.55)) < 0.25) on = orient.w;
            else on = labLamp(floor(z5 / LAB_CYCLE + 0.4) + lp * 20.0, decay);
            col = mix(albedo * amb, lampC * 1.3, on);
        }
        return col;
    }

    // The globes' glow in the haze, for the lamps ahead on the walked stair.
    vec3 labHalo(vec3 ro, vec3 rd, float tHit) {
        float lp = floor(ro.z / 500.0);
        float decay = clamp(lp * 0.15, 0.0, 0.95);
        float W = 2.5 * (1.0 - clamp(lp * 0.14, 0.0, 0.72));
        float z5 = mod(ro.z, 500.0) - 280.0;
        float base = ro.z - z5;
        float k0 = floor(z5 / LAB_CYCLE);
        vec3 h = vec3(0.0);
        for (int i = -1; i < 8; i++) {
            float k = k0 + float(i);
            if (k < 0.0 || k > 15.0) continue;
            vec3 v = labLampAt(k, base, W) - ro;
            float tc = dot(v, rd);
            if (tc < 0.0 || tc > tHit + 0.3) continue;
            float d2 = max(dot(v, v) - tc * tc, 0.0);
            h += labLamp(k + lp * 20.0, decay) * 0.0016 / (d2 + 0.004 + tc * tc * 0.00005);
        }
        return labLampColour(decay) * h;
    }

`
