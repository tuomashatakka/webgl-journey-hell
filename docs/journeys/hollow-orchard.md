# the hollow orchard

## the motive

an orchard grown in the dark under the ground, tended by nobody, lit by its own
fungi. you are not walking through it, you are being grown by it.

the lanterns are the lure. every stage plants a trail of bioluminescent bodies
beside the walked line (caps on the floor, pods on cords, nodules on the flesh,
wisps over the sludge) and the trail is the only thing in the dark that seems to
lead anywhere, so you follow it. it leads down: through the nursery where the
orchard starts its saplings, past the bone trunks and through the roots, into
its fruiting body, and over the edge. the six setpieces of the abyss are the
orchard's harvest, and you are what is being harvested: taken into the bloom,
grown into the wall of the host, hung in the harvest, carried down the
mycelium, stored in the seed vault, and finally composted. the compost hands you
back to the nursery as a seedling. that is the loop.

the orchard is not the bottom. something under it is what it feeds, and every
time you are composted you are put back into the ground a little closer to it.
from the second loop it starts coming up through the orchard: the ground cracks,
red light rises out of the cracks, the world writhes, and the lanterns turn the
same red. on the fourth loop the compost stops handing you back. you have been
planted.

## the loop

one 660-unit lap, `ORCHARD_LOOP_Z`, ridden four times. six scapes you walk, then
six setpieces you fall through, each slot a sixth of `ABYSS_LEN` (130). walk
speed is per stage and integrated, so z is a distance and not `time * SPEED`.

| stage | len | eye | speed | contract | lanterns |
| --- | ---: | ---: | ---: | --- | --- |
| 1 · the nursery | 90 | 1.7 | 7.5 | rows of pale saplings under a low sagging ceiling, caps on a third of them | cap clusters on the floor, foxfire green |
| 2 · spore cathedral | 100 | 1.8 | 5.5 | stems as columns, caps as vaulting, the spores thickest | pods on long cords, green-gold |
| 3 · marrow grove | 90 | 1.65 | 7 | knuckled bone-white trunks on dark loam, fallen bones | cap clusters, cold cyan |
| 4 · the root labyrinth | 100 | 1.15 | 4 | a low passage dug on the walked line, braided shut: braids along the shoulders and crown, roots across the vault, rootlets from the ceiling; lit from the eye | pods hung from the arch, green |
| 5 · fruiting body | 90 | 1.4 | 3.2 | a breathing tube of wet muscle, sphincter rings, polyps | nodules on the wall, pale cyan |
| 6 · transition | 60 | 1.6 | 6 | the nursery dying, the floor opening into the shaft | cap clusters, guttering |
| the bloom | 21.7 | 1.2 | 5 | one enormous cap overhead, falling into its gilled funnel and throat | pods under the cap, amber |
| host | 21.7 | 1.75 | 4 | bodies grown into the wall of a shaft | nodules on the wall, green |
| the harvest | 21.7 | 1.6 | 4.5 | fruiting bodies hung on cords in a torn shaft | pods, yellow-green |
| mycelial fall | 21.7 | 0.9 | 12 | no floor and no walls: three lattices of filament | wisps, blue |
| seed vault | 21.7 | 1.5 | 5 | chambered pods, each with something curled inside | pods, violet |
| compost | 21.7 | 1.3 | 2.5 | everything softened back into sludge; stalls on the fourth loop | will-o'-the-wisps, wavering |

scape to scape crossfades over the last `SCAPE_W` (12) units of a band; setpieces
over the last `PIECE_W` (0.3) of a slot. a crossfade is a morph of the two SDFs
under a surge of spores, never a cut.

## the progression

three ramps carry the arc, all continuous in distance walked, none table-driven.

- **rot** (`min(1, loop * 0.33 + descent * 0.22)`): decay. fbm displacement,
  wetness, a palette sliding toward bruised violet, a wider lens, slower walking.
- **descent** (0..1 through the abyss): the fall within a loop. the glow rises with it.
- **breach** (0..1): the red under the orchard. it is the escalation between
  loops, so the first loop never sees it:

  | | |
  | --- | --- |
  | `BREACH_FROM` | 0.9 laps: the first crack opens in the last stretch of the first compost |
  | `BREACH_LAPS` | 3 laps from there to a full breach |
  | ramp | eased out, `1 - (1 - x)^2`: about 0.07 entering loop 2, 0.6 entering loop 3, 0.9 entering loop 4 |
  | `BREACH_WARP` | 0.75 world units of domain warp at a full breach (amplitude `breach^1.4`) |
  | `BEAT_HZ` | 0.62 Hz heartbeat, a double thump, quickening by 70 % at a full breach |
  | `BREACH_RED` | the lanterns end 80 % of the way to it |

  what it does, in the order it arrives:
  - **loop 2**: the first fissures, thin and few, glowing on whatever surface
    crosses them; the lanterns begin to redden; the fog warms.
  - **loop 3**: the fissures spread across every surface with scorched lips and
    hairline cracks branching off them; red shafts stand in the air between
    them; the world starts to writhe; the camera rolls.
  - **loop 4**: the fissures are open seams, the shafts flood the air on the
    heartbeat, the lens bends hard, the lanterns are the same red as what is
    under them, and the compost stalls.

## how it is built

- the shader owns geometry and light; the simulation owns pacing, palette and
  camera and uploads them (`kinematics.ts` `uniforms()`). no table is mirrored in GLSL.
- the route bends by warping the domain (`pathX`), and an **aisle** (a capsule
  swept along the walked line) is carved out of everything, so the camera can
  never be inside geometry. the breach's warp is applied after the bend and
  never to the aisle, which is what keeps the way open while the world writhes.
- **the lanterns** (`glsl/lanterns.ts`): one per cell along z, per stage spacing,
  hashed side and jitter, placed clear of the aisle. their bodies are added to
  their stage's SDF and emit (`gGlow` above 1); their light on a surface is the
  three nearest, windowed to zero by 1.2 cells so no cell edge shows; their halo
  is the closed-form line integral of `r^2 / (r^2 + d^2)` for seven lanterns
  along the view ray, so it costs no march steps.
- **the breach** (`glsl/rift.ts`): one fissure pattern, a 2D Voronoi border
  network on the plane across `RIFT_DIR`, extruded along it. on a surface it is
  the cracks; in the air it is the shafts. because it is constant along the
  light's direction, every shaft comes out of a crack and goes into another one
  without tracing anything. shafts are 8 jittered samples (16 with heavy
  effects) and saturate rather than clip. at breach 0 none of it is evaluated.
- the key light is dimmed (`0.08 + 0.55 * ndl`) to leave the lanterns room to be
  what lights a stage. the root labyrinth adds a falloff light from the eye.

## verifying

- `node tools/journey.mjs contact hollow-orchard --bare --from=4 --to=136 --step=6 --cols=5`: one loop.
- `--from=150 --to=600 --step=30`: loops 2 to 4; the breach should be faint at
  150, plain by 300 and flooding by 480.
- the first loop must be untouched by the breach: probe `--from=0 --to=120` is
  byte-identical with the breach code removed.
