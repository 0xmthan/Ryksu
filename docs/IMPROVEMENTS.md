# Problems and Improvements

Status: review · Written 2026-10-06 against `main` @ `c9f057f`

This review covers UI and UX, architecture, code quality, naming, file structure, tooling, security and packaging. Each item has a **severity**, the location, what's wrong, and a suggested fix.

Severity: 🔴 bug or real risk · 🟠 should fix soon · 🟡 cleanup or nice to have

### Health snapshot

| Check | Result |
| --- | --- |
| `pnpm typecheck` | ✅ passes. TS code has 0 `any` and 0 `@ts-ignore` |
| `pnpm test` | ✅ 110 / 110 pass |
| `pnpm lint` | ❌ just runs `echo "No linting configured"`. `npx eslint` crashes because ESLint 9 needs a flat config |
| `prettier --check src` | ❌ 80 files not formatted |
| Packaged `app.asar` | ⚠️ **489 MB** (whole `.app` is 800 MB) |
| JS not type-checked | 40 files, ~8,250 lines (since converted to TypeScript) |

---

## 1. Top 10 (do these first)

1. 🔴 **Split `BotManager`.** It's a 1,230-line god object that holds every concern (§2.1).
2. 🔴 **One IPC contract.** Three hand-maintained copies that already disagree (§2.2).
3. 🔴 **Stop asking for the Microsoft password**, and store the server password with `safeStorage` instead of plain `localStorage` (§5.1, §5.2).
4. 🔴 **Chat history is unbounded** in both `localStorage` and main-process memory (§2.7).
5. 🟠 **Break up the 886-line `useEffect`** in `Surroundings3D.tsx` (§2.4).
6. 🟠 **Give settings and plugin state one owner.** Today it's split across renderer state, `localStorage`, main-process `BehaviorManager` and `display.json` (§2.5).
7. 🟠 **Toolbar overload.** Up to 9 icon toggles, plus right-click-only settings that nobody will find (§3.1).
8. 🟠 **Fix the lint/format tooling** so the style rules are actually enforced (§6.1).
9. 🟠 **Shrink the app bundle** by moving renderer-only dependencies to `devDependencies` and trimming `minecraft-data` (§7.1).
10. 🟡 **Restructure folders** into `main/`, `preload/`, `renderer/`, `shared/` (§4).

---

## 2. Architecture and code quality

### 2.1 🔴 `src/botManager.js` is a god object (1,230 lines)

It owns the connection lifecycle, 15 plugin instances, world streaming and the worker pool, the build queue, door operations, trading, mining, trusted players, snapshots and effects. Specific problems:

- **The detach list is copied three times.**
  - `cleanup()` (`botManager.js:254-267`), `handleEnd` (`:436-449`) and `disconnect()` (`:484-497`) each list all 14 `*.detach()` calls by hand.
  - `manualMovement.detach()` appears only in `disconnect()`. The next plugin added will very likely be missed in one of the three lists.
- **The "take over the bot" preamble is copied four times.**
  - `manualMovement.onStart` (`:84-89`), `interactBlock` (`:735-742`), `_runBuild` (`:782-789`) and `openTrader` (`:866-873`) each run the same stop-mining, stop-PvP, clear-target, cancel-go-to and emit-options steps.
- **The "is the user driving" predicate is copied three times**, as lambdas at `:78`, `:93` and `:101`.
  - The PvP one is named `isFleeing`, but it also returns `true` when a chest is open. The name doesn't match the meaning.
- **`openingBlock`** is also used as the "busy trading" flag (`:859`, `:864`). It should be something like `interaction: 'block' | 'trader' | null`.
- **It's a singleton export** (`module.exports = new BotManager()`), so it can't be constructed in tests.

**Suggested split:**

```
main/bot/
  BotSession.ts        // connect / disconnect / lifecycle; owns the plugin array
  plugins/registry.ts  // [armorManager, autoEat, …] attach/detach in one loop
  control.ts           // takeControl(reason): the shared "stop everything" preamble
  world/WorldStream.ts // worker, schedule/emit/send, render distance
  build/BuildQueue.ts
  doors/DoorOperation.ts
  snapshot.ts          // getSnapshot / effects / headUnderwater
```

### 2.2 🔴 The IPC contract is defined in three places, and they disagree

- `src/preload.js` (channel names), `src/mcBridge.js` + `src/main.js` (handlers) and `src/global.d.ts` (types) are all written by hand.
- **Mismatch:** `global.d.ts` types `openDoor` as returning `{ ok, message? }`, but `botManager.openDoor` returns `PathfinderOptions`.
- **Dead endpoints:** these exist in all three files but are never called from the renderer: `openDoor`, `getSnapshot`, `clearMiningChests`, `getAutoEatOptions`, `getPathfinderOptions`, `getPvpOptions`.
- **Two error conventions are mixed.** Some handlers return `{ ok: false, message }` and others throw. The renderer wraps calls in `try/catch` that never fires for `ok: false`.
  - For example, `toggleArmorManager` in `usePluginControls.ts` rolls back only on a thrown error, while `mcBridge` always returns `{ ok: true }`.
- The same `try { … } catch (error) { return { ok: false, message: error?.message || String(error) } }` appears 11 times.

**Fix:** use a single `src/shared/ipc.ts` contract with typed `handle()`, `invoke()` and `on()` helpers (see the migration doc §2.4). Use `Result<T>` everywhere and never throw across IPC.

### 2.3 🟠 Untyped fields bolted onto mineflayer's `bot`

`bot._worldChanges`, `_worldChunks`, `_worldDirty`, `_worldFullDirty`, `_worldRadius`, `_worldSlice` and `_trustedPlayers` are set in `botManager.js:299,343-381` and read in `bot/worldView.js` and `bot/entityView.js`.

**Fix:** put them in a `WorldTracker` object owned by the session, and pass it into `readSlice`/`getWorldView`. Pass trusted players explicitly to `getMotion`.

### 2.4 🟠 `src/components/Surroundings3D.tsx` (1,206 lines)

- **The main `useEffect` runs from line 199 to line 1085: 886 lines in one closure.**
  - It creates the renderer, camera, controls, materials, input handlers, the render loop, settings listeners and teardown.
  - It can't be tested and is very hard to read.
- `useEffect` dependency at `:1145`: `[chests.map(…).join(';'), anchorVersion]`. That's a computed expression in a deps array, which `react-hooks/exhaustive-deps` would flag. Use a `useMemo` key.
- The name: the folder is `watcher/`, the comments say "watcher", the component is `Surroundings3D`, and the data type is `WorldView`. Pick one name (suggestion: **Watcher**).

**Fix:** move scene ownership into a plain TS class (`WatcherScene`) with `mount(container)`, `update(blocks)`, `setMotion()`, `setSettings()` and `dispose()`. Split input handling into `watcher/input/*.ts`. The React component then becomes a thin wrapper of about 150 lines. Most of `watcher/*.ts` is already factored this way, so it's mostly about moving code.

### 2.5 🟠 Settings and plugin state have no single owner

The same setting can live in 4 places:

| Store | Examples |
| --- | --- |
| React state (`usePluginControls`, `App`) | `autoEatEnabled`, `pvpOptions` |
| Renderer `localStorage` | `ryksu:pluginPreferences`, `ryksu:graphics`, `trustedPlayers`, `savedLocations`, `ryksu.mining.ores` |
| Main-process memory (`BehaviorManager`, controllers) | `state.pvp`, `desiredEnabled` |
| Main-process file (`userData/display.json`) | `unlimitedFps` |

Problems this causes:

- **Settings are applied twice on every connect.** They're sent in the `connect` options (`App.tsx:162-184`), and then `usePluginControls` pushes all of them again when the status becomes `connected` (`usePluginControls.ts:127`).
- **Rollback is broken.** Optimistic updates catch only thrown errors (see §2.2).
- **The data model is confusing.** `allowBlockBreak` and `mobMovementEnabled` are pathfinding settings, but they're stored under `pvp`. The toolbar's "Break / Place Blocks" toggle writes to `pvpOptions`.

**Fix:** keep one settings store in the main process (`userData/settings.json`, or `electron-store`) with a typed schema. The renderer reads it once and subscribes to changes. Regroup the model as `{ automation: {armor, eat, tool, shield}, combat: {...}, movement: {allowBlockBreak, ...}, graphics: {...} }`.

### 2.6 🟠 `App.tsx` is a prop-drilling hub

- `App` has 22 `useState` hooks.
- `TitleBar` takes **37 props**, and `ConnectionForm` takes 21.
- `attemptConnect` takes a flattened 20-field object and then rebuilds the nested `pvp` object (`App.tsx:136-191`).

**Fix:** use a `ConnectionContext` (form and status) and a `SettingsContext` (from §2.5), or a small store like Zustand. Then `TitleBar` reads what it needs, and the connect call just passes `settings`.

### 2.7 🔴 Unbounded chat history

- `useChatHistory` saves **every** message per server to `localStorage`, with no limit. `localStorage` is about 5 MB per origin, so busy servers will hit `QuotaExceededError`.
  - When that happens, the error is caught and logged (`useChatHistory.ts:29`), so history silently stops saving. Other keys (settings, graphics) will also fail to save.
- `ChatBridge` in the main process also keeps every message for the session (tests now assert there's no limit). That means memory grows without bound during long AFK sessions.

**Fix:** store transcripts in a file per server under `userData/chats/`, or in IndexedDB. Keep a bounded ring buffer in memory (e.g. 1,000 entries) with on-demand paging.

### 2.8 🟠 Plugin controller boilerplate

- `armorManager.js`, `autoEat.js`, `autoTool.js` and `autoShield.js` each re-implement `attach`, `detach`, `setEnabled`, `isEnabled`, `_enable` and `_disable` with the same `desiredEnabled` vs `enabled` logic.
- **Possible race:** `AutoEatController._enable` is `async` and only sets `this.enabled = true` at the end, after `await loadAutoEatPlugin(...)`.
  - That `await` isn't needed, since the function is synchronous.
  - Two quick `setEnabled(true)` calls can both get past the `if (this.enabled) return` guard and register the listeners twice.

**Fix:** add a `ToggleablePlugin` base class. Make `_enable` synchronous, or set a guard flag before the first `await`.

### 2.9 🟡 Dead code and leftovers

- `plugins/pathfinder.js:421` `if (Number.isFinite(distance)) {}` and `:494` `if (reason !== 'replace-goal') {}` are empty blocks (leftover logging). The `distance` computed just before `:421` is also unused.
- `plugins/pathfinder.js:517`: `_handlePathReset() {}` is a no-op that still gets bound to an event.
- `usePluginControls.togglePvpPlayer` and the player-PvP settings (`playerEnabled`, `playerTarget`) are fully wired in the backend but have **no UI**. Either finish the feature or remove it.
- The 6 unused IPC endpoints listed in §2.2.
- `main.js:153`: commented-out `openDevTools()`.
- `tailwind.config.js`: ignored by Tailwind v4 (no `@config` in `index.css`), so the `Inter` font setting does nothing.
- `postcss.config.js`: `autoprefixer` isn't needed with Tailwind v4, which handles prefixes itself.

### 2.10 🟡 Duplicated knowledge

| What | Where |
| --- | --- |
| "Is this a door" | `botManager._isDoorBlock`, `plugins/pathfinder.isOpenDoorway`, `watcher/picking.isDoorBlock` (+ more; 10 matches) |
| `prop === true \|\| prop === 'true'` | 8 copies |
| `HOTBAR_START = 36` | `Dashboard.tsx:17`, `bot/inventoryActions.js:5`, `bot/worldView.js:38` |
| "Plugin sent a packet Ryksu could not parse" | `botManager.js:44` and `utils/chat.ts` (`normalizeProtocolError`) |
| `{ x: number; y: number; z: number }` | written inline 24 times in types |
| Interactive block lists | `src/shared/interactiveBlocks.json` and `core/pathfinder/lib/interactable.json` |
| Eye height | `1.62` (`botManager.js:509`) vs `1.6` (`:1173`) |

**Fix:** `src/shared/blocks.ts` (door, liquid and interactive checks, `isTrue`), `src/shared/inventory.ts` (slot constants) and `src/shared/geometry.ts` (`Vec3Like`).

### 2.11 🟡 Cross-module private access

`this.pvp._clearTarget()` (4 times), `this.mining._targetLabel()`, `this.autoTool._ensurePlugin()` and `this.creeperWatch.pvp = this.pvp` (assigned after construction to avoid a circular dependency). These should be public methods, or the dependency should be passed in properly.

### 2.12 🟡 Main-process hygiene (`src/main.js`)

- It patches `process.emitWarning` and `console.log` globally to hide two specific messages. Keep the patches, but move them to `main/silenceKnownWarnings.ts` with a test, so they don't hide other output.
- `window:grabPointer` calls `executeJavaScript('window.__ryksuGrabPointer?.()')`, so the main process runs code in the page. Consider exposing a preload callback instead.
- `system:openExternal` awaits `shell.openExternal(url)` without a `try`. A failure rejects the IPC call, which goes against the `{ ok }` convention.
- Logging uses 68 `console.*` calls with mixed prefixes (`[BotManager]`, `[Pathfinder]`, none). Add a tiny `log(scope)` helper. That also allows writing logs to a file for bug reports ("Copy app info" could attach the last N lines).

### 2.13 🟡 Window-event messaging

`MiningPanel` fires `window.dispatchEvent(new Event('ryksu:pick-mining-chests'))`, and `Dashboard` listens for it. This is a hidden coupling that bypasses React. Lift `pickingChests` into shared state or a context.

---

## 3. UI and UX

### 3.1 🟠 Title bar overload

When connected, the title bar shows: Armor, Shield, Tool, Eat, Attack Mobs, Jump Attack, Mining, Break/Place, Settings, the Sleep button, Connect/Disconnect, Minimize and Close. That's 13 controls, plus ping, FPS, XP and coordinates, all in a fixed 1125 px wide window.

- **Settings are hidden behind right-click** (Auto Eat and Attack Mobs say "Right-click for settings"). Nothing on screen tells you that.
- **Related controls are spread out.** "Jump Attack" and "Attack Mobs" sit next to each other with no grouping, and "Break / Place Blocks" is about pathfinding but sits after Mining.
- **On/off state is shown only by colour,** which fails for colour-blind users.

**Fix:** add one **"Automation"** button that opens a popover with labelled switches in sections (*Gear*: armor, shield, tool · *Survival*: eat, sleep · *Combat*: mobs, jump attack · *Movement*: break/place). Each section gets a ⚙ that opens its settings. Keep 2–3 pinned quick toggles if you like.

### 3.2 🟠 Fixed, non-resizable window

- `resizable: false`, 1125×750 (`main.js:131-136`), and the 3D view defaults to `h-[360px]`.
- On a large display, the main feature (the 3D watcher) stays small.

**Fix:** allow resizing (with a sensible `minWidth`/`minHeight`), make the watcher fill the available space, and save the window bounds.

### 3.3 🔴 Connection form

- **"Microsoft password (optional)"** (`ConnectionForm.tsx:250`):
  - Mineflayer's Microsoft auth uses the device-code flow, so the password isn't needed.
  - Asking for a Microsoft account password trains users into unsafe habits, and the field is still kept in React state.
  - Remove the field.
- The password "reveal" is only a CSS `blur-sm`. The plain-text password is still in the DOM and can be selected with dev tools. Show `••••••` and reveal on click instead.
- The summary vs edit mode needs an extra click ("Edit") for the most common change, switching servers. Consider a **saved servers list** (host, port, username, version) with the server preview from `ServerPreview.tsx` on each card.

### 3.4 🟠 Four different feedback channels

Errors and results show up in the `StatusPill`, the watcher's notice bubble (`onNotice`), system chat messages, and OS notifications (Auto Mine stopped). The same event can show in two of them, and other events show in none.

**Fix:** add one toast or notice system with levels (info, success, warn, error). Errors also get written to chat. Use OS notifications only when the window isn't focused.

### 3.5 🟠 Modals are re-implemented 4+ times

`AutoEatSettingsModal`, `PvpSettingsModal`, `SettingsPage` (overlay mode), `TradePanel` and `EntityPopover` each have their own Escape handler, backdrop and header.

- None of them trap focus or return focus to the button that opened them.
- `SettingsPage` behaves differently when connected (overlay) and disconnected (full page).

**Fix:** a shared `<Dialog>` component, or Radix/Headless UI `Dialog`, with a focus trap, `aria-labelledby` and restoring focus on close.

### 3.6 🟡 Visual consistency

- **Undefined class:** the root uses `bg-app` (`App.tsx:471`), which isn't defined anywhere, so it does nothing.
- **Accent colours mix:** sky is primary (125 uses), but the root text is `text-purple-100` and the item glint is purple/violet. Define design tokens with Tailwind v4 `@theme` (`--color-accent`, `--color-danger`, …) and use them.
- **Tiny text:** 46 uses of arbitrary sizes such as `text-[0.6rem]`/`text-[0.7rem]` (≈ 9.6–11 px). Set the minimum readable size to 12 px, and use the type scale instead of arbitrary values.
- **Font:** `Inter` is configured (and ignored, see §2.9) but never loaded. Either bundle it with `@fontsource/inter` or remove it.
- **Branding:** "0xmthan" under the logo is shown on every screen. Consider showing it only on the About page.

### 3.7 🟡 Discoverability

- Keyboard shortcuts (B = build mode, Tab = players, F5/F = first person, scroll to enter first person, double-click to attack, hold to walk) aren't shown anywhere. Add a `?` shortcut overlay and tooltips.
- The update check opens the browser **automatically** when an update exists (`main.js:93-101`). Show "v2.2.0 available – Open releases" and let the user click instead.

### 3.8 🟡 Data scope bugs

- **Saved locations are global** (`localStorage['savedLocations']`), so locations from server A show up on server B. Key them by server, the same way chat is keyed.
- Saved location IDs use `Date.now().toString()`, and local chat IDs use `` `${Date.now()}-local` ``. Two entries created in the same millisecond collide. Use `crypto.randomUUID()`.

---

## 4. File structure

### Current

```
src/
  main.js  preload.js  mcBridge.js  botManager.js  worldWorker.js   ← main process
  serverPing.js  appUpdates.js                                      ← main process
  App.tsx  renderer.tsx  index.html  index.css                      ← renderer
  types.ts  global.d.ts  css.d.ts  raw.d.ts                         ← mixed
  bot/  bot/plugins/  bot/plugins/core/  bot/plugins/pvp/           ← main process
  components/  components/watcher/ (mostly .ts, not components)     ← renderer
  hooks/  utils/  utils/entity/                                     ← renderer
  shared/interactiveBlocks.json  generated/*.json
  .vite/  ← stale build output inside src (3.5 MB, untracked)
```

Problems:

- Main-process and renderer files sit next to each other at the root of `src/`, so you can't tell where a file runs from its path.
- `components/watcher/` holds mostly three.js modules, not React components.
- `utils/` is a catch-all: `blockMesher.ts` (660 lines) is a core engine piece, while `chat.ts` also holds the last-connection storage key.
- There are two plugin layers with the same names: `plugins/autoEat.js` (controller) and `plugins/core/autoEat/` (vendored plugin). `core/` is really `vendor/`.
- Leftover build output in the working tree: `src/.vite/`, `.webpack/` (85 MB, from the old webpack setup) and `out/` (961 MB). They're ignored by git but confuse searches. `.webpack/` can be deleted.
- `.gitignore` lists `.vscode`, but `.vscode/settings.json` is tracked. It also sets `prettier.printWidth: 100`, which conflicts with `.prettierrc`'s `110`.

### Proposed

```
src/
  main/
    index.ts                 // app lifecycle, window
    window.ts
    ipc/registerAppIpc.ts  ipc/registerBotIpc.ts  ipc/handle.ts
    settings/store.ts        // single source of truth (§2.5)
    services/serverPing.ts  services/updates.ts  services/mojang.ts (skins, names)
    bot/
      BotSession.ts  control.ts  snapshot.ts
      world/  (worldView, worldCompute, WorldStream, worker.ts)
      entities/ (entityView, entityEvents, entityVariants, playerNames, profileTextures)
      actions/ (building, blockInteraction, inventoryActions, trading, doors)
      plugins/ (AutoEatController.ts, PathfinderController.ts, …, registry.ts)
      vendor/  (was plugins/core — forked mineflayer plugins)
  preload/index.ts
  renderer/
    index.html  main.tsx  App.tsx  index.css
    app/ (contexts, providers)
    features/
      connection/  dashboard/  chat/  inventory/  mining/  trading/  settings/  about/
      watcher/     (Watcher.tsx + scene/, input/, effects/, meshing/ ← blockMesher, blockAtlas, entity/)
    components/ui/ (Dialog, Switch, Segmented, ToolbarButton, StatusPill)
    hooks/  lib/
  shared/
    ipc.ts  types.ts  blocks.ts  inventory.ts  geometry.ts  constants.ts
    data/interactiveBlocks.json
  generated/
```

**Pros:** you can tell where code runs from its path, per-process `tsconfig` files map onto folders cleanly, and features are grouped together.
**Cons:** one large `git mv` PR, and anyone with open branches will need to rebase. Do it with no content changes so `git log --follow` keeps working.

---

## 5. Security and privacy

### 5.1 🔴 Credentials in `localStorage`

The server login password (`offlinePassword`) is saved as plain text in `ryksu:lastConnection` (`useConnectionPreferences.ts:94-101`).

**Fix:** store secrets in the main process with Electron `safeStorage.encryptString` (Keychain on macOS). The renderer gets back only "has saved password: yes/no".

### 5.2 🔴 Microsoft password field

See §3.3. Remove it, along with the `password` connect option sent to mineflayer.

### 5.3 🟠 Renderer hardening

- No Content-Security-Policy in `src/index.html`. Add one, e.g. `default-src 'self'; img-src 'self' data:; connect-src 'self'` (plus the Vite dev-server origin in dev).
- No `setWindowOpenHandler` / `will-navigate` guard. Add both, denying everything by default.
- Set `sandbox: true` explicitly in `webPreferences` (it's the default today, but stating it protects against regressions).
- Some IPC handlers don't validate their input (`interactBlock`, `inventoryAction`, `buildAction`, `setTrustedPlayers`, `firstPerson.*`). Add validation (see the migration doc §2.4 C).

---

## 6. Tooling and conventions

### 6.1 🟠 Lint and format aren't enforced

- ESLint 9 is installed, but the config is the legacy `.eslintrc.json`, so ESLint crashes. There's no `typescript-eslint` either.
- 80 files fail `prettier --check`. For example, `useChatHistory.ts` uses `entry =>` even though the config has `arrowParens: always`, and has lines up to 169 characters with a `printWidth` of 110.
- No pre-commit hook, and CI doesn't run lint.

**Fix:** add `eslint.config.js` (flat config) with `typescript-eslint`, `react-hooks` and `prettier`. Run `prettier --write` once and add that commit to `.git-blame-ignore-revs`. Add `pnpm lint` to CI, and optionally `lint-staged` + `simple-git-hooks`.

### 6.2 🟡 Tests

- 110 tests, all for pure logic. Good coverage of the camera, meshing, and entity geometry.
- Tests load modules in **three different ways**: plain `require`, `require` through a `.ts` hook, and `vm.runInNewContext(ts.transpileModule(readFileSync(...)))`, used in 8 files. The `vm` style breaks on any rename.
- No tests for: IPC handlers, `BotManager` lifecycle (connect, kick, reconnect), the build queue, door operations, settings persistence, or any React component or hook.

**Fix:** use one loading style (`import` from `.ts`). Once `BotManager` is split (§2.1), add lifecycle tests with a fake `bot` `EventEmitter`. React component tests are out of scope for now; the logic worth testing (chat merging, settings parsing) can live in plain `.ts` functions that `node:test` already covers.

### 6.3 🟡 Commit messages

The history mixes `feat: …` (conventional) with long multi-topic subjects ("Add Settings page with graphics presets, AO, fog, realistic water and ray-traced torches Add FPS counter, …"). The release workflow uses a `vX.Y.Z` prefix. Pick one style, ideally one topic per commit, so `git bisect` and changelogs stay useful.

---

## 7. Performance and packaging

### 7.1 🟠 489 MB `app.asar`

- `vite.main.config.mjs` treats **every** entry in `dependencies` as external, and `forge.config.js` ships all of `node_modules`.
  - So renderer-only packages are shipped twice: bundled by Vite **and** included raw.
  - Examples: `react`, `react-dom`, `three` (22 MB) and `lucide-react` (45 MB).
- `minecraft-data` ships data for every Minecraft version.

**Fix:** move renderer-only packages to `devDependencies` (Vite bundles them anyway). Prune `minecraft-data` to `SUPPORTED_VERSIONS` in a Forge `packageAfterCopy` hook. Check the result with `npx asar list`.

### 7.2 🟡 World view diffing

- `_sendWorldView` runs `JSON.stringify(view.inventory)` every 500 ms just to detect changes (`botManager.js:711-713`).
- **Fix:** keep a revision counter that increments on mineflayer's `windowUpdate`/`updateSlot` events.

### 7.3 🟡 `generated/blockModels.json` (2.1 MB) is imported into the renderer bundle

That's fine for now, but loading it lazily (`fetch` of a static asset) would make the first paint of the connection screen faster.

---

## 8. Naming

| Current | Problem | Suggestion |
| --- | --- | --- |
| `Surroundings3D` / "watcher" / `WorldView` | Three names for one feature | `Watcher` (component), `WatcherScene` (three.js) |
| `WorldView` type | Holds the **inventory** and blocks | Split into `InventoryView` + `BlockView`, or call it `WorldUpdate` |
| `InventoryItem` (includes `\| null`) | Leads to `NonNullable<InventoryItem>` in many places | `InventoryItem` (non-null) + `Slot = InventoryItem \| null` |
| `mcBridge.js` | Vague | `ipc/registerBotIpc.ts` |
| `bot/plugins/core/` | It's vendored forks | `bot/vendor/` |
| `plugins/autoEat.js` vs `core/autoEat/` | Same name, different layers | `AutoEatController.ts` |
| `Controller` suffix on some classes only (`CreeperWatch`, `AutoSleep`, `BedController`, `BehaviorManager`, `FirstPersonActions`) | Inconsistent | Pick one (`…Controller`) or drop the suffix everywhere |
| `openingBlock` | Also means "trading" | `interaction: 'block' \| 'trader' \| null` |
| PvP `isFleeing` callback | Also true when a chest is open | `shouldHoldOff` / `isBotBusy` |
| `pvp.allowBlockBreak`, `pvp.mobMovementEnabled` | Pathfinding settings under `pvp` | `movement.allowBlockBreak`, `combat.chaseMobs` |
| `normaliseError` vs `normalizeProtocolError`, `normalizeHost` | British vs American spelling | `normalize*` everywhere |
| `STORAGE_KEY` in `utils/chat.ts` | It's the last-connection key | `LAST_CONNECTION_KEY` in `settings/keys.ts` |
| localStorage keys `trustedPlayers`, `savedLocations`, `ryksu:graphics`, `ryksu.mining.ores` | Three different styles | `ryksu:<area>:<name>` everywhere (with a one-time migration) |
| `prettyName` exported from `utils/blockColors.ts` | Unrelated to colours | `utils/names.ts` |
| `astartTimedout` (`core/pathfinder/index.ts:30`) | Typo | `astarTimedOut` |
| `mgrEnabled`, `eatEnabled`, `toolEnabled` in `usePluginControls` | Abbreviations of names that are already short | Use the original names |
| `getRyksuAuthor`, `state`/`stateRef` (Surroundings3D) | Vague | `systemAuthorName`, `sceneRef` |
| `useSavedLocations` (named export) vs other hooks (default export) | Inconsistent | Named exports everywhere |
| `isConnected` vs `connected` vs `snapshot.connected` | Same idea, three spellings | `isConnected` in UI, `connected` in data |

---

## 9. Suggested order of work

1. **Tooling:** flat ESLint config, a one-off Prettier pass, and lint in CI (§6.1). *½ day*
2. **Security quick wins:** remove the Microsoft password, `safeStorage` for the server password, CSP, navigation guards (§5). *1 day*
3. **Chat storage bound** (§2.7) and **saved locations per server** (§3.8). *1 day*
4. ✅ **IPC contract + TS migration** (done). Includes the `BotManager` split (§2.1), the plugin base class (§2.8) and dedupe (§2.10). *2–3 weeks*
5. **Folder restructure** with `git mv` only (§4), after the migration. *½ day*
6. **Settings single source of truth** (§2.5) + context instead of prop drilling (§2.6). *2–3 days*
7. **UI:** Automation popover (§3.1), resizable window (§3.2), shared Dialog (§3.5), toasts (§3.4), design tokens (§3.6). *1 week*
8. **Watcher refactor** (§2.4). *3–4 days*
9. **Packaging diet** (§7.1). *1 day*
