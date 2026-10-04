# Refactor plan (temporary; folded into docs/architecture.md at the end)

Branch `refactor/workspace-packages`. Assumption: the requested `./arc/packages` is a typo for `./src/packages`.

## Target tree

```
src/
  app/            Next routes only: layout, page, assets/page, journeys/<slug>/page.tsx, css, icons
  components/     React views
  hooks/          React hooks (state + effects live here, never in components)
  journeys/       framework-free journey content: registry, definitions, <slug>/{journey,shader,kinematics,audio,...}
  packages/       bun workspaces, framework-free, no react/next
    config/ math/ geometry/ gl/ glsl/ audio/ journey/ quality/ web/ delta/
assets/           every image: posters/, screenshots/, (no public/)
docs/             architecture, design system, tooling, gotchas, journeys/<slug>.md
tools/            CLI: journey.mjs, shoot-posters.mjs, verify-geometry.ts, harness/
```

## Phases

1. Move + de-barrel (codemod, import specifiers rewritten to defining modules). Probe-diff identical.
2. Dead code: knip + tsc --noUnusedLocals, iterated to zero.
3. Dedupe into packages (zeros, audio helpers, labelFor, ...).
4. One config file: src/packages/config/config.ts.
5. Screenshots to assets/ in kebab-case; posters imported statically; public/ removed.
6. React side: hooks split, state out of components.
7. Docs rewritten; this file deleted.

## Move map (phase 1)

- src/app/journeys/foundry/SPEC.md -> docs/journeys/foundry.md
- src/app/journeys/loop-line/SPEC.md -> docs/journeys/loop-line.md
- src/app/journeys/scenic-route/SPEC.md -> docs/journeys/scenic-route.md
- src/app/journeys/skybridges/SPEC.md -> docs/journeys/skybridges.md
- src/app/journeys/stairwell/SPEC.md -> docs/journeys/stairwell.md
- src/app/journeys/switchback/SPEC.md -> docs/journeys/switchback.md
- src/app/journeys/definitions.ts -> src/journeys/definitions.ts
- src/app/journeys/foundry/kinematics.ts -> src/journeys/foundry/kinematics.ts
- src/app/journeys/foundry/physics.test.mjs -> src/journeys/foundry/physics.test.mjs
- src/app/journeys/foundry/physics.ts -> src/journeys/foundry/physics.ts
- src/app/journeys/foundry/shader.ts -> src/journeys/foundry/shader.ts
- src/app/journeys/hollow-orchard/audio.ts -> src/journeys/hollow-orchard/audio.ts
- src/app/journeys/hollow-orchard/kinematics.ts -> src/journeys/hollow-orchard/kinematics.ts
- src/app/journeys/hollow-orchard/shader.ts -> src/journeys/hollow-orchard/shader.ts
- src/app/journeys/liminal/audio.ts -> src/journeys/liminal/audio.ts
- src/app/journeys/liminal/kinematics.ts -> src/journeys/liminal/kinematics.ts
- src/app/journeys/liminal/shaders.ts -> src/journeys/liminal/shaders.ts
- src/app/journeys/loop-line/audio.ts -> src/journeys/loop-line/audio.ts
- src/app/journeys/loop-line/dressing.ts -> src/journeys/loop-line/dressing.ts
- src/app/journeys/loop-line/geometry.ts -> src/journeys/loop-line/geometry.ts
- src/app/journeys/loop-line/kinematics.ts -> src/journeys/loop-line/kinematics.ts
- src/app/journeys/loop-line/scene.ts -> src/journeys/loop-line/scene.ts
- src/app/journeys/loop-line/shader.ts -> src/journeys/loop-line/shader.ts
- src/app/journeys/loop-line/stations.ts -> src/journeys/loop-line/stations.ts
- src/app/journeys/natatorium/audio.ts -> src/journeys/natatorium/audio.ts
- src/app/journeys/natatorium/kinematics.ts -> src/journeys/natatorium/kinematics.ts
- src/app/journeys/natatorium/shader.ts -> src/journeys/natatorium/shader.ts
- src/app/journeys/registry.ts -> src/journeys/registry.ts
- src/app/journeys/scenic-route/audio.ts -> src/journeys/scenic-route/audio.ts
- src/app/journeys/scenic-route/city.ts -> src/journeys/scenic-route/city.ts
- src/app/journeys/scenic-route/cockpit.ts -> src/journeys/scenic-route/cockpit.ts
- src/app/journeys/scenic-route/course.ts -> src/journeys/scenic-route/course.ts
- src/app/journeys/scenic-route/geometry.ts -> src/journeys/scenic-route/geometry.ts
- src/app/journeys/scenic-route/kinematics.test.mjs -> src/journeys/scenic-route/kinematics.test.mjs
- src/app/journeys/scenic-route/kinematics.ts -> src/journeys/scenic-route/kinematics.ts
- src/app/journeys/scenic-route/maw.ts -> src/journeys/scenic-route/maw.ts
- src/app/journeys/scenic-route/props.ts -> src/journeys/scenic-route/props.ts
- src/app/journeys/scenic-route/scene.ts -> src/journeys/scenic-route/scene.ts
- src/app/journeys/scenic-route/shader.ts -> src/journeys/scenic-route/shader.ts
- src/app/journeys/skybridges/kinematics.ts -> src/journeys/skybridges/kinematics.ts
- src/app/journeys/skybridges/shader.ts -> src/journeys/skybridges/shader.ts
- src/app/journeys/stairwell/audio.ts -> src/journeys/stairwell/audio.ts
- src/app/journeys/stairwell/kinematics.test.mjs -> src/journeys/stairwell/kinematics.test.mjs
- src/app/journeys/stairwell/kinematics.ts -> src/journeys/stairwell/kinematics.ts
- src/app/journeys/stairwell/renderer.ts -> src/journeys/stairwell/renderer.ts
- src/app/journeys/stairwell/shaders.ts -> src/journeys/stairwell/shaders.ts
- src/app/journeys/switchback/audio.ts -> src/journeys/switchback/audio.ts
- src/app/journeys/switchback/kinematics.test.mjs -> src/journeys/switchback/kinematics.test.mjs
- src/app/journeys/switchback/kinematics.ts -> src/journeys/switchback/kinematics.ts
- src/app/journeys/switchback/shader.ts -> src/journeys/switchback/shader.ts
- src/lib/audio/engine.ts -> src/packages/audio/engine.ts
- src/lib/audio/nodes.ts -> src/packages/audio/nodes.ts
- delta/build.mjs -> src/packages/delta/build.mjs
- delta/gl.ts -> src/packages/delta/gl.ts
- delta/glsl.ts -> src/packages/delta/glsl.ts
- delta/manifest.ts -> src/packages/delta/manifest.ts
- delta/materials/color.jpg -> src/packages/delta/materials/color.jpg
- delta/materials/detail.jpg -> src/packages/delta/materials/detail.jpg
- delta/materials/normal.jpg -> src/packages/delta/materials/normal.jpg
- delta/skies/DaySkyHDRI070B.jpg -> src/packages/delta/skies/DaySkyHDRI070B.jpg
- delta/skies/DaySkyHDRI071B.jpg -> src/packages/delta/skies/DaySkyHDRI071B.jpg
- delta/skies/EveningSkyHDRI045B.jpg -> src/packages/delta/skies/EveningSkyHDRI045B.jpg
- delta/skies/EveningSkyHDRI046B.jpg -> src/packages/delta/skies/EveningSkyHDRI046B.jpg
- delta/skies/EveningSkyHDRI047B.jpg -> src/packages/delta/skies/EveningSkyHDRI047B.jpg
- delta/skies/MorningSkyHDRI007B.jpg -> src/packages/delta/skies/MorningSkyHDRI007B.jpg
- delta/skies/MorningSkyHDRI011B.jpg -> src/packages/delta/skies/MorningSkyHDRI011B.jpg
- delta/skies/NightSkyHDRI003.jpg -> src/packages/delta/skies/NightSkyHDRI003.jpg
- delta/skies/NightSkyHDRI007.jpg -> src/packages/delta/skies/NightSkyHDRI007.jpg
- delta/skies/NightSkyHDRI008.jpg -> src/packages/delta/skies/NightSkyHDRI008.jpg
- delta/urls.ts -> src/packages/delta/urls.ts
- src/lib/curve.ts -> src/packages/geometry/curve.ts
- src/lib/sweep.ts -> src/packages/geometry/sweep.ts
- src/lib/gl/context.ts -> src/packages/gl/context.ts
- src/lib/gl/crtPass.ts -> src/packages/gl/crtPass.ts
- src/lib/gl/program.ts -> src/packages/gl/program.ts
- src/lib/gl/quad.ts -> src/packages/gl/quad.ts
- src/lib/gl/shaderQuad.ts -> src/packages/gl/shaderQuad.ts
- src/lib/gl/targets.ts -> src/packages/gl/targets.ts
- src/lib/gl/texture.ts -> src/packages/gl/texture.ts
- src/lib/gl/uniforms.ts -> src/packages/gl/uniforms.ts
- src/lib/glsl/color.ts -> src/packages/glsl/color.ts
- src/lib/glsl/hash.ts -> src/packages/glsl/hash.ts
- src/lib/glsl/noise.ts -> src/packages/glsl/noise.ts
- src/lib/glsl/sdf.ts -> src/packages/glsl/sdf.ts
- src/lib/journey/definition.ts -> src/packages/journey/definition.ts
- src/lib/journey/frame.ts -> src/packages/journey/frame.ts
- src/lib/journey/label.ts -> src/packages/journey/label.ts
- src/lib/journey/seek.ts -> src/packages/journey/seek.ts
- src/lib/signalLoss.test.mjs -> src/packages/journey/signalLoss.test.mjs
- src/lib/signalLoss.ts -> src/packages/journey/signalLoss.ts
- src/lib/signalOverlay.ts -> src/packages/journey/signalOverlay.ts
- src/lib/journey/transport.test.mjs -> src/packages/journey/transport.test.mjs
- src/lib/journey/transport.ts -> src/packages/journey/transport.ts
- src/lib/journey/types.ts -> src/packages/journey/types.ts
- src/lib/mat4.ts -> src/packages/math/mat4.ts
- src/lib/rng.ts -> src/packages/math/rng.ts
- src/lib/math.ts -> src/packages/math/scalar.ts
- src/lib/quality/device.ts -> src/packages/quality/device.ts
- src/lib/quality/governor.test.mjs -> src/packages/quality/governor.test.mjs
- src/lib/quality/governor.ts -> src/packages/quality/governor.ts
- src/lib/settings.ts -> src/packages/quality/settings.ts
- src/lib/quality/index.ts -> src/packages/quality/tiers.ts
- src/lib/assetUrl.ts -> src/packages/web/assetUrl.ts
- src/lib/canvasText.ts -> src/packages/web/canvasText.ts
- src/lib/debugParams.ts -> src/packages/web/debugParams.ts
- src/lib/glitchTitle.ts -> src/packages/web/glitchTitle.ts
- src/lib/panControl.ts -> src/packages/web/panControl.ts
