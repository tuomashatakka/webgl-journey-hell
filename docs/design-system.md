# Design system

Small on purpose: tokens, a handful of rules, and the tooling that enforces them. If a rule is not enforced by a tool, it is a convention and is marked as one.

## Code

| rule | enforced by |
| --- | --- |
| Follow the shared lint config (`@tuomashatakka/eslint-config`): no semicolons, single quotes, a space before function parens, aligned assignments, ordered top-level definitions | `bun run lint` (0 errors; warnings are style debt, fix when touching a file) |
| No dead code: no unused file, export, type, dependency or local | `knip`, `tsc` (`noUnusedLocals`) |
| No barrel files: no `index.ts`, no `export *`; import from the defining module | convention; `grep -rn "export \*" src` is the check |
| `src/packages/**` never imports react, react-dom or next | convention; `grep -rnE "from '(react\|next)" src/packages` is the check |
| One config file: tunables go in `CONFIG`, content stays beside its owner | convention; boundary stated in `config.ts` |
| Package modules are addressed as `@wjh/<pkg>/<module>`, app code as `✦/<path>` | `tsconfig` paths, workspace `exports` |
| Shaders and simulations that matter have a probe baseline | `tools/journey.mjs probe --bare --json` diffed byte for byte |
| Journey modules over about 600 lines are split by concern | convention |

### State and effects

* A component has no `useState` and no `useEffect`. Put them in a hook named `use-<thing>.ts` in `src/hooks/`, or in a provider.
* A hook does one job and returns what the view needs: `useOpening` (the opening flags), `useJourneyKeys` (the keyboard), `useTooltip`, `useDialogFocus`, `useMounted`, `useSampled` (a slow readout), `useAssetCanvas`, `useJourneyRuntime`.
* `useEffect` is for subscribing to something outside React (a listener, an interval, a ResizeObserver) and must return its cleanup. If an effect only derives a value, compute the value instead.
* `useLatestRef` mirrors a changing value for long-lived callbacks (the engine is created once and reads settings through a ref).
* Per-frame data never goes through `setState`.
* Data flows one way: inputs go into the engine through its host, results come back through callbacks (see `docs/architecture.md`).

### Naming

* Files: `camelCase.ts` for modules in packages and journeys, `PascalCase.tsx` for components, `use-kebab-case.ts` for hooks, `kebab-case` for folders and assets.
* Journey slugs are kebab-case and are the folder name, the route and the registry key.
* GLSL constants mirror their TS source (`${...}` interpolation), never a second hand-copied number.

## UI

### Tokens (`src/app/styles/base.css`, `:root`)

| token | value | use |
| --- | --- | --- |
| `--signal` | `#00ffaa` | the UI's own green: labels, readouts, focus rings |
| `--accent` | per journey | set inline by the shell from the registry; the index tints the room with it |
| `--violet` | `#c9b6ff` | selection: the checked option, a lit control |
| `--ink` | `#f2f1f6` | text on a panel |
| `--panel`, `--panel-deep` | `#1a1e24`, `#15181f` | surfaces |
| `--line` | `#2d3139` | hairlines and control borders |
| `--hud-row` | `84px` | height reserved for the bottom transport row |
| `--font-mono` | `monospace` | the only typeface |

Add a token before adding a literal colour. Spacing is multiples of 4 px; the HUD uses 8, 12, 18.

### Stylesheets (`src/app/styles/`)

One file per concern, imported in cascade order by `layout.tsx`: `base` (page, canvas, title card, loader), `debug`, `settings` (the panel), `index` (the CRT room), `toolbar`, `transport` (the deck, fullscreen), `assets`. A class or id exists in CSS if and only if a component uses it; there are no orphaned stylesheets.

### Components

| component | role |
| --- | --- |
| `withJourneyShell` | the journey page: canvas, HUD, overlays |
| `JourneyTransport` | the tape deck; chapters, laps, scrubbing |
| `JourneyLoader`, `GlitchTitle` | the opening: the bar, the title card, section headings |
| `SettingsProvider` | graphics settings state, persisted |
| `JourneyToolbar`, `ToolbarButton` | the top bar and its icon buttons with tooltips |
| `SettingsButton`, `SettingsView` | the settings panel (an aside over a backdrop) and its trigger |
| `JourneyKeys`, `JourneyRuntimeContext` | the keyboard, and the runtime for everything under the shell |
| `CrtIndex` | the index: a CRT in a dark room, one journey per channel, a menu of all of them (`hooks/use-crt-room`, `packages/web/crtRoom`) |
| `AssetBrowser` | the Δ page |
| `JourneyDebugPanel` | the `?debug=1` overlay |

### Chrome rules

* The toolbar is at the top. Its buttons are icon-only inline SVG (`lucide-react` renders inline SVG, never an icon font), each with an `aria-label` and a tooltip; add a control by adding a `ToolbarButton`, not by writing a new absolutely positioned button.
* A modal panel is an `<aside role="dialog" aria-modal>` over a fixed backdrop, portalled to the body, with its focus contract from `use-dialog-focus`.
* Components under the journey shell read the runtime from `JourneyRuntimeContext` instead of taking it as props.

* All chrome carries the `hud` class: it fades in fullscreen and under `?hud=0`, and takes no pointer events while hidden.
* Controls are real `<button>` and `<a>` elements, with an accessible name, a visible `:focus-visible` ring and a hit area a finger can reach.
* Fullscreen is the picture alone; keyboard focus brings a control back; Esc brings everything back.

## Tooling to add if the rules need teeth

* `eslint-plugin-boundaries` or `no-restricted-imports` on `src/packages/**` for react and next, and on `src/components/**` for `useState`/`useEffect` (the shared config already warns via `react-strict/prefer-no-use-effect`).
* A CI step running `bun run check` and `node tools/journey.mjs probe <slug> --bare --json` against a committed baseline.
* A stylelint rule against hex literals outside `base.css`.
