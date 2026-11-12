# the switchback

## experience contract

a gravity railway on a six-room lap, ridden four times and then not ridden at
all. the lap does not close in space and does not need to — you cannot see far
enough to tell — but it closes in *grade*, because that is a tangent and a
discontinuous tangent is a derailment. `assertRouteSane` checks that cyclically,
along with the pointwise and windowed curvature bounds the bend fit can carry.

| section | len | contract |
| --- | ---: | --- |
| I · the boarding platform | 72 | fluorescent boarding station, wet tile, the brake and the first chain |
| II · the chalk drift | 78 | hand-cut adit, timber sets, dust, the crest |
| III · the scaffold void | 96 | steel lattice suspended in nothing, the big drop |
| IV · the carpet concourse | 84 | mall interior at sunset, clerestory light: a galleria with a gallery over shopfront arcades down both sides, a glazed band round each haunch of the vault, and the carpet |
| V · the chapel of folds | 72 | folded stone with a nave cut through it, god-rays from lancets in the east wall, the second chain |
| VI · the overlook | 90 | open sky over a cloud sea, drifting ash — and the seam |

everything that gets worse per lap ramps across **the overlook**, which is the
one stretch with no near geometry: lamps going out, ash thickening, the fissures
opening and the railway tipping over all happen against open sky where there is
nothing to pop.

## the pitch-over

the railway does not decay only in its lamps and its paint. every lap it tips
further over, until the last one is barely a railway at all.

- the **first lap is the authored table untouched**. it is the reference the rest
  is heard against, and steepening it would make the ride steep rather than make
  it *get* steep.
- `pitchAt(s)` is `lapF / PITCH_LAPS`, so it arrives as a ramp across the
  overlook rather than a step at the seam.
- `steepen(g, t)` is a **gain and a bias in angle space** — one affine function
  meeting three requirements at once:
  - **continuity**: it cannot jump, anywhere, for any grade;
  - **ordering**: a positive gain cannot reorder two grades, so the beat authored
    as the gentlest descent is still the gentlest on the fourth lap, merely
    gentle at fifty degrees;
  - **tangents**: two sections that agreed on a grade still agree after it, so
    the cyclic continuity `assertRouteSane` checks survives for free.

  slope space is the obvious alternative and it fails the second: `tan()` runs
  away so fast that the shallow beats stay shallow while the steep ones go
  vertical, and the lap stops being the same lap.

  the first version ran descents and climbs through *different* formulas and gave
  every descent a floor of fifty-eight degrees, so a grade crossing zero — which
  the authored table does five times a lap — jumped instantly from level to a
  third of the way past vertical. **over a thousand degrees per metre on the
  second lap.** from inside the cart that is not a steep railway, it is a
  stutter, and it lands on every section boundary in the journey. the fix is the
  affine form above; the guard is the sweep in the verification block below.
- **climbs give up**, but as a consequence rather than as a special case: by the
  last lap the bias has taken the whole profile below level and there is nothing
  left to lift the cart with, which is why the lap stops closing.
- **the speeds follow.** three things held the ride down and all three give up
  together: drag falls off per lap until it stops binding, the chain and the
  brake fins lose their grip so the platform no longer pins the cart back to
  walking pace once a lap, and the `V_MAX` cap lifts out of the way so the
  *height of the drop* is what decides the speed rather than a constant. peak
  per lap: about **78, 124, 177 and 220 km/h**, which is roughly eighty-five per
  cent of what falling the lap's own height would give you. then the fall, which
  has no number.

  the chain was the one that mattered most and the least obvious: no amount of
  tipping the descents over made the ride faster while the brake at the platform
  reset it to walking pace every lap, because then no lap ever had more than one
  section's worth of runway in it.

the pitch-over deliberately exceeds the windowed-turn bound the authored table is
validated against. `fitBend`'s `!got2` path is what carries it: a track that
never reaches 56 metres of depth inside its 88 metres of walk pins the far knot
to wherever the walk actually ended, so the near half of the picture still gets
its curve. this is a documented degradation, not an accident.

## the bank

the cart banks live — the resultant of gravity and the turn is held square to the
floor — which is a small lie that reads as a very good one, but only up to about
the speed the track was designed for. `atan2(v²·curv, G)` saturates, so at four
times that speed the bank sits pinned at its ±0.85 limit through every turn and
then crosses the whole range inside the centimetre where the curvature changes
sign. that is a roll stutter on every beat boundary and it is not the track. the
bank therefore reads `min(speed, V_MAX)`; the *ride* still gets faster, the
picture just stops pretending the banking does.

## the chapel

the fold on its own is a solid with no way through it and no order in it. the
room is what is cut into it, and every cut is read by more than one caller, so a
shaft of light cannot fail to have a window at the end of it.

- **the nave** (`naveAir`): walls to a springing line at 4.6 m, then a pointed
  vault struck from two centres, apex 9.7 m, 3.3 m to each side of the track.
  `NAVE_W`, `NAVE_SPRING`, `NAVE_C`.
- **a bay is 8 m** (`NAVE_BAY`, divides `PHASE_WRAP`). a rib stands on each bay
  line, the nave's own profile thickened; a lancet stands in the middle of each
  bay; the fold is mirrored on the same period.
- **the lancets** (`lancet`): windows in the east wall, 2.3 m wide, sill at 3.2 m,
  pointed head at 8.2 m. the function carries a point back along `NAVE_SUN` to
  the wall and tests the window there, so one field is the leaded glass on the
  wall (emission), the embrasure cut through the fold, the pool of light on the
  floor (`directLight`) and the god-ray in the air (`naveShafts`).
- `NAVE_SUN` is a constant in the track's frame, not `uSun`: the windows are
  built into the wall and the wall turns with the track.
- **the god-rays** have their own loop: 26 samples on a step that grows from
  0.9 m, jittered with interleaved gradient noise, edges softened by the step
  length. nothing in it touches the map. it returns before sampling when no
  resident slot is the chapel, so every other room's frame is unchanged.
- **the fronts**: a wall across the whole profile at both ends of the room, with
  the nave's arch for a doorway. the fold stops at them.
- **votive lamps** hang on chains from the crown, at the pitch and height the
  route table already gives the room's lamps.
- deep in the nave's air (`naveAir < -1.1`) the map returns the cut as its bound
  and skips the fold. that is most of every ray that looks down the track, and
  it is why the room costs no more than the bare fold did.

## the concourse

the room the route table carves is a mall's section already: a barrel vault over
the middle (radius 7.875 m sprung from 2.625 m, which is what `roomProfile`
makes of the table's 11 m bore and 10.5 m ceiling; `MALL_R`, `MALL_ARCH_Y`) and
a low aisle down either side. what it lacked was a building, and the building is
authored into that section rather than changing it. as in the chapel, the
glazing is one set of numbers read by everything that needs it.

- **a bay is 5 m** (`MALL_BAY`, divides `PHASE_WRAP`; the mullions stand on a
  quarter of it). a rib crosses the vault on every bay line, 0.30 m deep, with a
  column under it and a shopfront between two of them.
- **the gallery**: a slab off both springing lines, edge 6.3 m off the track
  (`MALL_GAL_X`), floor at 3.375 m (`MALL_GAL_Y`), a 1.08 m glass balustrade on
  the edge with its rail drawn by the shading, columns of 0.25 m radius under
  it. the aisles under it are the arcades.
- **the clerestory**: a band of glazing round each haunch between 24 and 60
  degrees (`MALL_WIN_Y0` 3.203 and `MALL_WIN_Y1` 6.820 above the vault's
  centre), three lights high (transoms at 36 and 48 degrees), a mullion every
  1.25 m. the east panes show the sky the sun is leaving, horizon at the sill and
  zenith at the head; the west panes are the sun in dust, hotter the nearer the
  line of sight runs to it.
- `MALL_SUN` (0.773, 0.503, 0.387) is a constant in the track's frame, not
  `uSun`, for the chapel's reason: ahead, off to the right, thirty degrees up,
  so the light comes down across the hall toward the cart.
- **`mallSun`** carries a point back along `MALL_SUN` to the vault (a circle in
  section, so one square root) and tests the glazing there. one field is the
  pool on the far carpet and up the far arcade (`directLight`, 1.25 x the sun
  term, shadow ray only inside the beam and stopped 2 m short of the glass) and
  the beam in the air. under the far gallery only what clears the slab's edge
  gets in.
- **the beam** is accumulated in `naveShafts`, the chapel's loop: the two rooms
  are neighbours, the chapel is always in the window from the concourse, and a
  loop each paid for every sample's crossing into track space twice. the
  concourse's samples read the band and the ribs' shadows only (its transoms
  and mullions are below a step) and are brightest looking up the light.
- **the arcades**: a shopfront to a bay on the back wall, by a roll per bay: 40 %
  a roller shutter with a notice on it, 28 % dark glass with one taped inside,
  32 % lit (`mallShopLit`: fewer by the lap, one in four of those flickering) in
  tungsten, mint or pink. a sign box on every fascia in lettering nobody can
  read (`mallGlyphs`). lay-in ceiling tiles with a downlight every 2.5 m, 8.7 m
  off the track; terrazzo underfoot with a brass strip where the carpet stops.
- **the upper shops** are drawn on the vault between the gallery and the sill
  of the glazing, under a teal stripe at 5.42 m and a crimson one at 5.60 m.
- **the crown** is plaster panels with the room's lamps let into it as
  luminous panels, at the pitch and height the route table gives.
- **the carpet** (`mallCarpet`): a 1.25 m repeat on a plum ground, a crimson
  lozenge with a teal eye on the even squares, a mustard squiggle on the odd
  ones, a teal pip on every corner; a dark border with a mustard pinstripe
  beside the ballast and along the foot of the columns. the print goes to its
  mean between 12 and 44 m; the borders run with the view and carry on.
- **the hall floor**: 4.2 m off the track on both sides, a palm in a tub on the
  tens (two rings of blades, seven arching and six hanging) and a bench on the
  fives. a pair of stopped escalators every 40 m, 5.7 m off the track at thirty
  degrees, each between two palms, left out where an end of the room would cut
  one in half.
- **the front**: a glazed lunette across the vault at the room's own front,
  standing on the gallery, with a fan of bars every 15 degrees over a transom
  that carries the name of the place. from the void it glows with the hall; the
  way in is everything under it. the far end is the chapel's gable, which stands
  half in this room and is the chapel's stone on both faces.
- **the light**: the sun through the clerestory, the crown lamps, and an
  ambient that is the two clerestories (lilac from the east, the sun's colour
  from the west, by which way a surface faces) over the room's haze, falling by
  80 % under the galleries, where the downlights and the lit shop windows take
  over (each windowed to nothing at the edge of its own cell). the crown lamps
  march no shadow ray: the one thing they are ever behind is a gallery, and that
  shade is closed-form (`mallLampShade`).
- **what it costs**: the props are three groups behind bounds (the walls, the
  hall floor, the escalators), so a ray down the middle of the hall pays for one
  square root; the shading takes one four-octave field and one grain per hit and
  hands them down. counted with a `gEvals += 1.0` in `mapTrack`, a pixel in the
  room takes about 54 scene evaluations against 63 for the bare vault it
  replaced: the march is longer (41 steps against 35) and the two shadow rays it
  no longer marches more than pay for it. every frame with no concourse in it is
  byte-identical. the shader itself is larger, which a GPU that branches does
  not pay for outside the room and a rasteriser that runs both sides of every
  branch pays for everywhere (`gotchas.md`); it has not been timed on a phone.

## the fissures

`uFall.w` is one number, read twice — once by the surface, where the field's zero
set is a split in the wall, and once by the volumetrics, where it is the beam
coming through the split. sharing the field is not an optimisation: it is the only
way a beam reliably has a crack at the end of it, and two fields tuned to look
alike drift apart the moment either is touched.

- it opens **every lap** (`lapF * 0.24`) and saturates in the shaft.
- the fissures are **emission**, not a dark line in the albedo. a crack you can
  see through is the point; a painted-on one reads as dirt, and this railway has
  dirt already.
- the `patch` term is what keeps it a set of cracks rather than a texture. opened
  too far, the seams reach everywhere at once and the wall stops reading as
  broken and starts reading as red.
- **a crack needs a wall.** the void and the overlook have none, and beams in
  them hang light in mid-air across an open sky, so both are gated out by bore.
- emission fades with range. a crack network is finer than a pixel by forty
  metres out; left at full strength the far wall stipples, the beams light the
  stipple, and it reads as noise rather than as distance. the fog takes over.

## the fall

four laps in, the rails stop. not at a buffer stop and not at a portal — they are
simply not there, and the sleeper at the mouth is the last sleeper. that
abruptness is the event.

- `FALL_START = LAP_LEN * 4`. everything past it is **outside the lap**:
  `FALL_SECTION` is not in `SECTIONS`, so `assertRouteSane` still validates a
  six-room cyclic railway and the shaft cannot break it.
- the seam is continuous in the tangent by construction — `FALL_ENTRY_GRADE` is
  `steepen(-20°, 1)`, the exact value the fourth lap's last grade tips to — and
  asserted anyway, because two different formulas meeting is a different risk
  from one formula meeting itself.
- **no ceiling on the speed.** no drag term and no clamp: `v += g·sin(-grade)·h`
  and nothing else. it is past 1000 km/h inside a minute and still gaining.
  everything downstream stays a pure function of `s`, so a seek still reproduces
  it exactly.
- `mapTrack` gates the rails and sleepers on `railEndZ()`, read off the resident
  slots. the shaft's own props are the buckled ribs that were holding it open and
  the pieces of wall that are no longer in it — nothing smaller registers at the
  speed this is seen at.
- the scape twists: `fallWarp` is a rotation (an isometry, free to the sphere
  trace) plus a lateral snake whose slope is held at 0.07 so `mapTrack`'s claim
  to be 1-Lipschitz survives the 0.92 the march already steps at.
- the palette is **liminal's abyss**: black, with a red core where a horizon
  would be if the shaft had one, and nothing else in it at all. the only light in
  the room comes through the cracks.
- the wheels-on-rail bed goes with the track. leaving it running is the audible
  version of drawing sleepers in mid-air, and it is the one thing that would give
  the section away.
- eight seconds in, the signal starts to go and never comes back. shared rather
  than authored here — the shaft reports its seconds as `JourneyMarks.signalAge`
  and `src/packages/journey/signalLoss.ts` does the rest.

## deterministic verification

```bash
bun test src/journeys/switchback/kinematics.test.mjs
bun tools/journey.mjs probe switchback --from=0 --to=280 --step=20
bun tools/journey.mjs scan switchback --from=200 --to=210 --step=0.25
bun tools/journey.mjs hud switchback --from=0 --to=240 --step=60
node tools/journey.mjs contact switchback --bare --from=40 --to=49.5 --step=0.5 --cols=5   # the concourse
node tools/journey.mjs contact switchback --bare --at=98,126.4,141.3 --cols=3            # ...on laps 2 to 4
```

acceptance gates:

- `assertRouteSane` is empty, and the first lap's grades are all inside the
  thirty degrees the fit is honest over;
- **the grade is smooth on every lap.** sweep `gradeAt` at 2 cm and take the
  worst `|Δgrade|`: it must stay within an order of magnitude of the first lap's
  own rate — about 1.5 deg/m — on every lap. this is the one number that catches
  the failure above, and no image test does;
- every descent is steeper on each successive lap, and their *ordering* is
  unchanged;
- no discontinuity spike at the seam into the shaft — the tangent is continuous
  and the scan's worst deltas are the cart accelerating, not a pop;
- the speed is strictly increasing in the shaft with no asymptote: the last
  thirty seconds must add as much as the first thirty did;
- no black or blown frames anywhere in the route probe, the fall included.
