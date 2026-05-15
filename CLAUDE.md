# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development commands

- Install dependencies: `yarn`
- Start the app locally: `yarn start`
- Start the production build locally: `yarn start:production`
- Build everything needed for the app: `yarn build`
- Build only the published packages: `yarn build:packages`
- Build only the app shell: `yarn build:app`
- Run all vitest tests in watch mode: `yarn test`
- Run tests once with snapshot updates: `yarn test:update`
- Run the full local validation suite: `yarn test:all`
- Typecheck the monorepo: `yarn test:typecheck`
- Lint source files: `yarn test:code`
- Check prettier formatting: `yarn test:other`
- Auto-fix formatting and lint issues: `yarn fix`
- Run coverage: `yarn test:coverage`
- Open Vitest UI: `yarn test:ui`
- Clean build outputs: `yarn rm:build`

## Single-test and targeted workflows

- Run a specific test file: `yarn test:app packages/excalidraw/clipboard.test.ts`
- Run tests matching a name: `yarn test:app -t "clipboard"`
- Run a package script directly: `yarn --cwd ./packages/excalidraw build:esm`
- Run the browser-script example after rebuilding packages: `yarn start:example`

## Repository structure

- `packages/excalidraw/` is the published React editor package. Most editor behavior, UI, serialization, clipboard, and restore logic lives here.
- `excalidraw-app/` is the excalidraw.com application. It wraps the package with app-specific concerns such as PWA behavior, local-first persistence, collaboration wiring, and production shell behavior.
- `packages/common/` contains shared constants, helpers, feature flags, environment utilities, and cross-package primitives used throughout the editor.
- `packages/element/` contains element models, mutation helpers, hit testing, bindings, frames, grouping, scene/store logic, and other core canvas data operations.
- `packages/math/` provides geometry and vector primitives used by interaction, transforms, and rendering.
- `packages/utils/` and `packages/fractional-indexing/` hold lower-level shared utilities used across packages.
- `examples/` contains integration examples; `dev-docs/` contains the documentation site and deeper architecture notes.

## Architecture notes

- This is a Yarn workspaces monorepo on Node 18+ and Yarn 1. The root `package.json` is the main entry point for development commands.
- The app and tests consume workspace source directly through aliases in `vitest.config.mts` rather than built package artifacts. When changing cross-package APIs, check both the alias targets and package build outputs.
- `packages/excalidraw/index.tsx` is the public package entry point. It initializes polyfills, providers, default UI/image options, and exports the imperative/editor-facing APIs.
- `packages/excalidraw/components/App.tsx` is the main runtime orchestrator. It pulls together interaction handling, rendering, actions, scene updates, selection, bindings, frames, text editing, and collaboration-facing hooks.
- Core editor state is split between scene elements/files and `AppState`. The canonical `AppState` shape lives in `packages/excalidraw/types.ts`, defaults/cleanup helpers live in `packages/excalidraw/appState.ts`, and restoration/normalization logic lives in `packages/excalidraw/data/restore.ts`.
- Serialization boundaries are important: `.excalidraw` file export/import and clipboard formats are handled in `packages/excalidraw/data/*` and `packages/excalidraw/clipboard.ts`. If a feature changes persisted data, update restore/serialize paths together.
- Scene and element semantics mostly live below the UI layer in `@excalidraw/element`. `App.tsx` imports heavily from that package for element creation, transforms, hit testing, frame membership, bindings, and store updates.
- Frame behavior depends on element ordering: frame children should precede the frame element itself, as documented in `dev-docs/docs/codebase/frames.mdx`. Changes touching frames must preserve that invariant.
- The library build for `@excalidraw/excalidraw` is produced by `scripts/buildPackage.js` using esbuild. It emits separate dev/prod ESM builds and treats internal workspace packages as externals.
- The app uses Vite (`excalidraw-app/package.json`) and its `index.html` contains important production shell behavior such as early theme initialization, asset path setup, and some redirect/bootstrap logic.

## Project-specific guidance from existing repo instructions

- Prefer concise communication and avoid long explanations unless asked.
- Use TypeScript for new code.
- Prefer functional React components and hooks.
- For math-related code, include `packages/math/src/types.ts` in context and use the shared `Point` type instead of ad-hoc `{ x, y }` objects.
- Before committing, run at least `yarn test:update` and `yarn test:typecheck`.
