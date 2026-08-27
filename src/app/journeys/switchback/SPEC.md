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
| IV · the carpet concourse | 84 | mall interior at sunset, clerestory light |
| V · the chapel of folds | 72 | folded stone, god-rays, the second chain |
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
- `steepen(g, t)` blends in **angle space**, not slope space, and keeps its
  ordering: a beat authored as the gentlest descent is still the gentlest descent
  on the fourth lap, it is merely gentle at fifty-eight degrees. slope space is
  the obvious alternative and it collapses that ordering — `tan()` runs away so
  fast that the shallow beats stay shallow while the steep ones go vertical, and
  the lap stops being the same lap.
- **climbs give up**: `g * (1 - t)`. by the last lap there is nothing left to
  lift the cart back up with, which is the whole reason the lap stops closing.
- **the speeds follow.** three things held the ride down and all three give up
  together: drag falls off per lap until it stops binding, the chain and the
  brake fins lose their grip so the platform no longer pins the cart back to
  walking pace once a lap, and the `V_MAX` cap lifts out of the way so the
  *height of the drop* is what decides the speed rather than a constant. peak
  per lap: about **79, 122, 171 and 211 km/h**, which is roughly eighty-five per
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

## deterministic verification

```bash
bun test src/app/journeys/switchback/kinematics.test.mjs
bun tools/journey.mjs probe switchback --from=0 --to=280 --step=20
bun tools/journey.mjs scan switchback --from=200 --to=210 --step=0.25
bun tools/journey.mjs hud switchback --from=0 --to=240 --step=60
```

acceptance gates:

- `assertRouteSane` is empty, and the first lap's grades are all inside the
  thirty degrees the fit is honest over;
- every descent is steeper on each successive lap, and their *ordering* is
  unchanged;
- no discontinuity spike at the seam into the shaft — the tangent is continuous
  and the scan's worst deltas are the cart accelerating, not a pop;
- the speed is strictly increasing in the shaft with no asymptote: the last
  thirty seconds must add as much as the first thirty did;
- no black or blown frames anywhere in the route probe, the fall included.
