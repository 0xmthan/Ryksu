# Development

Use Node.js 22.13 or newer and the pnpm version specified in `package.json`.
The current Minecraft data override requires the sibling
`../minecraft-data-26.2` checkout configured in `pnpm-workspace.yaml`;
the CI workflow documents the exact source revisions.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Electron Forge uses Vite to build the main process, preload script, and React
renderer. Runtime Node packages remain external and are included in the
packaged app so their native modules and Minecraft data remain available.

```sh
pnpm test
pnpm typecheck
pnpm make
```

Build output lives in `.vite/`, and distributables are written to `out/make/`.

## CI and releases

CI runs dependency auditing, a frozen-lockfile install, type checking, and tests
on every push and pull request. Regular commits skip Electron packaging.

The run's Summary page includes a CI report with a results table, vulnerability
counts by severity, and a release ZIP download link when a build succeeds.
The report also runs after failed checks and marks skipped steps explicitly.
Affected packages are grouped by name and sorted by highest severity, with
installed versions and direct/transitive plus runtime/dev classification.
The parent dependency column identifies the top-level packages to review, and
the report counts advisories with no published fix. A download link opens the
full audit artifact, including when the audit fails.
Expand the advisory section for patched versions, advisory links, and dependency
paths. The full audit JSON is saved as the package-audit artifact for 30 days.
Linux checks use ubuntu-24.04 to avoid automatic runner OS migrations.

To build a release ZIP, start the commit subject with a version:

```sh
git commit -m "v2.1.1 Release"
git push
```

Prerelease prefixes such as `v2.2.0-beta.1 Preview` also work. Only the latest
commit in a push selects the release version. Pull requests and manual CI runs
do not produce release ZIPs.

After tests and types pass, the release job builds a macOS ZIP using `pnpm make`.
It sets the build's package version from the commit prefix without changing the
committed package.json. Download the ZIP from the workflow run's Artifacts section
within 30 days. This creates a build artifact; publishing a GitHub Release is a
separate step. The dependency audit runs independently and does not gate ZIP
creation.

Minecraft 26.2 data currently uses the pinned head of
[PrismarineJS/minecraft-data PR #1333](https://github.com/PrismarineJS/minecraft-data/pull/1333)
and the 3.117.0 Node wrapper. When an npm release includes this data, remove the
local override in pnpm-workspace.yaml, update the lockfile, and remove the wrapper
and data checkouts plus generation step from both jobs in ci.yml.
