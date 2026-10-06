# TypeScript Migration Plan

Status: proposal · Written 2026-10-06 against `main` @ `c9f057f`

> **Update 2026-10-06: the source conversion is done (big-bang).** All 40 files in `src/` are TypeScript and `tsc` passes in strict mode. Main and the window now share one IPC contract, `src/ipc.ts`, which the preload uses and `global.d.ts` takes its types from. `botManager.ts` uses a typed event map.
> Still to do from this plan: tests in `.ts` (Phase 6), the ESLint flat config and Prettier pass (Phase 0), splitting `BotManager` into smaller files (Phase 4), and moving `bot._world*` state off the bot. For now that state is typed through `src/bot/types.ts`.


## 1. Where the project stands today

| Area | Files | Lines | Language | Type-checked? |
| --- | ---: | ---: | --- | --- |
| Renderer (React, three.js, utils, hooks) | 106 | ~16,900 | TS / TSX | Yes (`strict`) |
| Vendored bot plugins (`src/bot/plugins/core/**`) | (included above) | ~4,000 | TS | Yes |
| Main process: `main.js`, `preload.js`, `mcBridge.js`, `botManager.js`, `serverPing.js`, `appUpdates.js`, `worldWorker.js` | 7 | ~2,200 | JS (CommonJS) | **No** |
| Bot logic: `src/bot/*.js`, `src/bot/plugins/*.js`, `pvp/index.js` | 33 | ~6,000 | JS (CommonJS) | **No** |
| Tests (`tests/*.test.cjs`) | 27 | ~1,900 | JS (CommonJS) | No |
| Build scripts (`scripts/**`) | 13 | ~1,200 | JS / CJS | No |
| Config (`forge.config.js`, `vite.*.mjs`, `postcss.config.js`, `tailwind.config.js`) | 7 | ~100 | JS / MJS | No |

Some things already work in our favour:

- `tsc --noEmit` passes today with **zero `any`** and **zero `@ts-ignore`** in the TS code, so the TS half is in good shape.
- Vite already builds `main`, `preload` and `worldWorker`, and it compiles `.ts` entries with no extra setup.
- `scripts/test-typescript.cjs` already registers a `.ts` loader for `require()`. Extensionless requires like `require('../src/bot/worldView')` will resolve to `worldView.ts` once a file is renamed.
- `src/bot/plugins/core/types.ts` already defines a `CoreBot` type that adds plugin fields to mineflayer's `Bot`. It's a good starting point for typing the rest.
- `src/global.d.ts` already describes the whole `window.electronAPI` surface by hand.

Some things will make the migration harder:

1. **The IPC contract exists in three places.** Channel strings and payload shapes are written separately in `preload.js`, `mcBridge.js` and `global.d.ts`, and nothing keeps them in sync. There is already one mismatch: `global.d.ts` says `openDoor` returns `{ ok, message? }`, but `botManager.openDoor` returns pathfinder options.
2. **Code adds untyped fields to the mineflayer `Bot` object.** Examples are `bot._worldChanges`, `_worldChunks`, `_worldDirty`, `_worldFullDirty`, `_worldRadius`, `_worldSlice` and `_trustedPlayers`, set in `botManager.js:299,343-381` and read in `worldView.js`. Typing these means either augmenting `Bot` or moving the state out of it (moving it out is better, see 4.3).
3. **Modules reach into each other's private methods.** For example `this.pvp._clearTarget()` (4 times), `this.mining._targetLabel()` and `this.autoTool._ensurePlugin()`. TS `private` will flag all of these, so each one needs a public method or a rename.
4. **Some tests load source files by path.** Eight tests read a source file with `fs.readFileSync` and run it in `node:vm`. `tests/app-updates.test.cjs:77`, for example, reads `src/main` as raw JS. These break as soon as their target file becomes `.ts`.
5. **Patched dependencies.** `mineflayer`, `minecraft-protocol`, `prismarine-physics` and `prismarine-chunk` are patched, and `minecraft-data` is overridden with a local checkout. Their upstream `.d.ts` files may not match the patched runtime, so we'll need small local declaration fixes like the existing `core/physics.d.ts`.
6. **`module.exports = new BotManager()`** exports a singleton. That pattern carries over to TS, but it's a good moment to export the class and create the instance in `main`, which also makes it testable.

---

## 2. Decisions to make (with pros and cons)

Each decision lists the options, their pros and cons, and a **recommendation**.

### 2.1 Overall strategy

| Option | Pros | Cons |
| --- | --- | --- |
| **A. Big-bang:** rename all 40 JS files in one PR | One mental switch. No mixed JS/TS period. | One huge review (~8k lines) that's hard to bisect. Conflicts with all ongoing feature work. Very likely to break runtime behaviour that no test covers. |
| **B. Incremental: `allowJs` + `checkJs`, then rename leaf-first** | Every PR is small and can ship. Type errors show up in JS before renaming. Works alongside feature work. Easy to bisect. | A mixed codebase for a few weeks. `checkJs` gives noisy errors at first (handled per file with `// @ts-check`). |
| **C. JSDoc types only (no renames)** | No build or test changes at all. | JSDoc for classes, generics and event emitters is verbose and weaker. Doesn't fit the rest of the codebase, which is already TS. Only half a migration. |

**Recommendation: B.** The codebase is already two-thirds TS, and the remaining JS is a dependency tree that can be converted from the leaves up.

### 2.2 How strict

| Option | Pros | Cons |
| --- | --- | --- |
| **Full `strict` from the first converted file** (same as now) | One rule for the whole repo. Catches null bugs, which this code has many of (`bot?.…` everywhere). | Each file takes longer to convert. |
| **Looser config for main process first (`strict: false`), tighten later** | Faster renames. | Two configs to maintain. "Later" tends never to happen. Weak types spread through imports. |
| **Strict, plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`** | Catches `bot.entities[id]` used without a check and similar bugs. | Many more errors in the existing renderer code, so this should be its own follow-up PR. |

**Recommendation:** keep `strict` for converted files. Use `// @ts-expect-error <reason>` only at mineflayer boundaries where the upstream types are wrong. Add `noUncheckedIndexedAccess` as a separate cleanup at the end.

### 2.3 Module syntax in the main process

| Option | Pros | Cons |
| --- | --- | --- |
| **Write ESM `import`/`export` in `.ts`; Vite outputs CJS** (current output format) | Same syntax as the renderer. Tree-shaking. Proper type-only imports. No runtime change, since Vite still emits `main.cjs`. | Default-export interop with CJS packages (`mineflayer`, `vec3`, `prismarine-*`) needs `esModuleInterop`, which is already on. `__dirname` keeps working because the output is CJS. |
| Keep `require()` inside `.ts` (`import x = require()`) | Smallest diff. | Non-standard and awkward. Loses most of the benefit. Vite handles it badly. |
| Switch the main output to ESM (`main.mjs`) | Modern. | Electron ESM main has rough edges (`__dirname`, preload must stay CJS when sandboxed, worker paths). Risky with no clear gain. |

**Recommendation:** write ESM in TS and keep emitting CJS (`formats: ['cjs']` stays as it is).

### 2.4 Typing the IPC bridge

| Option | Pros | Cons |
| --- | --- | --- |
| **A. One shared contract type** (`src/shared/ipc.ts`) that maps each channel to its args and result, plus small typed helpers `handle()`, `invoke()` and `on()` | No dependencies. One file defines the contract. `preload`, `mcBridge` and `global.d.ts` can't drift apart. Removes most of the hand-written `global.d.ts`. | Needs about 60 lines of helper generics. No runtime validation on its own. |
| B. Library (`electron-trpc`, `@electron-toolkit/typed-ipc`, …) | Ready-made, with typed request and subscription support. | New dependency and abstraction. tRPC is heavy for a single-window app. These libraries lag behind Electron versions. |
| C. A (or B) **plus a runtime schema** (zod / valibot) on each `ipcMain.handle` | Types and runtime agree. Malformed renderer input is rejected in one place, replacing the ad-hoc `Number.isInteger(entityId)` checks in `mcBridge.js`. | Adds about 15 KB and a schema per channel. |

**Recommendation:** A now. Add C's runtime validation only to the channels that take renderer-supplied coordinates or names (`interactBlock`, `inventoryAction`, `buildAction`, `setTrustedPlayers`, `firstPerson*`).

Sketch:

```ts
// src/shared/ipc.ts
export type IpcContract = {
  'bot:connect': { args: [ConnectOptions]; result: Result }
  'bot:openTrader': { args: [entityId: number]; result: Result<{ trades: TradeOffer[] }> }
  // …
}
export type IpcEvents = {
  'bot:state': BotSnapshot
  'bot:world': WorldView
  // …
}
export type Result<T = {}> = ({ ok: true } & T) | { ok: false; message: string }
```

### 2.5 Typing mineflayer and plugin augmentation

| Option | Pros | Cons |
| --- | --- | --- |
| **Module augmentation** (`declare module 'mineflayer' { interface Bot { pathfinder: Pathfinder; … } }`) | Matches how mineflayer plugins are typed upstream. Zero runtime cost. | Makes the fields look present on every `Bot`, even before the plugin loads. |
| **Extend the existing `CoreBot` type** and pass `CoreBot` around | Already exists. Explicit. | Needs casts where a plain `Bot` comes in (`mineflayer.createBot`). |
| **Move ad-hoc fields off the bot** (`bot._world*` → a `WorldTracker` instance owned by `BotManager`) | Removes the problem instead of typing it. Easier to test. | A small runtime refactor alongside the rename. |

**Recommendation:** use `CoreBot` for the real plugin fields, and move every `bot._world*` and `bot._trustedPlayers` field into its own object (see `IMPROVEMENTS.md` §2.3).

### 2.6 Test runner

| Option | Pros | Cons |
| --- | --- | --- |
| **Keep `node:test` with the `test-typescript.cjs` hook, and convert tests to `.test.ts`** | Smallest change. Fast. No new dependencies. | The hook only transpiles, so tests aren't type-checked unless `tests/` is added to the `tsconfig` `include`. |
| `tsx --test` or Node's built-in type stripping | No custom hook. | Node 22.13 needs `--experimental-strip-types`, which doesn't support `enum`/`namespace` and needs explicit `.ts` extensions in ESM. `tsx` is a new dev dependency. |
| **Vitest** | Built on Vite (already used), with native TS, watch mode, mocks, coverage and a jsdom environment for testing React hooks and components. | Migration work for 27 files (mostly mechanical, since `test`/`assert` map almost 1:1). Another tool. |

**Recommendation:** keep `node:test` for this migration and convert tests to `.test.ts`. Rewrite the 8 `vm`-based tests to `import` their module directly, which will need small export changes. Add `tests/` to a `tsconfig.test.json` so tests are type-checked too. **Decision:** stay on `node:test`. No React component tests for now.

### 2.7 Config files and scripts

| Option | Pros | Cons |
| --- | --- | --- |
| Convert `vite.*.mjs` → `vite.*.config.ts` and `forge.config.js` → `forge.config.ts` | Typed config with autocompletion. Electron Forge 8 supports TS config. | Forge TS config needs `ts-node`/`jiti` at build time. Little value for about 100 lines. |
| **Leave configs as JS, but add `// @ts-check` + `/** @type {import(...)} */`** | Type-checked with zero tooling change. | Still JS. |
| Convert `scripts/assets/*` to TS | Asset generation gets types. | Run rarely. Low payoff. |

**Recommendation:** use `@ts-check` for configs and scripts. Delete `tailwind.config.js` entirely, because Tailwind v4 ignores it without an `@config` directive (see IMPROVEMENTS.md).

### 2.8 Restructure folders at the same time?

| Option | Pros | Cons |
| --- | --- | --- |
| Rename and move together | Each file is touched once. | Git sees "delete + add" for big files, so `git blame` and history get lost. Reviews mix two kinds of change. |
| **Move first (`git mv`, no content change), then convert** | `git log --follow` survives. Each PR is easy to review. | Two passes over the same files. |
| Convert first, move later | No restructure decisions block the migration. | Paths in comments and tests get updated twice. |

**Decision: convert first, restructure later.** Files are converted in place, keeping their current paths. The folder restructure (IMPROVEMENTS.md §4) happens after Phase 6, as pure `git mv` commits.

---

## 3. Phased plan

Each phase is one or more small PRs. `pnpm typecheck && pnpm test` must pass after every PR, and each phase should be checked manually by connecting to a server with `pnpm dev`.

### Phase 0: Groundwork (≈ 1 day)

- [ ] Fix ESLint: v9 ignores `.eslintrc.json`, so `npx eslint` currently crashes. Add `eslint.config.js` (flat config) with `typescript-eslint`, `react`, `react-hooks` and `prettier`. Replace the `"lint": "echo …"` script.
- [ ] Run `prettier --write` once in its own commit (80 files currently fail `prettier --check`). Add that commit to `.git-blame-ignore-revs`.
- [ ] `tsconfig.json`: add `"allowJs": true, "checkJs": false`, include `src/**/*.js`, and add `"types": ["node"]` for the main process (plus `@types/node` as a dev dependency).
- [ ] macOS only: type and keep only the darwin path. Drop the non-darwin branches in `main.js` (`window-all-closed` quitting, the `process.platform` check around `setWindowButtonVisibility`) while converting.
- [ ] Split into `tsconfig.base.json`, `tsconfig.main.json` (Node, no DOM lib) and `tsconfig.renderer.json` (DOM, no Node), with a `tsconfig.json` that references both. That stops renderer code from accidentally using `fs`, and stops main-process code from using `window`.
- [ ] Add a `typecheck` CI step for tests: `tsconfig.test.json` including `tests/**/*.ts`.

### Phase 1: Shared types and IPC contract (≈ 1 day)

- [ ] Create `src/shared/ipc.ts` (contract, `Result<T>`, event map) and move the payload types it needs from `src/types.ts`.
- [ ] Add `Vec3Like = { x: number; y: number; z: number }`. It's written inline 24 times today.
- [ ] Rewrite `preload.js` → `preload.ts` using typed `invoke`/`on` helpers. Derive `window.electronAPI`'s type from the preload's return type: `export type ElectronAPI = typeof api`, then `declare global { interface Window { electronAPI: ElectronAPI } }`. Delete most of `global.d.ts`.
- [ ] Remove dead endpoints while doing this (see IMPROVEMENTS.md §2.9): `openDoor`, `getSnapshot`, `getAutoEatOptions`, `getPathfinderOptions`, `getPvpOptions` and `clearMiningChests` are never called from the renderer.

**Pros:** fixes the biggest drift risk first, and every later phase gets type-checked payloads for free.
**Cons:** touches renderer call sites, but only their types; runtime is unchanged.

### Phase 2: Leaf modules in `src/bot` (≈ 2–3 days)

Convert files with no internal JS dependents first. Rough order (smallest and most self-contained first):

1. `versions.js`, `errors.js`, `oxygen.js`, `profileTextures.js`, `viewModes.js`, `entityVariants.js`
2. `breakProgress.js`, `playerNames.js`, `preJoinLogin.js`, `chatBridge.js`
3. `worldCompute.js` (pure functions, used by the worker, and the most valuable to type) → `worldView.js`, `entityView.js`, `entityEvents.js`
4. `inventoryActions.js`, `blockInteraction.js`, `trading.js`, `building.js`
5. `serverPing.js`, `appUpdates.js`, `worldWorker.js`

While converting:

- Use `import type { Bot } from 'mineflayer'` and `CoreBot` from `plugins/core/types.ts`.
- Replace `prop === true || prop === 'true'` (8 copies) with one `isTrue(prop)` helper in `src/bot/blockProps.ts`.
- Use one `HOTBAR_START` and other inventory constants from `src/shared/inventory.ts`. Today the constant is defined separately in 3 files.

### Phase 3: Plugin controllers (≈ 3 days)

- [ ] Add `src/bot/plugins/types.ts` with a `BotPlugin` interface: `attach(bot)`, `detach()`, and optionally `setEnabled()`, `isEnabled()` and `getState()`.
- [ ] Add a `ToggleablePlugin` base class for the duplicated "desiredEnabled / enabled / spawnListener" code found in `armorManager.js`, `autoEat.js`, `autoTool.js` and `autoShield.js`.
- [ ] Convert in order: `blockEditing` → `behaviorManager` → `armorManager` → `autoTool` → `autoEat` → `autoShield` → `pathfinder` → `gestures` → `firstPersonActions` → `manualMovement` → `bed` → `autoSleep` → `creeperWatch` → `mining` → `pvp/index`.
- [ ] Make each `_private` method that's called from outside either public (with a real name) or truly private.
  - `pvp._clearTarget()` → `pvp.clearTarget()`
  - `mining._targetLabel()` → `mining.describeTargets()`
- [ ] Remove the `Movements.prototype` monkey-patch in `plugins/pathfinder.js`. `Movements` is vendored in `core/pathfinder/lib/movements.ts`, so put the open-door handling directly in that source.

### Phase 4: `BotManager` and `mcBridge` (≈ 2–3 days)

These are the riskiest files (1,230 and 363 lines). Convert them **after** splitting, as described in IMPROVEMENTS.md §2.1:

- [ ] Extract `WorldStream` (world worker, `_scheduleWorldEmit`, `_emitWorld`, `_sendWorldView`), `BuildQueue`, `DoorOperation` and `SnapshotBuilder` into their own `.ts` files.
- [ ] Make the plugin list an array, so attach and detach run in one loop (removes 3 copied detach lists).
- [ ] `BotManager` becomes a typed `EventEmitter`, e.g. `class BotManager extends (EventEmitter as new () => TypedEmitter<BotEvents>)` or the generic `EventEmitter<BotEvents>` from recent `@types/node`.
- [ ] `mcBridge.ts` → `src/main/ipc/registerBotIpc.ts`, using a `handle()` helper that wraps the repeated `try { … } catch (error) { return { ok: false, message: error?.message || String(error) } }` (11 copies).
- [ ] Export the `BotManager` class and create the instance in `main.ts`.

### Phase 5: Main entry (≈ ½ day)

- [ ] `main.js` → `main.ts`. Declare the Forge Vite globals:

  ```ts
  declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined
  declare const MAIN_WINDOW_VITE_NAME: string
  ```

- [ ] Update `forge.config.js` entries (`src/main.ts`, `src/preload.ts`, `src/worldWorker.ts`) and the `vite.*.mjs` `lib.entry` paths.
- [ ] Rewrite `tests/app-updates.test.cjs` so it doesn't `vm`-execute `main`. Move the IPC handler bodies into importable functions and test those.

### Phase 6: Tests, scripts and cleanup (≈ 1–2 days)

- [ ] Rename `tests/*.test.cjs` → `tests/*.test.ts` and change `require` → `import`. Update the `test` script glob.
- [ ] Remove the inline `vm.runInNewContext(ts.transpileModule(…))` pattern from the 8 tests that use it.
- [ ] Add `@ts-check` to `forge.config.js`, `postcss.config.js`, `scripts/**`.
- [ ] Turn off `allowJs`. Add the lint rule `@typescript-eslint/no-explicit-any: error` to keep the zero-`any` record.
- [ ] Optional: enable `noUncheckedIndexedAccess` and fix the fallout.

### Rough total

About **2–2.5 weeks** of focused work, or 4–6 weeks alongside feature work. Phases 1 and 4 bring most of the value.

---

## 4. Verification checklist per PR

- `pnpm typecheck` passes (renderer, main and test projects)
- `pnpm test` passes
- `pnpm lint` passes (after Phase 0)
- `pnpm dev`: connect offline to a local server, walk with a click, open a chest, toggle each toolbar plugin, start and stop Auto Mine, trade, disconnect and reconnect
- `pnpm make` once per phase. Packaging has its own issues (externals, `worldWorker.cjs` path).

---

## 5. Overall pros and cons of migrating

### Pros

- **Catches real bugs at compile time.** The `openDoor` return-type mismatch, IPC payload drift and `null` bots (`bot?.` appears 74 times in the bot code alone) are all things TS would flag.
- **One language.** Contributors don't have to switch between typed renderer code and untyped bot code. Editor go-to-definition works across the IPC boundary.
- **Safer refactors.** The god-object split of `BotManager` (IMPROVEMENTS.md) is much less risky with types guiding it.
- **Documentation for free.** Much of the explanation in today's comments (e.g. "`ticks`: -1 means no end") can become types and named constants.
- **Uses existing investment.** The core plugins are already TS. The main gap is the glue code that uses them.

### Cons and risks

- **Upstream type quality.** mineflayer and prismarine typings are incomplete, and our patches widen that gap. Expect some `@ts-expect-error` and local `.d.ts` shims.
- **Runtime regressions with no tests behind them.** Most bot behaviour (combat, mining, beds, doors) has no automated test. Renames that change behaviour, like moving `bot._world*` fields, need manual checks in-game.
- **Merge conflicts** with feature work during the mixed period. Mitigate by converting one folder at a time and merging quickly.
- **Slower iteration** on quick experiments in bot logic. Mitigate by using strict types at the boundaries (IPC, plugin interface) and allowing simple local inference inside.
- **Build tooling.** None needed for `src` because Vite already compiles TS, but tests and `vm` hacks need rework (Phase 6).

### Decisions made

1. **Folder restructure:** after the migration. Convert in place.
2. **Runtime validation (zod/valibot):** still open. See §2.4.
3. **Tests:** keep `node:test`. No React component tests for now.
4. **Platforms:** macOS only. No Windows or Linux code paths to type or test.
