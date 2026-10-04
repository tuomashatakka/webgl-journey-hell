# AGENTS.md

Read `README.md` for the map, `docs/architecture.md` for the layers and the one data flow, `docs/design-system.md` for the rules, and `gotchas.md` before touching a shader, a simulation or the build.

## Nextjs

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Rules for changes

* **Layers.** React and Next code lives only in `src/app`, `src/components`, `src/hooks`. Generic code goes in a package under `src/packages/` (no react, no next, no `.tsx`). Journey content stays in `src/journeys/<slug>/`.
* **No barrels.** Import from the module that defines the symbol (`@wjh/math/scalar`). A package's `exports` points at concrete files; adding a module means adding it there (and the package to the root `package.json` if it is new).
* **One config file.** Tunables go in `src/packages/config/config.ts`; authored content stays beside its owner (the boundary is in that file's header).
* **State.** Components render. `useState` and `useEffect` belong in `src/hooks/` or a provider; per-frame data bypasses React.
* **No dead code.** `bun run check` runs tsc, eslint, knip and the tests; all must pass. Delete what is unused instead of leaving it.
* **Style.** Follow the lint config: no semicolons, single quotes, a space before function parentheses, aligned assignments. The lint config and these docs override patterns found in older code.
* **Docs.** When behaviour, a constant or a path changes, update the doc that describes it in the same commit. Journey specs in `docs/journeys/` keep their settled constants.

## Verifying a change

1. `bun run check` (typecheck, lint, dead-code check, unit tests).
2. `bun run build`.
3. For anything that touches a shader, a simulation or the engine: capture `node tools/journey.mjs probe <slug> --bare --from=0 --to=120 --step=8 --json` before and after; a refactor must be byte-identical. Run `node tools/journey.mjs glsl <slug>` after shader edits.
4. For anything visible: load the page and look (`docs/tooling.md`).

## Commits

Small, per phase, with plain messages. No co-author trailers. Commit early: an external sync can modify the working tree (`gotchas.md`).
