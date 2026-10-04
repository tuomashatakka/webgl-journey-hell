export const marchGlsl = `    // Signed Distance Field Map
    vec2 map(vec3 p, float ignoreWater) {
        float loop, sector, descent, setpieceA, setpieceB, blend, localZ, secLen, fallAmt, isCrystal;
        getSegmentData(p.z, loop, sector, descent, setpieceA, setpieceB, blend, localZ, secLen, fallAmt, isCrystal);

        float currentZ = mod(p.z, 500.0);
        float fY = getFloorY(p.z);
        
        float smoothLoop = loop;
        if (sector == 6.0 && currentZ > 400.0) {
            smoothLoop = loop + smoothstep_custom(400.0, 500.0, currentZ);
        }

        float decayFactor = decayOf(smoothLoop) * 0.75;
        float cFactor = 1.0 - clamp(smoothLoop * 0.14, 0.0, 0.72);

        // Squeezing/bending corridors on higher decay iterations
        if (sector < 666.0) {
            float twist = sin(p.z * 0.065 + iTime * 2.0) * (smoothLoop * 0.35);
            p.x += twist * (1.0 - cFactor);
        }

        if (decayFactor > 0.01) {
            float warpX = sin(p.z * 1.8 + iTime * 2.0) * cos(p.y * 1.5) * 0.55 * decayFactor;
            float warpY = cos(p.x * 1.6 + iTime * 1.5) * sin(p.z * 1.2) * 0.45 * decayFactor;
            float warpHigh = sin(p.z * 8.0) * cos(p.y * 8.0) * sin(p.x * 8.0) * 0.08 * decayFactor;
            p.x += warpX + warpHigh;
            p.y += warpY + warpHigh;
        }

        float cX = getCamX(p.z);
        float cY = fY + getCamOffset(p.z);
        float dCamSafety = length(p.xy - vec2(cX, cY)) - 2.0;

        vec2 res = vec2(1000.0, MAT_MATTE);

        // SECTOR 666: THE ABYSS (continuous cross-faded setpieces)
        if (sector == 666.0) {
            vec2 dA = evalPiece(setpieceA, p, fY, cX, localZ);
            if (blend < 0.001) {
                res = dA;
                res.x = max(res.x, -dCamSafety);
                res.x *= 0.45;
                return res;
            }
            vec2 dB = evalPiece(setpieceB, p, fY, cX, localZ);
            float k = 1.5;
            float d = mix(smin(dA.x, dB.x, k), dB.x, blend);
            float mat = (blend < 0.5) ? dA.y : dB.y;
            res = vec2(d, mat);
            res.x = max(res.x, -dCamSafety);
            // tighter step scaling while blending to absorb non-Lipschitz error
            res.x *= 0.4;
            return res;
        }

        // --- SECTORS 1 & 2 (0 to 130) ---
        // Interpolate width and height
        float r_t = clamp((currentZ - 60.0) / 70.0, 0.0, 1.0);
        if (currentZ < 60.0) r_t = 0.0;
        float r_width = mix(12.0, 35.0, r_t) * cFactor;
        float r_ceilH = mix(7.0, 40.0, r_t) * mix(1.0, 0.45, 1.0 - cFactor);
        
        float dFloor = p.y - fY;
        float dCeil = (fY + r_ceilH) - p.y;
        float dWalls = r_width - abs(p.x);
        float dRoom12 = min(dFloor, min(dCeil, dWalls));

        vec3 q1 = p; q1.z = mod(q1.z + 3.0, 6.0) - 3.0; q1.x = abs(q1.x) - 4.5 * cFactor;
        float dCol1 = length(max(abs(vec2(q1.x, q1.z)) - 0.4, 0.0)) - 0.05;
        
        vec3 q2 = p; q2.z = mod(q2.z + 15.0, 30.0) - 15.0; q2.x = abs(q2.x) - 16.0 * cFactor;
        float dCol2 = length(q2.xz) - 3.0;
        
        float dSec1 = min(dRoom12, dCol1);
        float dSec2 = min(dRoom12, dCol2);
        
        float dBase = mix(dSec1, dSec2, smoothstep_custom(50.0, 70.0, currentZ));

        // Add glass slide for Sec 2
        float dSlideHull = 1000.0;
        if (currentZ > 60.0 && currentZ < 130.0) {
            float slide_x = cX;
            float slide_y = fY + 1.2;
            vec2 dSlideQ = vec2(p.x - slide_x, p.y - slide_y);
            dSlideHull = max(abs(length(dSlideQ) - 1.8) - 0.1, dSlideQ.y - 0.2);
            dBase = min(dBase, dSlideHull); 
        }

        // --- SECTOR 3: CRYSTAL CAVE (130 to 210) ---
        vec3 q3 = p; q3.x -= cX; q3.y -= cY;
        float cave = 6.0 - length(q3.xy - vec2(sin(q3.z * 0.1) * 3.0, cos(q3.z * 0.15) * 2.0));
        cave += sin(q3.x * 2.0) * sin(q3.y * 1.5) * sin(q3.z * 1.0) * 0.5;
        vec3 cp = q3; cp.x += sin(iTime * 0.5 + p.z) * 1.0; cp.y += cos(iTime * 0.4 + p.z) * 1.0;
        cp.xz = mod(cp.xz + 6.0, 12.0) - 6.0; cp.y = mod(cp.y + 4.0, 8.0) - 4.0;
        float crystal = (abs(cp.x) + abs(cp.y) + abs(cp.z)) - 0.8;
        float dSec3 = min(cave, crystal) * 0.6; // We use MAT_MATTE for cave, crystal handled below

        dBase = mix(dBase, dSec3, smoothstep_custom(115.0, 145.0, currentZ));

        // --- SECTOR 4: COGS & PNEUMATICS (210 to 280) ---
        vec3 q4 = p; q4.x -= cX; q4.y -= cY;
        vec3 q4m = q4; q4m.xz = mod(q4m.xz + 10.0, 20.0) - 10.0;
        
        float vCols = max(abs(q4m.x) - 1.8, max(abs(q4m.y) - 50.0, abs(q4m.z) - 1.8));
        float hB1 = max(abs(q4m.x) - 8.0, max(abs(q4m.y) - 0.3, abs(q4m.z + 8.0) - 0.3));
        float hB2 = max(abs(q4m.x) - 8.0, max(abs(q4m.y) - 0.3, abs(q4m.z - 8.0) - 0.3));
        float allCols = min(vCols, min(hB1, hB2));
        
        vec3 gA = q4m - vec3(0.0, 5.0, 0.0); gA.xy *= mat2(cos(iTime*1.2), -sin(iTime*1.2), sin(iTime*1.2), cos(iTime*1.2));
        float dGa = max(length(gA.xy) - (2.6 + sin(atan(gA.y, gA.x) * 16.0) * 0.3), abs(q4m.z) - 0.5);
        vec3 gB = q4m - vec3(-4.6, 5.0, 0.0); float tB = -iTime*1.95 + 0.1; gB.xy *= mat2(cos(tB), -sin(tB), sin(tB), cos(tB));
        float dGb = max(length(gB.xy) - (1.6 + sin(atan(gB.y, gB.x) * 10.0) * 0.2), abs(q4m.z) - 0.4);
        vec3 gC = q4m - vec3(4.6, 5.0, 0.0); gC.xy *= mat2(cos(tB), -sin(tB), sin(tB), cos(tB));
        float dGc = max(length(gC.xy) - (1.6 + sin(atan(gC.y, gC.x) * 10.0) * 0.2), abs(q4m.z) - 0.4);
        float gears = min(dGa, min(dGb, dGc));
        
        vec3 pA = q4m - vec3(sin(iTime*4.0)*3.5, -2.5, -2.0); float cA = max(abs(pA.x)-3.0, max(abs(pA.y)-0.4, abs(pA.z)-0.4));
        vec3 sB_= q4m - vec3(-4.0, 0.0, 2.0); float csB = max(abs(sB_.x)-0.6, max(abs(sB_.y)-2.2, abs(sB_.z)-0.6));
        vec3 rB_= q4m - vec3(-4.0, sin(iTime*3.0)*2.0, 2.0); float crB = max(abs(rB_.x)-0.35, max(abs(rB_.y)-2.0, abs(rB_.z)-0.35));
        vec3 sC_= q4m - vec3(4.0, 0.0, 2.0); float csC = max(abs(sC_.x)-0.6, max(abs(sC_.y)-2.2, abs(sC_.z)-0.6));
        vec3 rC_= q4m - vec3(4.0, cos(iTime*3.0)*2.0, 2.0); float crC = max(abs(rC_.x)-0.35, max(abs(rC_.y)-2.0, abs(rC_.z)-0.35));
        float pneumatics = min(cA, min(min(csB, crB), min(csC, crC)));
        
        float dSec4 = min(p.y - (fY - 1.0), min(allCols, min(gears, pneumatics)) * 0.4);
        dBase = mix(dBase, dSec4, smoothstep_custom(200.0, 220.0, currentZ));

        // --- SECTOR 5: VOID BASIS LABYRINTH (280 to 430) ---
        vec3 q5 = p; q5.x -= cX;
        float dMainStair = max(abs(q5.x) - 2.5 * cFactor, abs(q5.y - fY) - 0.45);
        
        vec3 lq = q5;
        lq.yz = mat2(cos(sin(q5.x*0.015)*0.5), -sin(sin(q5.x*0.015)*0.5), sin(sin(q5.x*0.015)*0.5), cos(sin(q5.x*0.015)*0.5)) * lq.yz;
        lq.zx = mat2(cos(cos(q5.y*0.015)*0.5), -sin(cos(q5.y*0.015)*0.5), sin(cos(q5.y*0.015)*0.5), cos(cos(q5.y*0.015)*0.5)) * lq.zx;
        lq = mod(lq + 10.0, 20.0) - 10.0;
        
        float block = max(max(abs(lq.x)-10.0, abs(lq.y)-10.0), abs(lq.z)-10.0);
        float inner = max(max(abs(lq.x)-9.0, abs(lq.y)-9.0), abs(lq.z)-9.0);
        block = max(block, -inner);
        float doorX = max(max(abs(lq.x)-11.0, abs(lq.y)-5.0), abs(lq.z)-5.0);
        float doorY = max(max(abs(lq.x)-5.0, abs(lq.y)-11.0), abs(lq.z)-5.0);
        float doorZ = max(max(abs(lq.x)-5.0, abs(lq.y)-5.0), abs(lq.z)-11.0);
        block = max(block, -min(doorX, min(doorY, doorZ)));
        
        vec3 sq_ = lq; sq_.y -= floor(sq_.z / 0.5) * 0.5; sq_.z = mod(sq_.z, 0.5) - 0.25;
        float stair_ = max(abs(lq.x)-2.5, max(abs(lq.y)-8.5, abs(lq.z)-8.5));
        stair_ = max(stair_, max(abs(sq_.x)-2.5, max(abs(sq_.y)-0.125, abs(sq_.z)-0.125)));
        
        vec3 sq3_ = vec3(lq.y, lq.z, lq.x); sq3_.y -= floor(sq3_.z / 0.5) * 0.5; sq3_.z = mod(sq3_.z, 0.5) - 0.25;
        float stair3_ = max(abs(sq3_.x)-2.5, max(abs(sq3_.y)-0.125, abs(sq3_.z)-0.125));
        stair3_ = max(stair3_, max(abs(lq.y)-2.5, max(abs(lq.z)-8.5, abs(lq.x)-8.5)));
        
        float dSec5 = min(dMainStair, min(block, min(stair_, stair3_)) * 0.4);
        dBase = mix(dBase, dSec5, smoothstep_custom(270.0, 290.0, currentZ));

        // --- SECTOR 6: HALLWAY EXIT (360 to 500) ---
        float dFloor6 = p.y - fY;
        float dCeil6 = (fY + 7.0 * mix(1.0, 0.45, 1.0 - cFactor)) - p.y;
        float dWalls6 = 12.0 * cFactor - abs(p.x);
        float dSec6 = min(dFloor6, min(dCeil6, dWalls6));
        dSec6 = min(dSec6, mix(100.0, dCol1, smoothstep_custom(450.0, 500.0, currentZ)));
        dBase = mix(dBase, dSec6, smoothstep_custom(340.0, 370.0, currentZ));
        
        dBase = max(dBase, -dCamSafety);
        res = opU(res, vec2(dBase, MAT_MATTE));

        // Resolve Material details (Crystal vs Matte vs Glass Tube)
        if (dBase == dSlideHull && currentZ > 60.0 && currentZ < 130.0) {
            res.y = MAT_GLASS;
        }
        if (currentZ > 120.0 && currentZ < 220.0 && crystal < cave) {
            res.y = MAT_GLASS;
        }

        // Fluids
        float dSlideWater = 1000.0;
        if (currentZ > 60.0 && currentZ < 130.0) {
            float slide_x = cX;
            float slide_y = fY + 1.2;
            vec2 dSlideQ = vec2(p.x - slide_x, p.y - slide_y);
            // Dynamic rushing water inside waterslide tube
            dSlideWater = max(length(dSlideQ) - 1.72, dSlideQ.y - 0.0);
            vec3 pWaterWave = p;
            pWaterWave.y += sin(p.z * 1.5 - iTime * 15.0) * 0.1;
            dSlideWater = max(dSlideWater, pWaterWave.y - (fY + 0.5));
        }

        float waterY = -9000.0;
        float wRise = smoothLoop * 0.6;
        if (currentZ < 65.0) {
            waterY = 0.3 + wRise;
        } else if (currentZ < 135.0) {
            waterY = mix(0.3 + wRise, -9000.0, smoothstep_custom(65.0, 85.0, currentZ));
        } else if (currentZ > 351.0) {
            waterY = fY + 0.3 + wRise; // Elevates dynamically with fY back to 0.3 at lz=500!
        }
        
        if (waterY > -900.0 && ignoreWater < 0.5) {
            float dWater = p.y - (waterY + sin(p.x * 2.5 + iTime * 2.0) * cos(p.z * 2.5 + iTime * 2.5) * 0.03);
            res = opU(res, vec2(dWater, MAT_WATER));
        }
        if (dSlideWater < 900.0 && ignoreWater < 0.5) {
            res = opU(res, vec2(dSlideWater, MAT_WATER));
        }

        if (loop >= 1.0 && res.y == MAT_MATTE) {
            float vNoise = sin(p.x * 0.38) * cos(p.y * 0.38) * sin(p.z * 0.14) + sin(p.z * 0.5) * 0.25;
            if (vNoise > (0.95 - clamp(smoothLoop * 0.15, 0.0, 0.7))) res.x = max(res.x, 3.8);
        }

        if (res.y == MAT_MATTE) res.x -= getFloorCrack(p, localZ, smoothLoop) * 0.25;

        res.x *= 0.55;
        return res;
    }

`
