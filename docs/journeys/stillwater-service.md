# the stillwater service

A first-person recording of a municipal swimming pool that shares a service
route with an office maze and a structure in the open sea. Follow the navy
lane stripe: first on tile, then on carpet, a lift cage, a walkway, and finally
a baggage belt. The route returns to the lesson pool twice. On the third
iteration, the service door closes and the recording loses signal.

## Experience contract

The camera moves on authored rails. Use the existing transport to pause, seek,
change speed and jump between laps. Pointer, touch and keyboard look stay
available throughout. The route plays at walking speed where the viewer is on
foot, then changes its motion for the lift, submerged hall and baggage belt.

All times are journey-clock seconds at 1×. Act starts repeat at +144 s and
+288 s. Lap 2 starts at 2:24, lap 3 at 4:48, and the last door closes at 7:12.

| act | lap time | space and motion | handoff |
| --- | ---: | --- | --- |
| I. the lesson pool | 0–24 s | Walk beside a broad, shallow turquoise teaching pool with white ceramic ribs, high milk-glass skylights, black lane targets and empty observation windows. Turn to see the lane stripes continue over the waterline. Bare footsteps, long tile echoes. | A low tiled door leads under a changing bench into carpet. |
| II. the annex | 24–45 s | Take two tight right-angle turns through a low, amber-carpeted office maze. Repeating acoustic panels and square columns make distance hard to judge. One room contains a carpeted pool outline with lane markings. Dry fluorescent buzz and soft footfalls. | A closing freight gate fills the frame. |
| III. the service lift | 45–63 s | Ride down inside a stationary-feeling cage while shaft walls, floor slits, conduit and counterweights rise past it. The last landing overshoots, then eases back into register. Steel rattle and a falling motor tone. | An opaque landing shutter rises onto the sea. |
| IV. the breakwater | 63–97 s | Walk out onto a concrete walkway high above a dark, rough ocean. Cross two exposed bends, teeter near an unrailed edge and recover beside an intact post. White wave crests reveal the drop. Out at sea three colossal structures sit on the horizon. Wind, delayed surf and hollow metal underfoot. | An opaque sea-lock door closes on the horizon. |
| V. the drowned lounge | 97–120 s | Pass through a completely submerged tiled seating hall. Glide above drowned benches and stepped bleachers, then drift up toward a rectangular ceiling exit. Suspended grit, narrow bands of caustic light and low-pass water pressure. | A surface hatch opens on a dry tiled counter. |
| VI. lost property | 120–144 s | Ride the slow arc of an empty baggage carousel through a cold white sorting hall. Wire cages, numbered shelves and benches repeat in a wide curve. A single wet object circles past at belt speed. Gear ticks mark the arc. | A glazed inspection door passes across the lens. The first two openings return to the pool. The last door latches. |

Every act has its own silhouette, dominant color, camera movement and sound.
Door jambs, lift shutters and the hatch give each renderer switch a full-frame
occlusion. The cut happens at the act boundary, with door motion and sound
bridging it. Looking sideways may show the paired reveal, the jamb or the door.

## Three iterations

| act | 1 · inspection | 2 · misregistration | 3 · after closing |
| --- | --- | --- | --- |
| lesson pool | bright skylights, still water and four clean lane stripes | the water rises to the first step, one lane light stays off | high water erases the aisle reflections, emergency lamps rake the ribs |
| annex | lit grid and an empty carpeted pool outline | a wet carpet trail crosses the original lane stripe, alternate light banks dim | the floor markings climb the walls at the dead end, only low light remains |
| service lift | one regular stop | the cage passes a landing twice before it aligns | only a shaft inspection strip is lit at the bottom, the final overshoot lasts longer |
| breakwater | a rail ends before the first bend, cold blue-gray sea | more rail is gone, whitecaps pick out the first offshore structure | both bends are exposed, commanding swells cross in opposing directions and all three structures appear together |
| drowned lounge | benches and lane targets are legible from surface light | suspended particles thicken, a deeper blue eats the far end | the exit rectangle and caustics pick out the last row of seats |
| lost property | empty shelves and one glazed tile on the belt | wet traces collect under the carousel and its lights skip a bay | the tile completes its pass, the door closes and the tape loses signal |

Variation is authored at each lap, with any global palette/level change hidden
at the carousel door. Every lap completes the same six act identities in the
same order. After 432 s the camera holds at the latched door, the transport
keeps seeking/replaying, and the shared signal-loss sequence uses elapsed
time since the latch. The hold remains part of lap 3, act VI.

## The breakwater

Use metres for the crossing. The walkway deck is 78 m above mean water,
starts 1.85 m wide and narrows to 0.92 m at the exposed bend. Start with a
central view along the deck. Over a 5 s reveal, drift toward the outer edge
and let the camera bias down toward the ocean. At the closest point, the eye
is 0.14 m inboard of the concrete lip. Across the two bends, approach, hesitate
and recover in two distinct beats. Local act times 8–16 s stage the first
edge approach, 20–27 s the second. Roll peaks below 7°, and the camera is
always horizontally over the deck. The next post is the recovery point.

- The ocean stays black-blue between crests. Broad crossing swells produce
  moving silhouettes with peak crests 11–18 m above mean water across the
  three laps. Foam clings to the moving peaks and is legible downward in a
  tight crop. Wave displacement, shading and sound follow journey time.
- Three separate silhouettes rise from the sea 1.4–3.2 km away: a split
  concrete fork, a circular intake ring on legs and a stepped blade. Their
  visible heights range from 250–510 m. The walkway points past them and
  ends at a nearer sea-lock, so their scale stays unresolved. Atmospheric
  haze and surf crossing their bases establish distance.
- Keep the deck edge and at least one wave crest visible at the first
  teeter in a portrait crop. The second recovery frames the structures
  together on lap 3. Looking around changes gaze only. Replay and seek
  resolve to the same pose and wave phase.

## Implementation

- Implement under `src/journeys/stillwater-service/`, using the existing
  WebGL2 geometry renderer, shared GL/geometry helpers and journey shell.
  Keep the authored timeline, camera and sound cues independent of the
  renderer. Own act geometry in act-local coordinates and draw the current
  act with a deterministic occlusion across transitions.
- Use a single authored act table for the transport marks, HUD, renderer
  selection and cue timing. Sample lap, act phase, camera pose and terminal
  signal age from journey time. Keep procedural placement seeded and make
  seeks independent of viewing history or GPU quality.
- Use displaced mesh bands for the ocean with a coarse far band. The low
  tier keeps the same deck, major swells and three silhouettes while
  simplifying foam and small surface detail. Manage buffers and programs
  through the renderer lifecycle.
- Register the journey once in `definitions.ts`, add the route, channel
  entry, lightweight GLSL ES 1.00 preview driven by `iTime`, and a static
  poster. Build the synth score with the shared journey audio lifecycle.
  Add the journey to the README index.

## Verification

- Run the repo checks, static build and GLSL compile checks for the journey
  and the CRT previews. Capture a contact sheet of one moment per act on
  all three laps, plus portrait and landscape plates at both teeters.
- Probe immediately before and after each act and lap boundary, and before
  and after 432 s. The transport must agree with the frame. Check the
  two lap returns, terminal hold, pause, seek and repeatable fixed-time
  camera/wave state. Review the doors frame by frame across the switches.
- On a low tier, verify the deck edge, large waves and all three far
  artifacts still read. Check the synthesized chapter cues, mute, pause
  and seek through the shared transport.
