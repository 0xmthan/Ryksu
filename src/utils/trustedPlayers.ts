// Players the bot takes gestures from (sneak-jump three times to be followed). Saved in this app, by name,
// and handed to the bot on connect and whenever the list changes.
const STORAGE_KEY = 'trustedPlayers'

export const loadTrustedPlayers = (): string[] => {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(stored) ? stored.filter((name): name is string => typeof name === 'string') : []
  } catch {
    return []
  }
}

export const setPlayerTrusted = async (name: string, trusted: boolean) => {
  const others = loadTrustedPlayers().filter((entry) => entry.toLowerCase() !== name.toLowerCase())
  const next = trusted ? [...others, name] : others
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Storage unavailable; the bot still trusts them until it disconnects.
  }
  await window.electronAPI.bot.setTrustedPlayers(next)
}
