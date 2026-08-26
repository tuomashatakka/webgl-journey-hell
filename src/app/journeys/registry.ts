// Single source of truth for the landing grid and the journey routes.
// Adding a journey = append one entry here + create app/journeys/<slug>/page.tsx.
import { foundryPreviewFrag } from './foundry/shader'
import { hollowOrchardPreviewFrag } from './hollow-orchard/shader'
import { loopLinePreviewFrag } from './loop-line/shader'
import { natatoriumPreviewFrag } from './natatorium/shader'
import { skybridgesPreviewFrag } from './skybridges/shader'
import { switchbackPreviewFrag } from './switchback/shader'


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
   * Screenshot of the running journey (under /public), shown before hover and
   * wherever the live preview can't run: touch devices with no hover, browsers
   * without WebGL, a preview shader that failed to compile. Captured with
   * `tools/shoot-posters.mjs`.
   */
  poster?: string;

  /** Compact fragment shader for the hover-to-live preview (iTime/iResolution/uPointer). */
  previewShader: string;
  status:        'live';
}

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

// Stairwell hover preview: an open weather bridge crossing a ruptured industrial
// horizon. It stays loop-free so the shared-context landing grid remains cheap.
const stairwellPreviewFrag = `
  precision highp float;
  uniform vec2 iResolution;
  uniform float iTime;
  uniform vec2 uPointer;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    uv += uPointer * 0.1;

    float horizon = -0.02;
    float cloud = sin(uv.x * 7.0 - iTime * 0.35) * sin(uv.y * 9.0 + iTime * 0.22);
    cloud += 0.55 * sin(uv.x * 15.0 + uv.y * 11.0 + iTime * 0.18);
    cloud = smoothstep(-0.35, 0.85, cloud - uv.y * 0.7);
    vec3 col = mix(vec3(0.025, 0.055, 0.09), vec3(0.24, 0.42, 0.48), cloud * 0.72);

    float towerA = step(abs(uv.x + 0.42), 0.035) * step(horizon - 0.03, uv.y);
    float towerB = step(abs(uv.x - 0.34), 0.055) * step(horizon + 0.08, uv.y);
    float crane = step(abs(uv.y - 0.27), 0.012) * step(-0.45, uv.x) * step(uv.x, 0.34);
    col = mix(col, vec3(0.035, 0.04, 0.045), max(max(towerA, towerB), crane));

    float floorDepth = max(0.01, horizon - uv.y);
    float perspective = 0.12 / floorDepth;
    float halfWidth = clamp(0.58 / perspective, 0.035, 1.2);
    float onBridge = smoothstep(halfWidth + 0.025, halfWidth - 0.015, abs(uv.x));
    float tread = smoothstep(0.04, 0.0, abs(fract(perspective * 0.68 + iTime * 0.5) - 0.5));
    vec3 bridge = vec3(0.18, 0.21, 0.22) + vec3(0.18, 0.24, 0.25) * tread;
    col = mix(col, bridge / (1.0 + perspective * 0.08), onBridge * step(uv.y, horizon));

    float rupture = smoothstep(0.025, 0.0, abs(uv.y - 0.24 - uv.x * 0.58));
    rupture *= smoothstep(-0.45, 0.18, uv.x) * (0.55 + 0.45 * hash(floor(uv * 80.0)));
    col += vec3(0.18, 0.72, 1.0) * rupture * (0.55 + 0.3 * sin(iTime * 2.0));
    col *= smoothstep(1.05, 0.28, length(uv));
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
    poster:        '/journeys/liminal.jpg',
    previewShader: liminalPreviewFrag,
    status:        'live',
  },
  {
    slug:          'stairwell',
    title:         'THE STAIRWELL',
    tagline:       'Six industrial horizons rupture further every time the stairs return.',
    tags:          [ 'raymarch', 'industrial', 'volumetric', 'loop', 'audio' ],
    accent:        '#9ed9ff',
    gradient:      [ '#142835', '#190a28' ],
    poster:        '/journeys/stairwell.jpg',
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
    poster:        '/journeys/skybridges.jpg',
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
    poster:        '/journeys/foundry.jpg',
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
    poster:        '/journeys/hollow-orchard.jpg',
    previewShader: hollowOrchardPreviewFrag,
    status:        'live',
  },
  {
    slug:          'natatorium',
    title:         'THE NATATORIUM',
    tagline:       'The pool has been filling for a long time, and the route only goes downhill.',
    tags:          [ 'raymarch', 'poolrooms', 'liminal', 'water', 'audio' ],
    accent:        '#67d5e0',
    gradient:      [ '#9fd0dc', '#2c5866' ],
    poster:        '/journeys/natatorium.jpg',
    previewShader: natatoriumPreviewFrag,
    status:        'live',
  },
  {
    slug:          'switchback',
    title:         'THE SWITCHBACK',
    tagline:       'The cart is a gravity machine and the brakes are only at the platform. Six rooms, and it comes back round.',
    tags:          [ 'raymarch', 'dreamcore', 'mine cart', 'coaster', 'simulated', 'loop' ],
    accent:        '#ff9ec4',
    gradient:      [ '#f3b9c8', '#221226' ],
    poster:        '/journeys/switchback.jpg',
    previewShader: switchbackPreviewFrag,
    status:        'live',
  },
  {
    slug:          'loop-line',
    title:         'THE LOOP LINE',
    tagline:       'Six stations on a circle line with no terminus. It comes round more broken every time, and the timetable has no last train.',
    tags:          [ 'geometry', 'rasterized', 'transit', 'dreamcore', 'simulated', 'loop' ],
    accent:        '#b39dff',
    gradient:      [ '#cfc4ff', '#0d0b14' ],
    poster:        '/journeys/loop-line.jpg',
    previewShader: loopLinePreviewFrag,
    status:        'live',
  },
]

export function getJourney (slug: string): Journey | undefined {
  return JOURNEYS.find(j => j.slug === slug)
}
