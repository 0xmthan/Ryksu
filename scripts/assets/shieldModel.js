const fs = require('node:fs')
const path = require('node:path')
const { VERSION, dataDir, writeJson, pngDataUrl } = require('./common')

module.exports = () => {
  const png = fs.readFileSync(path.join(dataDir, 'entity/shield/shield_base_nopattern.png'))
  writeJson('shieldModel.json', {
    version: VERSION,
    texture: pngDataUrl(png),
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
    cubes: [
      { origin: [-6, -11, -2], size: [12, 22, 1], uv: [0, 0] },
      { origin: [-1, -3, -1], size: [2, 6, 6], uv: [26, 0] },
    ],
  }, 'shield plate and handle')
}
