// Status effect icons (poison, speed, …) by effect name. Newer asset versions file them elsewhere, so
// this takes them from the newest version that still has a mob_effect folder.
const fs = require('node:fs')
const path = require('node:path')
const { assetsRoot, writeJson } = require('./common')

const newestFirst = (a, b) => b.localeCompare(a, undefined, { numeric: true })

module.exports = () => {
  const version = fs
    .readdirSync(assetsRoot)
    .filter((entry) => fs.existsSync(path.join(assetsRoot, entry, 'mob_effect')))
    .sort(newestFirst)[0]
  const folder = path.join(assetsRoot, version, 'mob_effect')
  const icons = {}
  for (const file of fs.readdirSync(folder).filter((name) => name.endsWith('.png'))) {
    icons[file.slice(0, -4)] = 'data:image/png;base64,' + fs.readFileSync(path.join(folder, file)).toString('base64')
  }
  writeJson('effectIcons.json', { version, icons }, `${Object.keys(icons).length} effect icons from ${version}`)
}
