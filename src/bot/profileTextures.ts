// Profile URLs are supplied by the server; only fetch Mojang texture hashes.
type SkinPlayer = { skinData?: { url?: unknown; capeUrl?: unknown } | null } | null | undefined

const textureUrl = (url: unknown) =>
  typeof url === 'string' && /^https?:\/\/textures\.minecraft\.net\/texture\/[0-9a-f]+$/i.test(url)
    ? url.replace(/^http:/, 'https:')
    : null
export const skinUrl = (player: SkinPlayer) => textureUrl(player?.skinData?.url)
export const capeUrl = (player: SkinPlayer, skinParts?: unknown) =>
  typeof skinParts === 'number' && !(skinParts & 1) ? null : textureUrl(player?.skinData?.capeUrl)
