// Single source of truth for the landing grid and the journey routes.
// Adding a journey = append one entry here + create app/journeys/<slug>/page.tsx.
import { signalBloomFrag } from './signal-bloom/shader';
import { skybridgesPreviewFrag } from './skybridges/shader';

export interface Journey {
  /** Route segment + folder name under app/journeys/. */
  slug: string;
  title: string;
  tagline: string;
  tags: string[];
  /** Drives the card's border glow + tag color. */
  accent: string;
  /** CSS poster gradient, used when `poster` image is absent. */
  gradient: [string, string];
  /** Optional static poster shown before hover (under /public). */
  poster?: string;
  /** Compact fragment shader for the hover-to-live preview (iTime/iResolution/uPointer). */
  previewShader: string;
  status: 'live';
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
`;

export const JOURNEYS: Journey[] = [
  {
    slug: 'liminal',
    title: 'THE LIMINAL JOURNEY',
    tagline: 'A descent through the abyss — watch 3 iterations and you will see.',
    tags: ['raymarch', 'horror', 'CRT', 'audio'],
    accent: '#00ffaa',
    gradient: ['#04110d', '#0a0410'],
    poster: '/journeys/liminal.jpg',
    previewShader: liminalPreviewFrag,
    status: 'live',
  },
  {
    slug: 'signal-bloom',
    title: 'SIGNAL BLOOM',
    tagline: 'Iridescent domain-warped plasma blooming out of static.',
    tags: ['plasma', 'iridescent', '2D'],
    accent: '#ff3da6',
    gradient: ['#1a0420', '#04101a'],
    previewShader: signalBloomFrag,
    status: 'live',
  },
  {
    slug: 'skybridges',
    title: 'SKYBRIDGES',
    tagline: 'Sprint for your life as the glass bridge cracks apart at the clouds\' height.',
    tags: ['raymarch', 'glass', 'vertigo'],
    accent: '#9fd8ff',
    gradient: ['#dbe6f2', '#aebfce'],
    previewShader: skybridgesPreviewFrag,
    status: 'live',
  },
];

export function getJourney(slug: string): Journey | undefined {
  return JOURNEYS.find((j) => j.slug === slug);
}
