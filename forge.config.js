const { FusesPlugin } = require('@electron-forge/plugin-fuses')
const { FuseV1Options, FuseVersion } = require('@electron/fuses')

module.exports = {
  packagerConfig: {
    asar: true,
    icon: './assets/icon',
    // Vite's default filter only copies bundles. The main process keeps
    // runtime dependencies external so their native modules and data survive.
    ignore: (file) => Boolean(file) && !['/.vite', '/node_modules', '/package.json'].some(
      (entry) => file === entry || file.startsWith(`${entry}/`),
    ),
  },
  rebuildConfig: {},
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
          { entry: 'src/main.js', config: 'vite.main.config.mjs', target: 'main' },
          { entry: 'src/preload.js', config: 'vite.preload.config.mjs', target: 'preload' },
          { entry: 'src/worldWorker.js', config: 'vite.worker.config.mjs', target: 'main' },
        ],
        renderer: [
          { name: 'main_window', config: 'vite.renderer.config.mjs' },
        ],
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
