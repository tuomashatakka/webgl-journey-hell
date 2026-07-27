// Single source of truth for the landing grid and the journey routes.
// Adding a journey = append one entry here + create app/journeys/<slug>/page.tsx.
import { foundryPreviewFrag } from './foundry/shader'
import { skybridgesPreviewFrag } from './skybridges/shader'


export interface Journey {

  /** Route segment + folder name under app/journeys/. */
  slug:    string;
  title:   string;
  tagline: string;
  tags:    string[];

  /** Drives the card's border glow + tag color. */
  accent: string;

  /** CSS poster gradient, used when `poster` image is absent. */
  gradient: [string, string];

  /** Optional static poster shown before hover (under /public). */
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

// Stairwell hover preview: a cheap, loop-free fake-perspective descent — grey
// concrete treads receding into a narrowing shaft with a warm corner light.
// Stands in for the full two-pass raymarch so the shared-context grid stays smooth.
const stairwellPreviewFrag = `
  precision highp float;
  uniform vec2 iResolution;
  uniform float iTime;
  uniform vec2 uPointer;

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    uv += uPointer * 0.08;

    float horizon = 0.32;
    float d = horizon - uv.y;          // > 0 below the horizon (the stairs)
    vec3 col;
    if (d < 0.02) {
      // Upper wall + faint skylight wash.
      col = vec3(0.18, 0.20, 0.24) + vec3(0.5, 0.45, 0.35) * pow(max(0.0, uv.y), 1.5) * 0.3;
    } else {
      float depth = 0.18 / d;          // crude perspective distance
      float tread = fract(depth * 0.6 + iTime * 1.1);
      float stepHi = smoothstep(0.0, 0.08, tread) * (1.0 - smoothstep(0.5, 0.58, tread));
      float halfW = clamp(0.6 / depth, 0.04, 2.0);
      float inShaft = smoothstep(halfW, halfW - 0.04, abs(uv.x));
      float shade = clamp(1.2 / depth, 0.06, 1.0);
      col = vec3(0.34, 0.35, 0.38) * shade;
      col += stepHi * 0.10 * shade;
      col *= mix(0.35, 1.0, inShaft);
    }

    float light = pow(max(0.0, 0.55 - length(uv - vec2(-0.22, 0.28))), 2.0);
    col += vec3(0.95, 0.82, 0.6) * light * 0.7;       // warm shaft from upper-left
    col *= smoothstep(1.05, 0.3, length(uv));         // vignette
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
    tagline:       'An impossible concrete descent where the stairs forget which way is down.',
    tags:          [ 'raymarch', 'brutalist', 'escher', 'audio' ],
    accent:        '#aeb9c4',
    gradient:      [ '#3a4048', '#181b1f' ],
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
    previewShader: skybridgesPreviewFrag,
    status:        'live',
  },
  {
    slug:          'foundry',
    title:         'THE FOUNDRY',
    tagline:       'The cable parts at eighty metres. Everything after that is physics.',
    tags:          [ 'raymarch', 'industrial', 'rigid-body', 'simulated' ],
    accent:        '#ff8a3d',
    gradient:      [ '#241206', '#0a0708' ],
    previewShader: foundryPreviewFrag,
    status:        'live',
  },
]

export function getJourney (slug: string): Journey | undefined {
  return JOURNEYS.find(j => j.slug === slug)
}
