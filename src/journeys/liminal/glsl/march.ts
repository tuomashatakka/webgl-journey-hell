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

        float decayFactor = clamp(smoothLoop * 0.15, 0.0, 0.95);
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
        // (on the walked stair, down the cave's chute and over the hall's bridge the clearance tightens so the floor stands under the eye)
        float dCamSafety = length(p.xy - vec2(cX, cY)) - (2.0 - 0.9 * labTight(currentZ) - 1.3 * caveTight(currentZ) - (sector < 666.0 ? 0.9 * hydTight(currentZ) : 0.0));

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

        // Each sector's field is built only where its cross-fade weight is not
        // zero: a sample pays for the room it is in (two across a join), not
        // for all six. The weights are the smoothsteps below, so the windows
        // are their supports.
        float dBase = 1000.0;
        float dSlideHull = 1000.0;
        float cave = 1000.0;
        float crystal = 1000.0;

        // The pool columns: sector 1, and again where sector 6 runs back into it.
        vec3 q1 = p; q1.z = mod(q1.z + 3.0, 6.0) - 3.0; q1.x = abs(q1.x) - 4.5 * cFactor;
        float dCol1 = length(max(abs(vec2(q1.x, q1.z)) - 0.4, 0.0)) - 0.05;

        // --- SECTORS 1 & 2 (0 to 130, gone by 145) ---
        if (currentZ < 145.0) {
        // Interpolate width and height
        float r_t = clamp((currentZ - 60.0) / 70.0, 0.0, 1.0);
        if (currentZ < 60.0) r_t = 0.0;
        float r_width = mix(12.0, 35.0, r_t) * cFactor;
        float r_ceilH = mix(7.0, 40.0, r_t) * mix(1.0, 0.45, 1.0 - cFactor);
        
        float dFloor = p.y - fY;
        float dCeil = (fY + r_ceilH) - p.y;
        float dWalls = r_width - abs(p.x);
        float dRoom12 = min(dFloor, min(dCeil, dWalls));

        vec3 q2 = p; q2.z = mod(q2.z + 15.0, 30.0) - 15.0; q2.x = abs(q2.x) - 16.0 * cFactor;
        float dCol2 = length(q2.xz) - 3.0;
        
        float dSec1 = min(dRoom12, dCol1);
        float dSec2 = min(dRoom12, dCol2);
        
        dBase = mix(dSec1, dSec2, smoothstep_custom(50.0, 70.0, currentZ));

        // Add glass slide for Sec 2
        if (currentZ > 60.0 && currentZ < 130.0) {
            float slide_x = cX;
            float slide_y = fY + 1.2;
            vec2 dSlideQ = vec2(p.x - slide_x, p.y - slide_y);
            dSlideHull = max(abs(length(dSlideQ) - 1.8) - 0.1, dSlideQ.y - 0.2);
            dBase = min(dBase, dSlideHull); 
        }
        }

        // --- SECTOR 3: CRYSTAL CAVE (130 to 210; in from 115, gone by 220) ---
        if (currentZ > 115.0 && currentZ < 220.0) {
        float dSec3 = caveField(p, vec3(p.x - cX, p.y - cY, p.z), fY - cY, crystal);
        cave = dSec3;
        dSec3 *= 0.6;

        dBase = currentZ < 145.0 ? mix(dBase, dSec3, smoothstep_custom(115.0, 145.0, currentZ)) : dSec3;
        }

        // --- SECTOR 4: THE IRON HYDRAULICS (210 to 280; in from 200, gone by 290) ---
        if (currentZ > 200.0 && currentZ < 290.0) {
        float hPart;
        float dSec4 = hydField(p, hPart) * 0.9;
        dBase = currentZ < 220.0 ? mix(dBase, dSec4, smoothstep_custom(200.0, 220.0, currentZ)) : dSec4;
        }

        // --- SECTOR 5: THE STAIR LABYRINTH (280 to 360; in from 270, gone by 370) ---
        if (currentZ > 270.0 && currentZ < 370.0) {
        float lPart;
        float dSec5 = labField(p, currentZ - 280.0, cFactor, lPart) * 0.8;
        dBase = currentZ < 290.0 ? mix(dBase, dSec5, smoothstep_custom(270.0, 290.0, currentZ)) : dSec5;
        }

        // --- SECTOR 6: HALLWAY EXIT (360 to 500; in from 340) ---
        if (currentZ > 340.0) {
        float dFloor6 = p.y - fY;
        float dCeil6 = (fY + 7.0 * mix(1.0, 0.45, 1.0 - cFactor)) - p.y;
        float dWalls6 = 12.0 * cFactor - abs(p.x);
        float dSec6 = min(dFloor6, min(dCeil6, dWalls6));
        dSec6 = min(dSec6, mix(100.0, dCol1, smoothstep_custom(450.0, 500.0, currentZ)));
        dBase = currentZ < 370.0 ? mix(dBase, dSec6, smoothstep_custom(340.0, 370.0, currentZ)) : dSec6;
        }

        dBase = max(dBase, -dCamSafety);
        res = opU(res, vec2(dBase, MAT_MATTE));

        // Resolve Material details (Crystal vs Matte vs Glass Tube)
        if (dBase == dSlideHull && currentZ > 60.0 && currentZ < 130.0) {
            res.y = MAT_GLASS;
        }
        if (currentZ > 120.0 && currentZ < 220.0 && crystal <= cave) {
            res.y = MAT_CRYSTAL;
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
