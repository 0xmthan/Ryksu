// Builds the textures the app needs from minecraft-assets, so the app itself doesn't ship the package:
// - src/generated/itemIcons.json: a flat 16×16 icon for each item, and for full-cube blocks the
//   top/left/right textures so the inventory can draw them as 3D cubes like the game.
// - src/generated/blockModels.json: every block's states and model elements, for the 3D watcher.
// - src/generated/entityModels.json: mob geometry, variant and armor textures, for the 3D watcher.
// Run with `node scripts/generate-assets.js` after updating minecraft-assets.
require('./assets/itemIcons')()
require('./assets/blockModels')()
require('./assets/mobModels')()

require('./assets/shieldModel')()
