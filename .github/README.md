CI runs dependency auditing, a frozen-lockfile install, type checking, and tests
on every push and pull request. Regular commits skip Electron packaging.

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
