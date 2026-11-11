// Single source of truth for the index and the journey routes.
// Adding a journey = append one entry here + create app/journeys/<slug>/page.tsx.
import { staticUrl } from '@wjh/web/assetUrl'
import liminalPoster from '../../assets/posters/liminal.jpg'
import switchbackPoster from '../../assets/posters/switchback.jpg'
import natatoriumPoster from '../../assets/posters/natatorium.jpg'
import stairwellPoster from '../../assets/posters/stairwell.jpg'
import skybridgesPoster from '../../assets/posters/skybridges.jpg'
import foundryPoster from '../../assets/posters/foundry.jpg'
import hollowOrchardPoster from '../../assets/posters/hollow-orchard.jpg'
import loopLinePoster from '../../assets/posters/loop-line.jpg'
import scenicRoutePoster from '../../assets/posters/scenic-route.jpg'
import { foundryPreviewFrag } from './foundry/shader'
import { hollowOrchardPreviewFrag } from './hollow-orchard/shader'
import { loopLinePreviewFrag } from './loop-line/shader/post'
import { natatoriumPreviewFrag } from './natatorium/shader'
import { scenicRoutePreviewFrag } from './scenic-route/shader/post'
import { skybridgesPreviewFrag } from './skybridges/shader'
import { stairwellPreviewFrag } from './stairwell/shaders'
import { switchbackPreviewFrag } from './switchback/shader'

// Liminal hover preview: a lightweight stand-in for the real (1100-line) fsScene —
// a descending neon tunnel with a red void core and CRT scanlines.
const liminalPreviewFrag = `
  precision highp float;
  uniform vec2 iResolution;
  uniform float iTime;
  uniform vec2 uPointer;

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    uv += uPointer * 0.15;

    float r = length(uv);
    float a = atan(uv.y, uv.x);
    float depth = iTime * 0.6 + 0.25 / (r + 0.05);

    float rings = sin(depth * 8.0) * 0.5 + 0.5;
    float spokes = sin(a * 8.0 + depth * 2.0) * 0.5 + 0.5;
    float grid = pow(rings * spokes, 2.0);

    vec3 col = mix(vec3(0.02, 0.0, 0.04), vec3(0.0, 1.0, 0.667), grid);
    col *= smoothstep(0.0, 0.6, r);            // fade into the central void
    col += vec3(0.6, 0.0, 0.2) * pow(1.0 - r, 3.0) * 0.5; // red core glow
    col -= sin(gl_FragCoord.y * 1.5 + iTime * 10.0) * 0.06; // scanlines

    gl_FragColor = vec4(col, 1.0);
  }
`

export const JOURNEYS: Journey[] = [
  {
    slug:          'liminal',
    title:         'THE LIMINAL JOURNEY',
    tagline:       'A descent through the abyss — watch 3 iterations and you will see.',
    tags:          [ 'raymarch', 'horror', 'CRT', 'audio' ],
    accent:        '#00ffaa',
    gradient:      [ '#04110d', '#0a0410' ],
    poster:        staticUrl(liminalPoster),
    previewShader: liminalPreviewFrag,
    status:        'live',
  },
  {
    slug:          'switchback',
    title:         'THE SWITCHBACK',
    tagline:       'The cart is a gravity machine and the brakes are only at the platform. Six rooms, and it comes back round.',
    tags:          [ 'raymarch', 'dreamcore', 'mine cart', 'coaster', 'simulated', 'loop' ],
    accent:        '#ff9ec4',
    gradient:      [ '#f3b9c8', '#221226' ],
    poster:        staticUrl(switchbackPoster),
    previewShader: switchbackPreviewFrag,
    status:        'live',
  },
  {
    slug:          'natatorium',
    title:         'THE NATATORIUM',
    tagline:       'The pool has been filling for a long time, and the route only goes downhill.',
    tags:          [ 'raymarch', 'poolrooms', 'liminal', 'water', 'audio' ],
    accent:        '#67d5e0',
    gradient:      [ '#9fd0dc', '#2c5866' ],
    poster:        staticUrl(natatoriumPoster),
    previewShader: natatoriumPreviewFrag,
    status:        'live',
  },
  {
    slug:          'stairwell',
    title:         'THE STAIRWELL',
    tagline:       'Six industrial horizons rupture further every time the stairs return.',
    tags:          [ 'raymarch', 'industrial', 'volumetric', 'loop', 'audio' ],
    accent:        '#9ed9ff',
    gradient:      [ '#142835', '#190a28' ],
    poster:        staticUrl(stairwellPoster),
    previewShader: stairwellPreviewFrag,
    status:        'live',
  },
  {
    slug:          'skybridges',
    title:         'SKYBRIDGES',
    tagline:       'Sprint for your life as the glass bridge cracks apart at the clouds\' height.',
    tags:          [ 'raymarch', 'glass', 'vertigo' ],
    accent:        '#9fd8ff',
    gradient:      [ '#dbe6f2', '#aebfce' ],
    poster:        staticUrl(skybridgesPoster),
    previewShader: skybridgesPreviewFrag,
    status:        'live',
  },
  {
    slug:          'foundry',
    title:         'THE FOUNDRY',
    tagline:       'Walk the seven halls. The seventh runs back into the first, a little more wrong each time.',
    tags:          [ 'raymarch', 'industrial', 'rigid-body', 'simulated', 'loop' ],
    accent:        '#ff8a3d',
    gradient:      [ '#241206', '#0a0708' ],
    poster:        staticUrl(foundryPoster),
    previewShader: foundryPreviewFrag,
    status:        'live',
  },
  {
    slug:          'hollow-orchard',
    title:         'THE HOLLOW ORCHARD',
    tagline:       'Something was planted down here. It finished growing, and it has been waiting for a body.',
    tags:          [ 'raymarch', 'body-horror', 'organic', 'audio', 'loop' ],
    accent:        '#d8a13a',
    gradient:      [ '#2a1c07', '#150a1b' ],
    poster:        staticUrl(hollowOrchardPoster),
    previewShader: hollowOrchardPreviewFrag,
    status:        'live',
  },
  {
    slug:          'loop-line',
    title:         'THE LOOP LINE',
    tagline:       'Six stations on a circle line with no terminus. It comes round more broken every time, and the timetable has no last train.',
    tags:          [ 'geometry', 'rasterized', 'transit', 'dreamcore', 'simulated', 'loop' ],
    accent:        '#b39dff',
    gradient:      [ '#cfc4ff', '#0d0b14' ],
    poster:        staticUrl(loopLinePoster),
    previewShader: loopLinePreviewFrag,
    status:        'live',
  },
  {
    slug:          'scenic-route',
    title:         'THE SCENIC ROUTE',
    tagline:       'Seven miles of the prettiest road in the county. It goes off the cliff at the end, and something down there has its mouth open.',
    tags:          [ 'geometry', 'rasterized', 'driving', 'coaster', 'sea', 'body-horror', 'simulated', 'loop' ],
    accent:        '#ffb054',
    gradient:      [ '#f2c27a', '#061a26' ],
    poster:        staticUrl(scenicRoutePoster),
    previewShader: scenicRoutePreviewFrag,
    status:        'live',
  },
]

export interface Journey {

  /** Route segment + folder name under app/journeys/. */
  slug:    string;
  title:   string;
  tagline: string;
  tags:    string[];

  /** Drives the card's border glow + tag color. */
  accent: string;

  /** CSS poster gradient — the last-resort backdrop if the poster 404s too. */
  gradient: [string, string];

  /**
   * Screenshot of the running journey (assets/posters), shown before hover and
   * wherever the live preview can't run: touch devices with no hover, browsers
   * without WebGL, a preview shader that failed to compile. Captured with
   * `tools/shoot-posters.mjs`.
   */
  poster: string;

  /** Compact fragment shader for the hover-to-live preview (iTime/iResolution/uPointer). */
  previewShader: string;
  status:        'live';
}

export function getJourney (slug: string): Journey | undefined {
  return JOURNEYS.find(j => j.slug === slug)
}
