// @ts-check
const { execFileSync } = require('node:child_process')
const path = require('node:path')
const { FusesPlugin } = require('@electron-forge/plugin-fuses')
const { FuseV1Options, FuseVersion } = require('@electron/fuses')

/** @type {import('@electron-forge/shared-types').ForgeConfig} */
module.exports = {
  packagerConfig: {
    asar: true,
    icon: './assets/icon',
    appBundleId: 'dev.mthan.ryksu',
    // Vite's default filter only copies bundles. The main process keeps
    // runtime dependencies external so their native modules and data survive.
    ignore: (file) =>
      Boolean(file) &&
      !['/.vite', '/node_modules', '/package.json'].some(
        (entry) => file === entry || file.startsWith(`${entry}/`)
      ),
  },
  rebuildConfig: {},
  hooks: {
    // Packaging renames Electron's app and flips its fuses, which breaks the signature it ships with. macOS
    // quietly refuses an app with a broken signature things like notifications (no prompt, nothing shown),
    // so the app is signed again once it's built: with the certificate named in RYKSU_SIGN_IDENTITY (from
    // `security find-identity -p codesigning`), or else ad hoc ("-"), which is enough on this Mac.
    postPackage: async (_config, { platform, outputPaths }) => {
      if (platform !== 'darwin') return
      const identity = process.env.RYKSU_SIGN_IDENTITY || '-'
      for (const output of outputPaths) {
        const app = path.join(output, 'Ryksu.app')
        execFileSync('codesign', ['--force', '--deep', '--sign', identity, app])
        execFileSync('codesign', ['--verify', '--deep', '--strict', app])
      }
    },
  },
  makers: [
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    {
      name: '@electron-forge/plugin-vite',
      config: {
        build: [
          { entry: 'src/main/index.ts', config: 'vite.main.config.mjs', target: 'main' },
          { entry: 'src/preload/index.ts', config: 'vite.preload.config.mjs', target: 'preload' },
          { entry: 'src/main/bot/world/worker.ts', config: 'vite.worker.config.mjs', target: 'main' },
        ],
        renderer: [{ name: 'main_window', config: 'vite.renderer.config.mjs' }],
      },
    },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
}
