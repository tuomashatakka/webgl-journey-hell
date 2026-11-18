export const labyrinthGlsl = `    // ---- SECTOR 5: THE STAIR LABYRINTH ----
    //
    // A hall after Escher's Relativity: one enclosed space under three
    // gravities. The walked stair is the floor's own gait built in stone:
    // every 3.25 m a landing for 1.95 m, then a flight of twelve risers up the
    // 3.44 m to the next, sixteen storeys, with an iron balustrade both sides.
    // It climbs a courtyard between two plastered walls 26 m apart. The walls
    // are cut into bays (26 m along, 27.52 m up, eight storeys of the climb,
    // so the climb runs through the middle of a bay on the diagonal); each bay
    // keeps one of five gravities: up the hall, along it either way, upside
    // down, or out of the wall itself. In its own gravity a bay has an arched
    // doorway, a balcony with a balustrade before it, a flight along the wall
    // to a landing and an arched window onto a garden in daylight; a bay whose
    // floor is the wall has a stair rising out of it to a plinth and an arched
    // portal. Double stairs, treads on top and on the underside and a rail on
    // each, span the courtyard wall to wall above and below the climb, and a
    // cross wall with a round-arched opening stands over the climb every
    // 26 m. Daylight from one side, the shadows cast, the whole engraved.

    #define LAB_CYCLE 3.25
    #define LAB_LAND 1.95
    #define LAB_STOREY 3.44
    #define LAB_RISE 0.286667
    #define LAB_TREAD 0.118182
    #define LAB_HALF 13.0
    #define LAB_BAY_Z 26.0
    #define LAB_BAY_Y 27.52
    #define LAB_Y0 -122.0

    // The route's own sway in sector 5 (getCamX), by z5 = loop-local z - 280.
    float labSway(float z5) {
        return (z5 >= 0.0 && z5 < 80.0) ? sin(z5 / 80.0 * 3.14159265 * 3.0) * 3.5 : 0.0;
    }

    float labBox2(vec2 p, vec2 b) {
        vec2 d = abs(p) - b;
        return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
    }

    // A round-arched opening: q from the middle of its sill, half width w,
    // jambs h high, a semicircle on them.
    float labArch(vec2 q, float w, float h) {
        return min(labBox2(q - vec2(0.0, 0.5 * h), vec2(w, 0.5 * h)), length(q - vec2(0.0, h)) - w);
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

    // A balustrade over [h0, h1]: q = (along, up, across from its line), a
    // handrail 0.95 m over a base line of the given slope, posts every 0.32 m.
    float labRail(vec3 q, float h0, float h1, float base, float slope) {
        float hh = clamp(q.x, h0, h1);
        float top = base + (hh - h0) * slope + 0.95;
        float rail = length(vec3(q.x - hh, q.z, (q.y - top) / sqrt(1.0 + slope * slope))) - 0.035;
        float pz = mod(q.x - h0, 0.32) - 0.16;
        float post = max(length(vec2(pz, q.z)) - 0.022, max(q.y - top, top - 0.95 - q.y));
        return min(rail, max(post, max(h0 - q.x, q.x - h1)));
    }

    // One wall of the courtyard at a point: the plaster, with the bay's
    // doorway and window in it and its balcony, flight and balustrades on it.
    // kind: 2 iron, 3 plaster, 4 stone, 6 the garden through a window.
    float labWall(vec3 p, float z5, out float kind) {
        float side = p.x < 0.0 ? -1.0 : 1.0;
        float c = abs(p.x) - LAB_HALF;
        float iz = floor((z5 + 0.5 * LAB_BAY_Z) / LAB_BAY_Z);
        float iy = floor((p.y - LAB_Y0 + 0.5 * LAB_BAY_Y) / LAB_BAY_Y);
        float a = z5 - LAB_BAY_Z * iz;
        float b = p.y - (LAB_Y0 + LAB_BAY_Y * iy);
        float h1 = hash(vec2(iz * 7.13 + side * 3.1, iy * 1.37 + 11.0));
        float flip = hash(vec2(iy * 3.1 + side, iz * 5.7)) < 0.5 ? -1.0 : 1.0;
        float wall = -c;
        float stone = 1000.0;
        float iron = 1000.0;
        float win = 1000.0;
        if (h1 < 0.8) {
            // a gravity in the wall's plane: up the hall, along it either way, or upside down
            vec2 hv = h1 < 0.35 ? vec2(a, b) : (h1 < 0.5 ? vec2(-b, a) : (h1 < 0.65 ? vec2(b, -a) : vec2(-a, -b)));
            hv.x *= flip;
            float door = labArch(hv - vec2(-5.0, -6.0), 1.2, 2.6);
            win = labArch(hv - vec2(4.0, -1.0), 1.0, 2.2);
            wall = max(wall, -max(door, c - 0.9));
            wall = max(wall, -max(win, c - 1.5));
            // the balcony before the door, the flight along the wall and its landing
            stone = labBox2(vec2(hv.x + 5.0, hv.y + 6.15), vec2(3.0, 0.15));
            stone = max(stone, abs(c + 1.5) - 1.5);
            float fl = max(labFlight(vec2(hv.x + 2.0, hv.y + 6.0), 0.2, 0.28, 14.0, 0.25), abs(c + 0.8) - 0.8);
            float land = max(labBox2(vec2(hv.x - 2.52, hv.y + 3.35), vec2(0.88, 0.15)), abs(c + 0.8) - 0.8);
            stone = min(stone, min(fl, land));
            iron = labRail(vec3(hv.x, hv.y, c + 2.95), -8.0, -2.0, -6.0, 0.0);
            iron = min(iron, labRail(vec3(hv.x, hv.y, c + 1.55), -2.0, 1.64, -5.8, 0.2 / 0.28));
            iron = min(iron, labRail(vec3(hv.x, hv.y, c + 1.55), 1.64, 3.4, -3.2, 0.0));
        } else {
            // the wall is the floor: a stair rising out of it to a plinth, an arched portal beyond
            vec2 ab = flip > 0.0 ? vec2(a, b) : vec2(b, a);
            float up = -c;
            vec2 q = vec2(ab.x + 4.0, up);
            float j = floor(q.x / 0.28);
            float cols = 1000.0;
            for (int i = -1; i <= 1; i++) {
                float k = clamp(j + float(i), 0.0, 12.0);
                cols = min(cols, max(abs(q.x - (k + 0.5) * 0.28) - 0.14, q.y - (k + 1.0) * 0.2));
            }
            stone = max(max(cols, abs(ab.y) - 1.2), max(-q.x, q.x - 3.64));
            stone = min(stone, labBox2(vec2(ab.x - 0.62, up - 1.4), vec2(0.98, 1.4)));
            stone = max(stone, abs(ab.y) - 1.2);
            float pier = max(labBox2(vec2(ab.x - 1.9, up - 1.7), vec2(0.3, 1.7)), abs(abs(ab.y) - 1.45) - 0.25);
            vec2 ar = vec2(ab.y, up - 3.4);
            float ring = max(abs(length(ar) - 1.45) - 0.25, max(-ar.y, abs(ab.x - 1.9) - 0.3));
            stone = min(stone, min(pier, ring));
            iron = labRail(vec3(ab.x, up, abs(ab.y) - 1.15), -4.0, -0.36, 0.2, 0.2 / 0.28);
        }
        // a bay's furniture stays 5 m inside its edges, so the next bay's cannot be nearer
        float edge = min(0.5 * LAB_BAY_Z - abs(a), 0.5 * LAB_BAY_Y - abs(b)) + 4.5;
        float d = min(wall, min(min(stone, iron), edge));
        kind = stone < min(wall, iron) ? 4.0 : (iron < wall ? 2.0 : (win < 0.0 && c > 1.3 ? 6.0 : 3.0));
        return d;
    }

    // A double stair across the courtyard, in its own frame (x along the
    // span, rising 11.4 m over 16 m): treads on top and on the underside, a
    // balustrade on each, a landing on a wall at either end.
    float labDouble(vec3 q, out float kind) {
        float r = 0.2;
        float tr = 16.0 / 57.0;
        float T = 0.7;
        float x = q.x + 8.0;
        float j = floor(x / tr);
        float d = 1000.0;
        for (int i = -1; i <= 1; i++) {
            float k = clamp(j + float(i), 0.0, 56.0);
            float top = -5.7 + (k + 1.0) * r;
            d = min(d, max(abs(x - (k + 0.5) * tr) - 0.5 * tr, max(q.y - top, top - r - T - q.y)));
        }
        d = max(d, max(-x, x - 16.0));
        d = min(d, labBox2(vec2(q.x + 10.5, q.y + 5.85), vec2(2.5, 0.15)));
        d = min(d, labBox2(vec2(q.x - 10.5, q.y - 5.55), vec2(2.5, 0.15)));
        d = max(d, abs(q.z) - 1.2);
        float s = r / tr;
        vec3 qs = vec3(q.x, q.y, abs(q.z) - 1.15);
        float iron = labRail(qs, -8.0, 8.0, -5.7 + r, s);
        iron = min(iron, labRail(vec3(q.x, -q.y, qs.z), -8.0, 8.0, 5.7 + T, -s));
        kind = iron < d ? 2.0 : 4.0;
        return min(d, iron);
    }

    // The sector's solid. part: 1 the walked stone, 2 iron, 3 plaster,
    // 4 stone, 5 the floor of the void, 6 the garden through a window.
    float labField(vec3 p, float z5, float cF, out float part) {
        float W = 2.5 * cF;
        float u = p.x - labSway(z5);
        float stone = 1000.0;
        float iron = 1000.0;

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
            // a newel with a ball at the head of every landing, both sides
            vec3 nq = vec3(abs(u) - (W - 0.06), q.y, q.x - 0.12);
            iron = min(iron, max(length(nq.xz) - 0.045, abs(nq.y - 0.65) - 0.65));
            iron = min(iron, length(nq - vec3(0.0, 1.36, 0.0)) - 0.08);
        }

        // --- the floor the drop lands on ---
        float floorD = p.y + 180.0;

        // --- the courtyard: its walls, a cross wall over the climb every 26 m, the double stairs ---
        float wk;
        float wallD = labWall(p, z5, wk);

        float zA = z5 < 26.0 ? 13.0 : 39.0;
        float yA = z5 < 26.0 ? -110.5 : -83.0;
        float cross = max(labBox2(vec2(p.x, p.y - yA + 1.25), vec2(LAB_HALF, 12.75)), -labArch(vec2(p.x, p.y - yA + 14.5), 9.0, 14.5));
        cross = max(cross, abs(z5 - zA) - 0.7);

        // below and ahead of the climb in the first two bays, above and behind it in the next two
        float ib = clamp(floor(z5 / LAB_BAY_Z + 0.5), 0.0, 1.0);
        float dk;
        float dbl = labDouble(vec3(p.x * (ib < 0.5 ? 1.0 : -1.0), p.y - (LAB_Y0 + LAB_BAY_Y * ib - 9.0), z5 - (LAB_BAY_Z * ib + 8.0)), dk);
        float ia = clamp(floor(z5 / LAB_BAY_Z + 0.5), 1.0, 2.0);
        float ak;
        float dbu = labDouble(vec3(p.x * (ia < 1.5 ? -1.0 : 1.0), p.y - (LAB_Y0 + LAB_BAY_Y * ia + 9.0), z5 - (LAB_BAY_Z * ia - 8.0)), ak);
        if (dbu < dbl) {
            dbl = dbu;
            dk = ak;
        }

        float d = min(min(stone, iron), min(min(floorD, wallD), min(cross, dbl)));
        part = d == stone ? 1.0 : (d == iron ? 2.0 : (d == floorD ? 5.0 : (d == wallD ? wk : (d == cross ? 3.0 : dk))));
        return d;
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

    // The daylight: from high over the left wall and behind the climb, so the
    // right wall and the risers ahead are in the sun.
    vec3 labSun() {
        return normalize(vec3(-0.45, 0.80, -0.40));
    }

    // The haze: pale, brighter looking up.
    vec3 labFog(vec3 rd, float lp) {
        vec3 c = mix(vec3(0.40, 0.39, 0.37), vec3(0.80, 0.79, 0.76), smoothstep_custom(-0.6, 0.9, rd.y));
        return mix(c, c * vec3(1.2, 0.45, 0.4), clamp(lp * 0.18, 0.0, 0.9));
    }

    // A surface of the labyrinth, lit by the day (sh: how much of the sun
    // reaches it) and engraved: parallel lines across each face, as wide as
    // the face is dark, fading to its tone where they would be under a pixel.
    vec3 shadeLab(vec3 p, vec3 n, vec3 rd, float ao, float sh, float dist) {
        float lp = floor(p.z / 500.0);
        float decay = clamp(lp * 0.15, 0.0, 0.95);
        float cF = 1.0 - clamp(lp * 0.14, 0.0, 0.72);
        float W = 2.5 * cF;
        float z5 = mod(p.z, 500.0) - 280.0;
        float part;
        labField(p, z5, cF, part);
        float u = p.x - labSway(z5);
        float lod = 1.0 / (1.0 + dist * 0.06);
        float grain = 0.5 + (labNoise(p * 3.1) * 0.6 + labNoise(p * 9.7) * 0.4 - 0.5) * lod;

        // --- the surface ---
        vec3 albedo = vec3(0.70, 0.68, 0.64);
        vec3 glow = vec3(0.0);
        if (part < 1.5) {
            // limestone: a tone a step and a slab, the treads worn pale down the middle
            float k = floor(z5 / LAB_CYCLE);
            float zc = z5 - k * LAB_CYCLE - LAB_LAND;
            float id = zc > 0.0 ? floor(zc / LAB_TREAD) : floor(u / 1.25) * 7.0 + floor(zc / 0.975) * 3.0 - 40.0;
            albedo *= (0.88 + 0.14 * hash(vec2(id + k * 17.0, lp + 3.0))) * (0.85 + 0.3 * grain);
            if (n.y > 0.6) {
                albedo = mix(albedo, albedo * 1.1 + 0.02, exp(-u * u * 0.8) * 0.5);
                if (zc < 0.0) {
                    vec2 j = abs(fract(vec2(u / 1.25, zc / 0.975)) - 0.5);
                    albedo *= 1.0 - 0.3 * smoothstep_custom(0.47, 0.5, max(j.x, j.y)) * lod;
                }
            }
        } else if (part < 2.5) {
            albedo = vec3(0.07, 0.065, 0.06);
        } else if (part < 3.5) {
            // plaster, a little stained
            albedo = vec3(0.82, 0.81, 0.78) * (0.9 + 0.2 * grain) * (0.94 + 0.06 * labNoise(p * 0.35));
        } else if (part < 4.5) {
            albedo = vec3(0.66, 0.64, 0.60) * (0.85 + 0.3 * grain);
        } else if (part < 5.5) {
            vec2 j = abs(fract(p.xz / vec2(1.4, 0.9)) - 0.5);
            albedo = vec3(0.36, 0.35, 0.33) * (0.8 + 0.4 * grain) * (1.0 - 0.4 * smoothstep_custom(0.46, 0.5, max(j.x, j.y)));
        } else {
            // the garden through a window: a pale sky and the dark of trees
            float leaf = labNoise(vec3(p.z * 1.4, p.y * 1.4, p.x * 0.2)) * 0.65 + labNoise(vec3(p.z * 4.0, p.y * 4.0, 1.0)) * 0.35;
            glow = mix(vec3(0.95, 0.95, 0.92), vec3(0.30, 0.31, 0.28), smoothstep_custom(0.52, 0.6, leaf));
        }
        albedo = mix(albedo, albedo * vec3(1.05, 0.42, 0.36), clamp(lp * 0.18, 0.0, 0.9) * 0.8);

        // --- the light ---
        vec3 L = labSun();
        float sun = max(dot(n, L), 0.0) * sh * (1.0 - 0.5 * decay);
        float sky = mix(0.20, 0.42, 0.5 + 0.5 * n.y) * ao;
        // what the sunlit wall throws back across the courtyard
        float bounce = 0.10 * max(-n.x * (p.x < 0.0 ? -1.0 : 1.0), 0.0) * ao;
        vec3 col = part > 5.5 ? glow : albedo * (sky + bounce + vec3(1.0, 0.97, 0.9) * sun);

        // --- the engraving ---
        float lum = dot(col, vec3(0.299, 0.587, 0.114));
        col = mix(vec3(lum), col, 0.4);
        vec3 an = abs(n);
        float coord = an.y > max(an.x, an.z) ? p.x * 0.7 + p.z * 0.7 : p.y;
        float period = 0.15;
        float fw = dist * 0.003 / max(abs(dot(n, rd)), 0.15) / period;
        float lodH = 1.0 - smoothstep_custom(0.3, 0.9, fw);
        float v = abs(fract(coord / period) - 0.5) * 2.0;
        float width = clamp(1.15 - lum * 1.9, 0.0, 0.95);
        float ink = (1.0 - smoothstep_custom(width - 0.12, width + 0.12, v)) * step(0.03, width);
        col = mix(col, mix(col * 1.12, col * 0.3, ink), lodH * 0.6);
        return col;
    }

`
