export const caveGlsl = `
    // ---- THE CRYSTAL CAVE: sector 3 ----
    //
    // A limestone cave the route slides down: a water-worn flowstone chute
    // in the floor of a chamber that swells and narrows, quartz growing out
    // of its walls in faceted six-sided prisms with pyramid tips, and a
    // giant beam across the chamber overhead now and then. Nothing in it is
    // lit but by the rider's lamp, so near things are bright and the far
    // cave goes to black, the crystals glinting on the way.

    #define MAT_CRYSTAL 5.0

    // How much of the cave look a route position has.
    float caveWeight(float z) {
        if (z >= 2000.0) return 0.0;
        float lz = mod(z, 500.0);
        return smoothstep_custom(122.0, 136.0, lz) * (1.0 - smoothstep_custom(204.0, 216.0, lz));
    }

    // Where the camera's carve shrinks, so the chute floor stands under the eye.
    float caveTight(float lz) {
        return smoothstep_custom(126.0, 134.0, lz) * (1.0 - smoothstep_custom(208.0, 216.0, lz));
    }

    // The hexagon's own norm: 1 on the flats of a hexagon of apothem 1.
    float caveHex(vec2 v) {
        v = abs(v);
        return max(v.x * 0.8660254 + v.y * 0.5, v.y);
    }

    // A quartz prism from its base along a (unit), u across it: apothem r,
    // length L to the point of a six-faced pyramid 1.6 r tall.
    float caveCrystal(vec3 w, vec3 a, vec3 u, float L, float r) {
        float al = dot(w, a);
        float hn = caveHex(vec2(dot(w, u), dot(w, cross(a, u))));
        float tip = (hn * 1.6 + al - L) / 1.89;
        return max(hn - r, max(-al - 0.6, tip));
    }

    // The chamber's centre and half-axes, from the eye, at z.
    vec2 caveCentre(float z) {
        return vec2(sin(z * 0.07) * 1.4, 1.8 + cos(z * 0.11) * 0.5);
    }

    vec2 caveRadii(float z) {
        return vec2(6.2, 5.0) * (1.0 + 0.22 * sin(z * 0.13 + 1.0) + 0.12 * sin(z * 0.31));
    }

    // The quartz of one 3.2 m cell, at q (from the eye's line) lzc along
    // the cell: eight sectors round the chamber, a crystal and a smaller
    // sibling in most, each kept 0.25 m inside its sector, so the sector's
    // edge bounds its neighbours.
    float caveQuartz(vec2 q, vec2 cc, vec2 rr, float cz, float lzc) {
        vec2 rel = q - cc;
        float rot = hash(vec2(cz, 3.1)) * 6.2831853;
        float secA = 6.2831853 / 8.0;
        float ang = atan(rel.y, rel.x) - rot;
        float si = floor(ang / secA + 0.5);
        float id = cz * 8.0 + mod(si, 8.0);
        float h0 = hash(vec2(id, 7.7));
        float h1 = hash(vec2(id, 1.3));
        float h2 = hash(vec2(id, 5.9));
        float h3 = hash(vec2(id, 4.4));
        float d = max((secA * 0.5 - abs(ang - si * secA)) * length(rel), 0.0) + 0.25;
        float ac = (si + (h3 - 0.5) * 0.36) * secA + rot;
        vec2 dir = vec2(cos(ac), sin(ac));
        if (h0 < 0.8 && dir.y > -0.55) {
            vec2 b2 = cc + dir * (1.0 / length(dir / rr) + 0.4);
            float tl = (h2 - 0.5) * 0.7;
            vec2 a2 = -vec2(dir.x * cos(tl) - dir.y * sin(tl), dir.x * sin(tl) + dir.y * cos(tl));
            vec3 a = normalize(vec3(a2, (h2 - 0.5) * 0.2));
            float L = mix(1.4, 5.2, h1 * h1);
            // keep the point 2.4 m off the eye's line
            float bb = dot(b2, a.xy);
            float disc = bb * bb - dot(a.xy, a.xy) * (dot(b2, b2) - 5.76);
            if (bb < 0.0 && disc > 0.0) L = min(L, max((-bb - sqrt(disc)) / dot(a.xy, a.xy), 0.0));
            float r = 0.12 + 0.07 * L * (0.5 + h2);
            vec3 w = vec3(q - b2, lzc - (h3 - 0.5) * 1.0);
            float tw = h0 * 9.0;
            vec3 u0 = normalize(cross(a, vec3(0.0, 0.0, 1.0)));
            vec3 u = u0 * cos(tw) + cross(a, u0) * sin(tw);
            d = min(d, caveCrystal(w, a, u, L + 0.4, r));
            // the sibling leans toward the sector's middle, half as long
            vec3 s = normalize(a + vec3(-a.y, a.x, 0.0) * (h3 < 0.5 ? 0.45 : -0.45) + vec3(0.0, 0.0, 0.2 - h2 * 0.4));
            d = min(d, caveCrystal(w - vec3(0.0, 0.0, 0.3), s, u0, L * 0.5 + 0.3, r * 0.6));
        }
        return d;
    }

    // The cave's field, empty space positive. q is p from the eye's line;
    // floorY the floor under the eye, from the eye. crystal gets the
    // distance to the quartz alone.
    float caveField(vec3 p, vec3 q, float floorY, out float crystal) {
        vec2 cc = caveCentre(p.z);
        vec2 rr = caveRadii(p.z);
        vec2 rel = q.xy - cc;

        // lumps and scallops on oblique, warped axes, so nothing rings the descent
        float nz = sin(dot(p, vec3(0.83, 0.41, 0.37)) + sin(dot(p, vec3(-0.3, 0.9, 0.5)) * 0.9) * 1.6) * 0.3
                 + sin(dot(p, vec3(-0.6, -0.5, 0.71)) * 1.3 + sin(p.x * 1.1 + p.z * 0.2) * 1.2) * 0.2
                 + sin(dot(p, vec3(0.2, -0.95, 0.4)) * 2.7) * sin(dot(p, vec3(0.9, 0.1, -0.4)) * 2.3) * 0.08;
        float dWall = (1.0 - length(rel / rr)) * min(rr.x, rr.y) + nz;
        float dFloor = q.y - floorY - 0.06 * q.x * q.x + nz * 0.1;
        float rock = smin(dWall, dFloor, 1.2);

        // The quartz: this cell and the nearer neighbour; the cells past
        // them are at least 1.85 m off. No point of it comes within 2.3 m
        // of the eye's line, which is what lets a ray down the middle run.
        float cz = floor(p.z / 3.2);
        float lzc = p.z - (cz + 0.5) * 3.2;
        float sn = lzc > 0.0 ? 1.0 : -1.0;
        crystal = min(caveQuartz(q.xy, cc, rr, cz, lzc), caveQuartz(q.xy, cc, rr, cz + sn, lzc - sn * 3.2));
        crystal = max(min(crystal, 1.85 + abs(lzc)), 2.3 - length(q.xy));

        // A giant beam across the chamber overhead, in some 9 m cells, never
        // lower than 2.1 m over the eye.
        float bz = floor(p.z / 9.0);
        float lzb = p.z - (bz + 0.5) * 9.0;
        float g0 = hash(vec2(bz, 11.3));
        float beam = max(max(4.5 - abs(lzb) + 0.8, 2.1 - q.y), 2.3 - length(q.xy));
        if (g0 < 0.6) {
            float g1 = hash(vec2(bz, 2.7));
            float g2 = hash(vec2(bz, 8.1));
            float yaw = (g1 - 0.5) * 0.7;
            vec3 a = normalize(vec3(cos(yaw), (g2 - 0.5) * 0.12, sin(yaw)));
            float r = mix(0.35, 0.6, g2);
            vec3 w = vec3(q.x - cc.x - (g1 - 0.5) * 2.0, q.y - 3.3 - g1 * 1.0, lzb);
            vec3 u = normalize(cross(a, vec3(0.0, 1.0, 0.0)));
            beam = min(beam, max(caveHex(vec2(dot(w, u), dot(w, cross(a, u)))) - r, abs(dot(w, a)) - 9.0));
        }
        crystal = min(crystal, beam);

        return min(rock, crystal);
    }

    // The rider's lamp at a point: warm, a beam down the view in a wide spill.
    vec3 caveLamp(vec3 p, vec3 ro, vec3 fwd, out vec3 l, out float d) {
        vec3 L = ro + vec3(0.0, 0.2, 0.0) - p;
        d = length(L);
        l = L / d;
        float spot = mix(0.3, 1.0, smoothstep_custom(0.7, 0.95, dot(-l, fwd)));
        return vec3(1.0, 0.91, 0.78) * 9.0 * spot / (1.0 + 0.008 * d * d);
    }

    // The dark the far cave goes to, with the lamp scattered in it.
    vec3 caveFog(vec3 rd, vec3 fwd, float lp) {
        float f = max(dot(rd, fwd), 0.0);
        vec3 c = vec3(0.02, 0.022, 0.025) + vec3(0.16, 0.145, 0.125) * f * f * f;
        return mix(c, c * vec3(1.6, 0.4, 0.35), clamp(lp * 0.18, 0.0, 0.9));
    }

    // A surface of the cave: wet limestone, flowstone in the chute, or quartz.
    // (the laps' blood and cracks go on the rock where it is mixed in)
    vec3 shadeCave(vec3 p, vec3 n, vec3 rd, float ao, vec3 ro, vec3 fwd, float isQuartz, float lp) {
        vec3 l;
        float d;
        vec3 lamp = caveLamp(p, ro, fwd, l, d);
        vec3 v = -rd;
        float ndl = max(dot(n, l), 0.0);
        float red = clamp(lp * 0.18, 0.0, 0.9);
        vec3 col;

        if (isQuartz > 0.5) {
            // milky to clear quartz, a few smoky or faintly violet
            float tone = labNoise(p * 0.35);
            vec3 qz = mix(vec3(0.78, 0.86, 0.90), vec3(0.70, 0.64, 0.80), smoothstep_custom(0.55, 0.85, tone));
            qz = mix(qz, vec3(0.45, 0.42, 0.40), smoothstep_custom(0.35, 0.1, tone));
            qz = mix(qz, vec3(0.85, 0.22, 0.16), red);
            float cosv = max(dot(n, v), 0.0);
            float fr = 0.045 + 0.955 * pow(max(1.0 - cosv, 0.0), 5.0);
            // light carried through the body: lit from anywhere the lamp reaches, not just the face
            // each flat face carries the light its own way inside: a facet bright, its neighbour dark
            float facet = hash(floor(n.xy * 3.0 + n.z * 1.7) + floor(p.xz * 0.5));
            vec3 body = qz * lamp * (0.03 + 0.12 * ndl + 0.28 * (1.0 - cosv) * (1.0 - cosv)) * (0.35 + 1.3 * facet) * ao;
            // the faint glow a lit crystal keeps in its depth, so a far one still reads
            body += qz * vec3(0.06, 0.08, 0.10) * (0.6 + 0.4 * (1.0 - cosv));
            vec3 h = normalize(l + v);
            float spec = pow(max(dot(n, h), 0.0), 90.0) * 5.0;
            vec3 r = reflect(rd, n);
            vec3 env = caveFog(r, fwd, lp) * 3.0 + vec3(0.03, 0.028, 0.026) * max(r.y, 0.0);
            col = body * (1.0 - fr) + env * fr + lamp * spec;
        } else {
            // limestone in strata, mottled; cream flowstone where it lies flat
            float strata = 0.92 + 0.08 * sin(p.y * 1.7 + sin(p.x * 0.5 + p.z * 0.37) * 2.5);
            float mott = labNoise(p * 1.7) * 0.6 + labNoise(p * 5.3) * 0.4;
            vec3 rock = vec3(0.30, 0.27, 0.24) * strata * (0.6 + 0.8 * mott);
            // dark streaks where water has run down the walls
            rock *= 1.0 - 0.35 * smoothstep_custom(0.55, 0.8, labNoise(vec3(p.x * 3.0, p.y * 0.25, p.z * 3.0)));
            float flatW = smoothstep_custom(0.55, 0.9, n.y);
            vec3 flow = vec3(0.52, 0.45, 0.36) * (0.85 + 0.3 * mott);
            vec3 albedo = mix(rock, flow, flatW);
            albedo = mix(albedo, vec3(0.35, 0.01, 0.02), red * 0.6);

            float amb = 0.08 * (0.6 + 0.4 * n.y);
            col = albedo * (lamp * ndl + amb) * ao;
            // water on the flowstone, and a film down the walls
            float wet = mix(0.25, 1.0, flatW);
            vec3 h = normalize(l + v);
            col += lamp * pow(max(dot(n, h), 0.0), mix(18.0, 60.0, flatW)) * 0.45 * wet * ao;
        }
        return col;
    }

`
