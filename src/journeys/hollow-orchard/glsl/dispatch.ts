export const dispatchGlsl = `  // --- dispatch ------------------------------------------------------------
  float stageSDF(vec3 p, float id) {
    if (id < 1.5)  return sdNursery(p);
    if (id < 2.5)  return sdSporeCathedral(p);
    if (id < 3.5)  return sdMarrowGrove(p);
    if (id < 4.5)  return sdRootLabyrinth(p);
    if (id < 5.5)  return sdFruitingBody(p);
    if (id < 6.5)  return sdTransition(p);
    if (id < 7.5)  return sdBloom(p);
    if (id < 8.5)  return sdHost(p);
    if (id < 9.5)  return sdHarvest(p);
    if (id < 10.5) return sdMycelialFall(p);
    if (id < 11.5) return sdSeedVault(p);
    return sdCompost(p);
  }

  // Crossfading two SDFs is a *morph*, not a union — which for fungus is the
  // correct artifact rather than a bug. Where it does misbehave it is buried
  // under the spore surge that peaks at exactly the same moment (see main).
  // The cleared aisle, as a capsule swept along the walked line: a vertical
  // stadium in (x, y), infinite in z, wobbling so it reads as eaten rather than
  // bored. Everything inside it is removed from the scene, which is the only
  // reason the camera can be promised a clear run — twelve stages all grow
  // something at the centre of their repeated cell, and that centre is the line
  // the camera walks.
  float aisleSD(vec3 p) {
    float r = uAisle.y + 0.20 * sin(p.z * 0.23) + 0.12 * sin(p.z * 0.61 + 1.1);
    vec2  q = vec2(p.x - trackX(p.z), p.y - uAisle.z);
    q.y     = max(0.0, abs(q.y) - uAisle.w);
    return length(q) - r;
  }

  float mapScene(vec3 p) {
    // Bend first: every SDF below sees the straight world it was authored in.
    p.x -= pathX(p.z);

    float dA = stageSDF(p, uStage.x);
    float d  = dA;

    if (uStage.z >= 0.002) {                  // uniform branch: coherent across the frame
      float mA = gMat, wA = gWet, gA = gGlow;
      float dB = stageSDF(p, uStage.y);
      gMat  = mix(mA, gMat,  uStage.z);
      gWet  = mix(wA, gWet,  uStage.z);
      gGlow = mix(gA, gGlow, uStage.z);
      d     = mix(dA, dB, uStage.z);
    }

    // Then carve. smax rather than max so the aisle blends into what it cut
    // instead of leaving a machined lip along its whole length.
    return smax(d, -aisleSD(p), 0.35);
  }

  vec3 calcNormal(vec3 p, float t) {
    vec2 e = vec2(1.0, -1.0) * (0.0009 + 0.0012 * t);
    return normalize(
      e.xyy * mapScene(p + e.xyy) +
      e.yyx * mapScene(p + e.yyx) +
      e.yxy * mapScene(p + e.yxy) +
      e.xxx * mapScene(p + e.xxx));
  }

  float calcAO(vec3 p, vec3 n) {
    float occ = 0.0, sca = 1.0;
    for (int i = 0; i < 4; i++) {
      float h = 0.02 + 0.14 * float(i);
      occ += (h - mapScene(p + n * h)) * sca;
      sca *= 0.72;
    }
    return clamp(1.0 - 1.6 * occ, 0.0, 1.0);
  }
`
