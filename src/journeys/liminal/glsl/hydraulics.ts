export const hydraulicsGlsl = `
    // ---- THE IRON HYDRAULICS: sector 4 ----
    //
    // A pumping hall under the cave: an iron footbridge arched across its
    // pit (the route's own rise and fall), a Warren truss for a parapet,
    // hung from the roof on tie rods, lit by enamel lamps over the walk.
    // Below it, in 20 m bays, a weighted accumulator rides its ram up and
    // down on one side and a flywheel engine turns on the other. Cast-iron
    // columns down both sides, brick walls with tall blind windows, an iron
    // roof. The hall is lit by its own lamps and nothing else.

    // How much of the hall's look a route position has.
    float hydWeight(float z) {
        if (z >= 2000.0) return 0.0;
        float lz = mod(z, 500.0);
        return smoothstep_custom(198.0, 208.0, lz) * (1.0 - smoothstep_custom(288.0, 298.0, lz));
    }

    // Where the camera's carve shrinks, so the deck stands under the eye.
    float hydTight(float lz) {
        return smoothstep_custom(208.0, 214.0, lz) * (1.0 - smoothstep_custom(282.0, 288.0, lz));
    }

    // The walked line (getCamX) and the deck under it (getFloorY), held level
    // where the hall runs past the sector.
    float hydLineX(float z) {
        float lz = mod(z, 500.0) - 210.0;
        return smoothstep_custom(0.0, 10.0, lz) * (1.0 - smoothstep_custom(60.0, 70.0, lz)) * sin(z * 0.08) * 1.8;
    }

    float hydDeckY(float z4) {
        return -125.0 + sin(clamp(z4, 0.0, 70.0) / 70.0 * 3.14159265) * 7.5;
    }

    void hydU(inout float d, inout float part, float nd, float np) {
        if (nd < d) {
            d = nd;
            part = np;
        }
    }

    // A weighted accumulator: a casing in the pit, a ram, the crown of
    // ballast it lifts, the guide frame it rides in. a from its axis (y as
    // the hall's), ph its phase.
    void hydAccumulator(vec3 a, float ph, inout float d, inout float part) {
        float bound = sdBox(a - vec3(0.0, -117.5, 0.0), vec3(2.7, 16.6, 2.7));
        if (bound > 1.0) {
            hydU(d, part, bound, 3.0);
            return;
        }
        float r = length(a.xz);
        float crownY = -118.5 + 3.5 * (0.5 + 0.5 * sin(iTime * 0.35 + ph));
        float casing = max(r - 1.05, abs(a.y + 127.0) - 7.0);
        casing = min(casing, max(r - 1.25, abs(a.y + 120.3) - 0.3));
        casing = min(casing, sdBox(a - vec3(0.0, -133.6, 0.0), vec3(1.9, 0.4, 1.9)));
        float ram = max(r - 0.42, max(-120.0 - a.y, a.y - crownY - 0.5));
        float crown = max(r - 2.0, abs(a.y - crownY - 2.25) - 2.25);
        crown = min(crown, max(r - 2.1, abs(a.y - crownY - 0.15) - 0.15));
        vec2 g = abs(a.xz) - 2.4;
        float frame = sdBox(vec3(g.x, a.y + 118.0, g.y), vec3(0.16, 16.0, 0.16));
        frame = min(frame, min(sdBox(a - vec3(0.0, -102.4, 0.0), vec3(2.6, 0.35, 0.22)),
                               sdBox(a - vec3(0.0, -102.4, 0.0), vec3(0.22, 0.35, 2.6))));
        hydU(d, part, casing, 3.0);
        hydU(d, part, ram, 4.0);
        hydU(d, part, crown, 8.0);
        hydU(d, part, frame, 2.0);
    }

    // A flywheel engine: the wheel turning in the plane across the hall's
    // length, its pedestals, a crank and rod driving a pump on the inner
    // side. f from the hub, ang the wheel's turn.
    void hydEngine(vec3 f, float ang, inout float d, inout float part) {
        float bound = sdBox(f - vec3(0.0, -2.5, 0.0), vec3(2.8, 9.2, 9.8));
        if (bound > 1.0) {
            hydU(d, part, bound, 3.0);
            return;
        }
        float rr = length(f.yz);
        float rim = labBox2(vec2(rr - 6.2, f.x), vec2(0.3, 0.35));
        float a8 = 0.78539816;
        float th = atan(f.y, f.z) + ang;
        float thr = mod(th + 0.5 * a8, a8) - 0.5 * a8;
        float spoke = max(labBox2(vec2(rr * sin(thr), f.x), vec2(0.13, 0.12)), abs(rr - 3.45) - 2.65);
        float hub = max(rr - 0.9, abs(f.x) - 0.55);
        float steel = max(rr - 0.3, abs(f.x) - 2.6);
        // the pedestals, a tapered frame each side of the wheel
        float ty = clamp((f.y + 11.5) / 11.5, 0.0, 1.0);
        float ped = max(abs(abs(f.x) - 1.6) - 0.25, max(abs(f.z) - mix(2.4, 0.6, ty), abs(f.y + 5.75) - 5.85));
        // the crank on the inner side, the rod to a crosshead, the pump it works
        float crank = max(rr - 2.1, abs(f.x + 2.05) - 0.1);
        vec3 pin = vec3(-2.2, -1.8 * sin(ang), 1.8 * cos(ang));
        float zc = pin.z + sqrt(30.25 - pin.y * pin.y);
        vec3 cp = vec3(-2.2, 0.0, zc);
        vec3 pa = f - pin;
        vec3 ba = cp - pin;
        float rod = length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)) - 0.12;
        float lx = length(vec2(f.x + 2.2, f.y));
        float pistonRod = max(lx - 0.1, max(zc - f.z, f.z - 7.4));
        float xhead = sdBox(f - cp, vec3(0.28, 0.28, 0.32));
        float pump = max(lx - 0.55, abs(f.z - 8.4) - 1.2);
        pump = min(pump, sdBox(f - vec3(-2.2, -5.75, 8.4), vec3(0.45, 5.75, 0.9)));
        hydU(d, part, rim, 8.0);
        hydU(d, part, min(spoke, hub), 3.0);
        hydU(d, part, min(min(steel, rod), pistonRod), 4.0);
        hydU(d, part, min(min(ped, crank), min(xhead, pump)), 3.0);
    }

    // The hall's solid at p. part: 1 the deck, 2 green-painted iron,
    // 3 black cast iron, 4 bright steel, 5 brick, 6 the pit floor, 7 a lamp,
    // 8 red-oxide iron, 9 a window.
    float hydField(vec3 p, out float part) {
        float lp = floor(p.z / 500.0);
        float cF = 1.0 - clamp(lp * 0.14, 0.0, 0.72);
        float z4 = mod(p.z, 500.0) - 210.0;
        float u = p.x - hydLineX(p.z);
        float y = p.y - hydDeckY(z4);
        float au = abs(u);
        float d = 1000.0;
        part = 2.0;

        // --- the bridge ---
        float deck = labBox2(vec2(u, y + 0.05), vec2(1.3, 0.05));
        float s24 = mod(z4, 2.4) - 1.2;
        float sa = abs(s24);
        float iron = labBox2(vec2(au - 1.36, y + 0.12), vec2(0.06, 0.2));
        // the parapet: a Warren truss, chords and diagonals and a post every 2.4 m
        iron = min(iron, length(vec2(au - 1.36, y - 1.12)) - 0.05);
        float diag = (y * 1.2 - 1.1 * sa) / 1.628;
        iron = min(iron, max(max(abs(au - 1.36) - 0.02, abs(diag) - 0.035), abs(y - 0.55) - 0.55));
        iron = min(iron, max(max(abs(au - 1.36) - 0.035, 1.16 - sa), abs(y - 0.55) - 0.55));
        // cross girders under the deck, the tie rods up to the roof
        float gz = 1.2 - sa;
        iron = min(iron, sdBox(vec3(u, y + 0.32, gz), vec3(1.62, 0.22, 0.08)));
        float hz = abs(mod(z4 + 2.4, 4.8) - 2.4);
        iron = min(iron, max(length(vec2(au - 1.5, hz)) - 0.035, -y - 0.4));
        // a lamp over the walk every 9.6 m: a bar between the tie rods, a cable, an enamel shade, the bulb
        float lz9 = abs(mod(z4, 9.6) - 4.8);
        iron = min(iron, max(labBox2(vec2(lz9, y - 3.85), vec2(0.05, 0.06)), au - 1.5));
        float rl = length(vec2(u, lz9));
        float shade = max(rl - mix(0.3, 0.07, clamp((y - 3.28) / 0.16, 0.0, 1.0)), abs(y - 3.36) - 0.08) * 0.8;
        shade = min(shade, max(rl - 0.012, max(3.4 - y, y - 3.85)));
        float bulb = length(vec3(u, y - 3.25, lz9)) - 0.07;
        // two mains carried under the deck, flanged every 3 m
        float rm = length(vec2(au - 0.65, y + 0.75));
        float mains = min(rm - 0.17, max(rm - 0.23, abs(mod(z4, 3.0) - 1.5) - 0.04));
        hydU(d, part, deck, 1.0);
        hydU(d, part, iron, 2.0);
        hydU(d, part, shade, 3.0);
        hydU(d, part, bulb, 7.0);
        hydU(d, part, mains, 8.0);

        // --- the hall ---
        float W = max(16.0 * cF, 11.0);
        float ax = abs(p.x);
        float floorD = p.y + 134.0;
        float roof = -97.0 - p.y;
        float wz = mod(z4 + 5.0, 10.0) - 5.0;
        float win = labArch(vec2(wz, p.y + 119.0), 1.6, 15.0);
        float wall = max(W - ax, -max(win, ax - W - 0.7));
        float glass = max(abs(ax - W - 0.6) - 0.02, win);
        float cz = mod(z4, 10.0) - 5.0;
        float roofIron = min(labBox2(vec2(cz, p.y + 98.4), vec2(0.2, 0.7)), labBox2(vec2(ax - 9.0, p.y + 98.4), vec2(0.3, 0.6)));
        // cast-iron columns, fluted, on a plinth under a capital
        vec2 cq = vec2(ax - 9.0, cz);
        float cr = length(cq);
        float col = max(cr - 0.42 - 0.018 * cos(16.0 * atan(cq.y, cq.x)), abs(p.y + 115.5) - 18.5);
        col = min(col, sdBox(vec3(cq.x, p.y + 132.8, cq.y), vec3(0.75, 1.2, 0.75)));
        col = min(col, max(cr - 0.58, abs(p.y + 131.3) - 0.3));
        col = min(col, max(cr - mix(0.44, 0.75, clamp((p.y + 100.4) / 1.2, 0.0, 1.0)), abs(p.y + 99.4) - 0.6));
        // an arc lamp on a bracket on each column, facing the bridge
        float bracket = sdBox(vec3(ax - 8.45, p.y + 112.7, cz), vec3(0.15, 0.04, 0.04));
        float globe = length(vec3(ax - 8.25, p.y + 113.0, cz)) - 0.22;
        // pipes along both walls, flanged every 4 m
        float pw = length(vec2(ax - W + 0.55, p.y + 127.0));
        float pw2 = length(vec2(ax - W + 0.55, p.y + 128.1));
        float wallPipe = min(min(pw, pw2) - 0.3, max(min(pw, pw2) - 0.38, abs(mod(z4, 4.0) - 2.0) - 0.05));
        hydU(d, part, floorD, 6.0);
        hydU(d, part, wall, 5.0);
        hydU(d, part, glass, 9.0);
        hydU(d, part, min(roof, roofIron), 3.0);
        hydU(d, part, min(col, bracket), 2.0);
        hydU(d, part, globe, 7.0);
        hydU(d, part, wallPipe, 8.0);

        // --- the machines: one 20 m bay, mirrored bay to bay ---
        float ck = floor(z4 / 20.0);
        float lz = z4 - (ck + 0.5) * 20.0;
        float side = mod(ck, 2.0) < 0.5 ? 1.0 : -1.0;
        float px = p.x * side;
        hydAccumulator(vec3(px + 6.5, p.y, lz), ck * 2.1, d, part);
        hydEngine(vec3(px - 7.0, p.y + 122.5, lz), iTime * 0.9 + ck, d, part);
        // the next bay's machines are at least this far
        d = min(d, max(10.2 - abs(lz), abs(abs(p.x) - 6.8) - 3.0));
        return d;
    }

    // The lamps over the walk fail with the laps, as the halls' panels do.
    float hydLampOn(float j, float lp) {
        float decay = clamp(lp * 0.15, 0.0, 0.95);
        float h = hash(vec2(j, lp + 21.0));
        if (h < 1.25 * decay) return 0.0;
        float st = step(h, 1.25 * decay + 0.07 + 0.5 * decay);
        return 1.0 - st * step(0.5, hash(vec2(j, floor(iTime * 14.0))));
    }

    vec3 hydLampColour(float lp) {
        return mix(vec3(1.0, 0.74, 0.46), vec3(1.0, 0.32, 0.18), clamp(lp * 0.2, 0.0, 0.8));
    }

    // Where lamp j over the walk hangs, in the loop whose sector starts at base.
    vec3 hydLampPos(float j, float base) {
        float z4 = 9.6 * j + 4.8;
        return vec3(hydLineX(base + z4), hydDeckY(z4) + 3.25, base + z4);
    }

    // The haze: dark and warm, a little brighter looking up toward the lamps.
    vec3 hydFog(vec3 rd, float lp) {
        vec3 c = mix(vec3(0.030, 0.028, 0.026), vec3(0.085, 0.072, 0.058), smoothstep_custom(-0.5, 0.7, rd.y));
        return mix(c, c * vec3(1.5, 0.45, 0.4), clamp(lp * 0.18, 0.0, 0.9));
    }

    // The lamps' halos in the haze along a ray that stops at t.
    vec3 hydGlow(vec3 ro, vec3 rd, float t) {
        float lp = floor(ro.z / 500.0);
        float base = ro.z - mod(ro.z, 500.0) + 210.0;
        float j0 = floor((ro.z - base - 4.8) / 9.6);
        vec3 lc = hydLampColour(lp);
        vec3 g = vec3(0.0);
        for (int i = 0; i < 6; i++) {
            float j = j0 + float(i);
            vec3 L = hydLampPos(j, base) - ro;
            float tc = clamp(dot(L, rd), 0.0, t);
            float dd = length(rd * tc - L);
            g += lc * hydLampOn(j, lp) * (0.003 / (dd * dd + 0.003) + 0.03 * exp(-dd * 1.1)) * exp(-0.02 * tc);
        }
        // the arc lamps on the columns, both sides
        float k0 = floor((ro.z - base - 5.0) / 10.0);
        for (int i = 0; i < 5; i++) {
            float zc = base + 10.0 * (k0 + float(i)) + 5.0;
            for (int s = 0; s < 2; s++) {
                vec3 L = vec3(s == 0 ? 8.25 : -8.25, -113.0, zc) - ro;
                float tc = clamp(dot(L, rd), 0.0, t);
                float dd = length(rd * tc - L);
                g += lc * (0.006 / (dd * dd + 0.02) + 0.02 * exp(-dd * 0.5)) * exp(-0.02 * tc);
            }
        }
        return g;
    }

    // A surface of the hall, lit by the lamps over the walk and the arc
    // lamps on the columns; no shadow march, the AO darkens what is tucked in.
    vec3 shadeHyd(vec3 p, vec3 n, vec3 rd, float ao, float dist) {
        float lp = floor(p.z / 500.0);
        float part;
        hydField(p, part);
        float z4 = mod(p.z, 500.0) - 210.0;
        float u = p.x - hydLineX(p.z);
        float base = p.z - z4;
        float lod = 1.0 / (1.0 + dist * 0.08);
        float grain = 0.5 + (labNoise(p * 2.3) * 0.6 + labNoise(p * 8.1) * 0.4 - 0.5) * lod;
        vec3 lc = hydLampColour(lp);
        vec3 v = -rd;

        // --- the surface ---
        vec3 albedo = vec3(0.1);
        float gloss = 12.0;
        float specK = 0.15;
        vec3 glow = vec3(0.0);
        float rust = smoothstep_custom(0.6, 0.85, labNoise(p * 1.3) * 0.7 + labNoise(p * 6.0) * 0.3);
        if (part < 1.5) {
            // chequer plate, worn bright down the middle of the walk
            vec2 c = vec2(u + z4, z4 - u) * 14.0;
            float lug = smoothstep_custom(0.3, 0.1, length(fract(c) - 0.5)) * lod;
            float wear = exp(-u * u * 1.6);
            albedo = vec3(0.15, 0.148, 0.145) * (0.8 + 0.4 * grain) * (1.0 + 0.35 * lug) * (1.0 + 0.4 * wear);
            albedo = mix(albedo, vec3(0.22, 0.10, 0.05), rust * 0.6 * (1.0 - wear));
            gloss = mix(20.0, 60.0, wear);
            specK = mix(0.2, 0.5, wear);
        } else if (part < 2.5) {
            albedo = vec3(0.11, 0.21, 0.15) * (0.85 + 0.3 * grain);
            albedo = mix(albedo, vec3(0.24, 0.12, 0.06), rust * 0.75);
            gloss = 24.0;
            specK = 0.18;
        } else if (part < 3.5) {
            albedo = vec3(0.045, 0.045, 0.048) * (0.8 + 0.4 * grain);
            gloss = 30.0;
            specK = 0.35;
        } else if (part < 4.5) {
            albedo = vec3(0.30, 0.31, 0.32);
            gloss = 90.0;
            specK = 1.2;
        } else if (part < 5.5) {
            // brick in running bond, a band of glazed cream at the bridge's height
            vec2 b = vec2((p.z + (fract(p.y / 0.15) < 0.5 ? 0.0 : 0.12)) / 0.24, p.y / 0.075);
            vec2 bi = floor(vec2(b.x, b.y * 0.5));
            float mortar = smoothstep_custom(0.42, 0.5, max(abs(fract(b.x) - 0.5), abs(fract(b.y * 0.5) - 0.5) * 0.9)) * lod;
            float tone = hash(bi + vec2(p.x > 0.0 ? 7.0 : 0.0, 3.0));
            albedo = vec3(0.34, 0.15, 0.09) * (0.75 + 0.45 * tone);
            float band = step(abs(p.y + 121.5), 0.6);
            albedo = mix(albedo, vec3(0.62, 0.57, 0.46) * (0.9 + 0.15 * tone), band);
            albedo = mix(albedo, vec3(0.30, 0.29, 0.26), mortar);
            albedo *= 0.75 + 0.35 * grain;
            gloss = mix(8.0, 50.0, band);
            specK = mix(0.05, 0.5, band);
        } else if (part < 6.5) {
            // wet stone flags
            vec2 j = abs(fract(p.xz / vec2(1.2, 0.8)) - 0.5);
            float joint = smoothstep_custom(0.45, 0.5, max(j.x, j.y)) * lod;
            float id = hash(floor(p.xz / vec2(1.2, 0.8)));
            albedo = vec3(0.16, 0.15, 0.14) * (0.7 + 0.5 * id) * (1.0 - 0.5 * joint) * (0.8 + 0.4 * grain);
            gloss = 80.0;
            specK = 0.6 * smoothstep_custom(0.4, 0.7, labNoise(p * 0.4));
        } else if (part < 7.5) {
            float on = 1.0;
            if (abs(p.x) < 6.0) on = hydLampOn(floor((z4 - 4.8) / 9.6 + 0.5), lp);
            glow = lc * (0.6 + 5.0 * on);
        } else if (part < 8.5) {
            albedo = vec3(0.30, 0.08, 0.05) * (0.8 + 0.4 * grain);
            albedo = mix(albedo, vec3(0.16, 0.08, 0.04), rust * 0.6);
            gloss = 28.0;
            specK = 0.2;
        } else {
            // a blind window: grey light behind small panes in iron glazing bars
            float wz = mod(z4 + 5.0, 10.0) - 5.0;
            vec2 g = abs(fract(vec2(wz / 0.53, p.y / 0.8) + 0.5) - 0.5) * vec2(0.53, 0.8);
            float bar = smoothstep_custom(0.025, 0.04, min(g.x, g.y));
            float pane = 0.75 + 0.25 * hash(floor(vec2(wz / 0.53, p.y / 0.8) + 0.5) + floor(p.z / 10.0));
            vec3 sky = mix(vec3(0.16, 0.19, 0.21), vec3(0.20, 0.07, 0.06), clamp(lp * 0.25, 0.0, 0.9));
            glow = sky * pane * bar * (0.6 + 0.4 * smoothstep_custom(-119.0, -104.0, p.y));
            albedo = vec3(0.03) * (1.0 - bar);
        }
        albedo = mix(albedo, albedo * vec3(1.15, 0.45, 0.38), clamp(lp * 0.18, 0.0, 0.9) * 0.7);

        // --- the light ---
        vec3 diff = vec3(0.035, 0.038, 0.044) * (0.6 + 0.4 * n.y) * ao;
        vec3 spec = vec3(0.0);
        float j0 = floor((z4 - 4.8) / 9.6 + 0.5);
        for (int i = -1; i <= 1; i++) {
            float j = j0 + float(i);
            vec3 L = hydLampPos(j, base) - p;
            float d2 = dot(L, L);
            vec3 l = L * inversesqrt(d2);
            // the shade throws the light down
            float cone = mix(0.06, 1.0, smoothstep_custom(-0.1, 0.4, l.y));
            vec3 e = lc * hydLampOn(j, lp) * 10.0 * cone / (d2 + 1.0);
            diff += e * max(dot(n, l), 0.0);
            spec += e * pow(max(dot(n, normalize(l + v)), 0.0), gloss);
        }
        float k0 = floor((z4 - 5.0) / 10.0);
        for (int i = 0; i <= 1; i++) {
            float zc = base + 10.0 * (k0 + float(i)) + 5.0;
            for (int s = 0; s < 2; s++) {
                vec3 L = vec3(s == 0 ? 8.25 : -8.25, -113.0, zc) - p;
                float d2 = dot(L, L);
                vec3 l = L * inversesqrt(d2);
                vec3 e = lc * 90.0 / (d2 + 4.0);
                diff += e * max(dot(n, l), 0.0);
                spec += e * pow(max(dot(n, normalize(l + v)), 0.0), gloss);
            }
        }
        float fr = 0.04 + 0.96 * pow(max(1.0 - max(dot(n, v), 0.0), 0.0), 5.0);
        vec3 col = albedo * diff + spec * specK * ao * (0.5 + fr);
        // bright steel and the glaze see the haze in their reflections
        if (part > 3.5 && part < 4.5) col += hydFog(reflect(rd, n), lp) * 1.5 * ao;
        return col + glow;
    }

`
