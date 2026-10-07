import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { homePath, readJson, writeFile, writeJson } from './ryksuHome'

// Passwords and sign-in tokens, encrypted with Electron's safeStorage: on macOS the key lives in the Keychain,
// so the files in ~/.ryksu/secrets are useless without it. When encryption isn't available, secrets are kept
// in memory for this run only rather than written in plain text.
const PASSWORDS = 'secrets/passwords.json'

type SafeStorage = typeof import('electron').safeStorage

// Required lazily so tests can load this module without Electron.
const safeStorage = (): SafeStorage | null => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const storage = (require('electron') as typeof import('electron')).safeStorage
    return storage?.isEncryptionAvailable() ? storage : null
  } catch {
    return null
  }
}

const encrypt = (text: string) => safeStorage()?.encryptString(text) ?? null

const decrypt = (data: Buffer) => {
  try {
    return safeStorage()?.decryptString(data) ?? null
  } catch {
    // Encrypted with another key (a reset Keychain entry): as good as gone.
    return null
  }
}

const unsaved = new Map<string, string>()

export const getSecret = (name: string): string | null => {
  if (unsaved.has(name)) return unsaved.get(name)!
  const stored = readJson<Record<string, string>>(PASSWORDS, {})[name]
  return stored ? decrypt(Buffer.from(stored, 'base64')) : null
}

// Saves a secret, or forgets it with null or ''.
export const setSecret = (name: string, value: string | null) => {
  const all = readJson<Record<string, string>>(PASSWORDS, {})
  unsaved.delete(name)
  if (!value) {
    if (!(name in all)) return
    delete all[name]
  } else {
    const encrypted = encrypt(value)
    if (!encrypted) {
      console.warn('[Secrets] Encryption is unavailable; keeping this secret until the app quits.')
      unsaved.set(name, value)
      return
    }
    all[name] = encrypted.toString('base64')
  }
  writeJson(PASSWORDS, all)
}

// A server login password's name: per server and username.
export const serverPasswordName = (host: string, port: string, username: string) =>
  `server-password:${host.trim().toLowerCase()}:${port.trim() || '25565'}:${username.trim().toLowerCase()}`

// One of prismarine-auth's token caches (Microsoft sign-in), encrypted, in ~/.ryksu/secrets/auth.
class EncryptedCache {
  private file: string
  private cache: Record<string, unknown> | undefined

  constructor(file: string) {
    this.file = file
  }

  async reset() {
    await this.setCached({})
    return {}
  }

  async getCached() {
    if (this.cache === undefined) {
      try {
        const text = decrypt(fs.readFileSync(homePath(this.file)))
        this.cache = text ? (JSON.parse(text) as Record<string, unknown>) : {}
      } catch {
        this.cache = {}
      }
    }
    return this.cache
  }

  async setCached(cached: Record<string, unknown>) {
    this.cache = cached
    const encrypted = encrypt(JSON.stringify(cached))
    // Without encryption the tokens last until the app quits, and signing in is asked for again next time.
    if (encrypted) writeFile(this.file, encrypted)
  }

  async setCachedPartial(cached: Record<string, unknown>) {
    await this.setCached({ ...(await this.getCached()), ...cached })
  }
}

// Passed to mineflayer as `profilesFolder`, which prismarine-auth accepts as a cache factory.
export const authCache = ({ username, cacheName }: { username: string; cacheName: string }) =>
  new EncryptedCache(
    `secrets/auth/${createHash('sha1').update(username).digest('hex').slice(0, 12)}_${cacheName}.bin`
  )
