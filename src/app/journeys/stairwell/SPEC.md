# the stairwell

## experience contract

the stairwell is a 500-unit anthology repeated four times. every act keeps a
walkable descending stair or service path in view, but the surrounding landscape,
machinery, light, atmosphere and sound language must be recognisably different.
the route ends at 1999.75 units; the fourth shear horizon is a terminal authored
fall, not another seamless reset.

| distance | act | visual contract |
| ---: | --- | --- |
| 0–70 | spillway threshold | open flood-control terraces, sluice structures, cold dawn |
| 70–155 | protean weather bridge | exposed bridge inside deformed volumetric weather and pylons |
| 155–235 | turbine canyon | monumental rotating turbines flanking a narrow industrial descent |
| 235–325 | conveyor escarpment | warm quarry horizon, conveyor spans, excavator-like machinery |
| 325–410 | cooling field | cooling towers, pipe arrays and pale chemical atmosphere |
| 410–500 | shear horizon | cosmic-industrial rift, suspended fragments and loop rupture |

the next act begins blending at 58% progress. camera basis and sky palette blend
continuously; an atmospheric veil conceals the discrete sdf first-hit ownership
handoff. stepped geometry uses `pathY`, while the camera, look target and rails use
the continuous `railY`. do not attach the camera directly to the tread function.

## traversal rupture

`uRupture` is 0, 1/3, 2/3 and 1 on the four traversals. each preceding shear
horizon ramps toward the next traversal's value so the reset is visible in-world.
rupture increases displacement, debris, rift light, chromatic separation, audio
pressure and material instability. `uFinale` is non-zero only during the fourth
shear horizon and drives the broken path, camera pitch, fall and terminal signal.

## rendering and audio

the route uses `withJourneyShell` with a custom raw-webgl two-pass renderer:

1. `fsScene` raymarches the active environment, common path, machinery, rupture
   debris and the weather volume into a resized framebuffer.
2. `fsPost` applies the display treatment and rupture-dependent image shear.

the weather field is an original deformed-periodic volume with density-aware
march steps, technically inspired by nimitz's
[protean clouds](https://www.shadertoy.com/view/3l23Rh). the implementation does
not copy its constants, field equation, camera or palette. the referenced work is
licensed cc by-nc-sa 3.0; retain this attribution when redistributing the journey.

the web-audio graph shares the simulation uniforms. wind dominates the weather
bridge and cooling field, machine tones dominate the turbine and conveyor acts,
and impacts plus sub pressure grow with rupture and finale state.

## deterministic verification

```bash
bun test src/app/journeys/stairwell/kinematics.test.mjs
bun tools/journey.mjs probe stairwell --from=0 --to=475 --step=10
bun tools/journey.mjs scan stairwell --from=2 --to=8 --step=0.05
bun tools/journey.mjs scan stairwell --from=5 --to=13 --step=0.05
bun tools/journey.mjs hud stairwell --from=0 --to=475 --step=25
bun tools/journey.mjs fps stairwell --at=20,75,127,235,342,430,475 --w=1280 --h=720
```

acceptance gates:

- no black or blown frames in the full route probe;
- no repeated tread-frequency spike in the steady-walk scan;
- no section boundary among the transition scan's worst discontinuities;
- every hud control remains pixel-fixed across label changes;
- the simulation reaches exactly 1999.75 units and then holds;
- both shader programs compile in the live route and the static export builds.
