export const setpiecesGlsl = `    vec2 sp1_barbed(vec3 p, float fY, float cX, float localZ, float it) {
        // Burning twigs & barbed-wire crawl slide
        vec2 tun = p.xy - vec2(cX, fY + 0.3);
        float cave = 1.35 - length(tun);
        vec3 cp = p;
        float angle = cp.z * 1.5 + it * 2.5;
        cp.xy = vec2(cp.x * cos(angle) - cp.y * sin(angle), cp.x * sin(angle) + cp.y * cos(angle));
        float wire = length(abs(cp.xy) - vec2(0.85, 0.85)) - 0.035;
        wire += sin(cp.z * 18.0) * 0.02 * cos(cp.z * 6.0);
        float twig = length(cp.xy) - 1.25 + 0.28 * sin(cp.z * 7.0) * cos(cp.z * 4.5);
        float dSlide = min(min(cave, wire), twig);
        float mat = MAT_FLESH;
        if (wire < cave && wire < twig) mat = MAT_MATTE;
        return vec2(dSlide, mat);
    }

    vec2 sp2_tundra(vec3 p, float fY, float cX, float localZ, float it) {
        // Cold ashen tundra & shadow creatures
        float dTundraPlain = p.y - (fY - 2.5);
        float hills = sin(p.x * 0.04) * cos(p.z * 0.04) * 3.5;
        dTundraPlain -= hills;
        vec3 sp = p;
        sp.z = mod(sp.z + 18.0, 36.0) - 18.0;
        sp.x = abs(sp.x) - 13.0;
        float dCreature = length(sp - vec3(0.0, fY + 1.0 + sin(it * 2.5) * 0.4, 0.0)) - (0.95 + 0.45 * sin(it * 14.0) * cos(p.y * 3.0));
        float dBase = min(dTundraPlain, dCreature);
        float mat = MAT_MATTE;
        if (dCreature < dTundraPlain) mat = MAT_GLASS;
        return vec2(dBase, mat);
    }

    vec2 sp3_womb(vec3 p, float fY, float cX, float localZ, float it) {
        // Throbbing womb: visceral pulsating cave
        vec2 tun = p.xy - vec2(cX, fY + 1.8);
        float rCorridor = 3.6 + sin(p.z * 0.28 + it * 4.2) * 0.48;
        float womb = rCorridor - length(tun);
        float nodes = sin(p.x * 2.2) * sin(p.y * 2.2) * cos(p.z * 2.2) * 0.48;
        womb -= nodes;
        return vec2(womb, MAT_FLESH);
    }

    vec2 sp4_citadel(vec3 p, float fY, float cX, float localZ, float it) {
        // Crushing citadel gravity crawl
        float dFloor = p.y - fY;
        float dCeil = (fY + 1.35 + sin(p.z * 0.08) * 0.35) - p.y;
        vec3 rpCol = p;
        rpCol.z = mod(p.z + 5.0, 10.0) - 5.0;
        float dCol = length(abs(rpCol.xz) - vec2(3.2, 0.0)) - 0.75;
        float dCitadel = min(min(dFloor, dCeil), dCol);
        return vec2(dCitadel, MAT_MATTE);
    }

    vec2 sp5_grinder(vec3 p, float fY, float cX, float localZ, float it) {
        // The meat grinder: buzzsaws & pistons
        float dFloorLab = p.y - fY;
        float dCeilLab = (fY + 7.0) - p.y;
        float dWallsLab = 6.0 - abs(p.x);
        float dGrinder = min(dFloorLab, min(dCeilLab, dWallsLab));
        vec3 rpPiston = p;
        rpPiston.z = mod(p.z + 10.0, 20.0) - 10.0;
        float pistonCycle = abs(sin(it * 3.8 + p.z * 0.18)) * 3.6;
        float dPiston = sdBox(rpPiston - vec3(0.0, fY + 6.0 - pistonCycle, 0.0), vec3(1.6, 2.8, 1.6));
        vec3 rpSaw = p;
        rpSaw.z = mod(rpSaw.z + 8.0, 16.0) - 8.0;
        rpSaw.x = abs(rpSaw.x) - 4.0;
        float sAngle = it * 22.0;
        vec2 rotatedCoord = vec2(rpSaw.y * cos(sAngle) - rpSaw.z * sin(sAngle), rpSaw.y * sin(sAngle) + rpSaw.z * cos(sAngle));
        float dSaw = sdBox(vec3(rpSaw.x, rotatedCoord.x, rotatedCoord.y), vec3(0.1, 2.4, 2.4));
        float dTotal = min(dGrinder, min(dPiston, dSaw));
        float mat = MAT_MATTE;
        if (dPiston < dGrinder && dPiston < dSaw) mat = MAT_FLESH;
        return vec2(dTotal, mat);
    }

    vec2 sp6_spiral(vec3 p, float fY, float cX, float localZ, float it) {
        // The spiral stone bridge downwards
        float shaftRad = 9.5;
        float dShaft = shaftRad - length(p.xz - vec2(cX, 0.0));
        float pStep = (p.y - (fY)) / -5.0;
        float pCell = floor(pStep);
        float stepAngle = pCell * 0.45;
        float stepRad = 5.2;
        vec3 platformPos = vec3(cX + stepRad * cos(stepAngle), fY - pCell * 5.0, stepRad * sin(stepAngle));
        float dPlatform = sdBox(p - platformPos, vec3(1.6, 0.35, 1.95));
        float dSpiral = min(dShaft, dPlatform);
        return vec2(dSpiral, MAT_MATTE);
    }

    vec2 sp7_entropy(vec3 p, float fY, float cX, float localZ, float it) {
        // Signal entropy & light leaks: disintegrating cave geometry
        float dFloorCorr = p.y - fY;
        float hills = sin(p.x * 0.2) * cos(p.z * 0.2) * 1.5;
        dFloorCorr -= hills;
        float glitches = sin(p.x * 24.0 + it * 32.0) * sin(p.y * 36.0) * sin(p.z * 16.0) * 0.35;
        dFloorCorr += glitches;
        vec3 qBox = p;
        qBox.xz = mod(p.xz + 6.0, 12.0) - 6.0;
        float dSpikes = length(qBox - vec3(0.0, fY + 3.0, 0.0)) - (1.0 + 1.2 * sin(it * 12.0));
        float dEntropy = min(dFloorCorr, dSpikes);
        return vec2(dEntropy, MAT_GLASS);
    }

    vec2 sp8_recovery(vec3 p, float fY, float cX, float localZ, float it) {
        // The recovery chamber: concrete monoliths & a pulsing core
        float dFloorChamber = p.y - fY;
        float dCeilChamber = (fY + 8.5) - p.y;
        float dWallsChamber = 10.0 - abs(p.x);
        float dRecoveryChamber = min(dFloorChamber, min(dCeilChamber, dWallsChamber));
        vec3 rCh = p;
        rCh.z = mod(p.z + 8.0, 16.0) - 8.0;
        float arches = length(vec2(abs(rCh.x) - 10.0, p.y - fY - 4.2)) - 1.5;
        dRecoveryChamber = min(dRecoveryChamber, arches);
        vec3 bioP = p - vec3(0.0, fY + 3.0, p.z - localZ + 16.0);
        float dCore = length(bioP) - 3.0 + sin(it * 3.5) * 0.22;
        float dFinal = min(dRecoveryChamber, dCore);
        float mat = MAT_MATTE;
        if (dCore < dRecoveryChamber) mat = MAT_FLESH;
        return vec2(dFinal, mat);
    }

    vec2 sp9_void(vec3 p, float fY, float cX, float localZ, float it) {
        // THE ABYSS: an open, dark rocky floor laced with glowing veins; vast empty void above.
        float hills = sin(p.x * 0.06) * cos(p.z * 0.05) * 4.0
                    + sin(p.x * 0.19 + p.z * 0.11) * 1.3;
        float ground = p.y - (fY + hills);
        // shallow grooves carved where the lava-blood veins run
        ground += veinField(p, it * 0.4) * 0.35;
        // distant jagged ridges far out on the sides keep the centre + upper view open
        float wall = abs(p.x) - 52.0;
        float cap = (fY + 16.0 + sin(p.z * 0.07 + it * 0.2) * 7.0) - p.y;
        float dRidge = max(wall, cap);
        float d = min(ground, dRidge);
        return vec2(d, MAT_MATTE);
    }

    vec2 evalPiece(float id, vec3 p, float fY, float cX, float localZ) {
        if (id == 1.0) return sp1_barbed(p, fY, cX, localZ, iTime);
        if (id == 2.0) return sp2_tundra(p, fY, cX, localZ, iTime);
        if (id == 3.0) return sp3_womb(p, fY, cX, localZ, iTime);
        if (id == 4.0) return sp4_citadel(p, fY, cX, localZ, iTime);
        if (id == 5.0) return sp5_grinder(p, fY, cX, localZ, iTime);
        if (id == 6.0) return sp6_spiral(p, fY, cX, localZ, iTime);
        if (id == 7.0) return sp7_entropy(p, fY, cX, localZ, iTime);
        if (id == 8.0) return sp8_recovery(p, fY, cX, localZ, iTime);
        return sp9_void(p, fY, cX, localZ, iTime);
    }

`
