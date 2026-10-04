// Profile URLs are supplied by the server; only fetch Mojang texture hashes.
const textureUrl = url => typeof url === 'string' && /^https?:\/\/textures\.minecraft\.net\/texture\/[0-9a-f]+$/i.test(url)
  ? url.replace(/^http:/, 'https:') : null
const skinUrl = player => textureUrl(player?.skinData?.url)
const capeUrl = (player, skinParts) =>
  typeof skinParts === 'number' && !(skinParts & 1) ? null : textureUrl(player?.skinData?.capeUrl)
module.exports = { skinUrl, capeUrl }
