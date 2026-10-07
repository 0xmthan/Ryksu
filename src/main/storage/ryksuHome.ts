import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Where Ryksu keeps the user's saves and settings: ~/.ryksu, or RYKSU_HOME (tests, a separate profile). The
// dev and packaged apps share it. Only the user can read it; passwords and tokens in it are encrypted with
// the Keychain (see secrets.ts).
//
//   settings.json                      app settings and the window's preferences
//   servers/<host>_<port>/             per server: locations.json, mining-chests.json, chat-<account>.json
//   scripts/<name>.js                  the user's scripts
//   secrets/                           encrypted: passwords.json, auth/ (Microsoft sign-in)
//   cache/                             safe to delete: player-names.json
export const ryksuHome = () => process.env.RYKSU_HOME || path.join(os.homedir(), '.ryksu')

export const homePath = (...parts: string[]) => path.join(ryksuHome(), ...parts)

// A server's folder name: "play.example.com:25565" → "play.example.com_25565".
export const serverFolder = (server: string) => server.toLowerCase().replace(/[^a-z0-9.-]+/g, '_')

const ensureFolder = (folder: string) => {
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 })
}

export const readJson = <T>(file: string, fallback: T): T => {
  try {
    return JSON.parse(fs.readFileSync(homePath(file), 'utf8')) as T
  } catch {
    return fallback
  }
}

// Writes to a temporary file first and swaps it in, so a crash never leaves half a file. Only the user can
// read it.
export const writeFile = (file: string, contents: string | Buffer) => {
  const target = homePath(file)
  ensureFolder(ryksuHome())
  ensureFolder(path.dirname(target))
  const temporary = `${target}.${process.pid}.tmp`
  fs.writeFileSync(temporary, contents, { mode: 0o600 })
  fs.renameSync(temporary, target)
}

export const writeJson = (file: string, data: unknown) => writeFile(file, JSON.stringify(data, null, 2))

export const removeFile = (file: string) => {
  fs.rmSync(homePath(file), { force: true })
}

// The files directly in a folder (names only), or none if it doesn't exist.
export const listFiles = (folder: string) => {
  try {
    return fs
      .readdirSync(homePath(folder), { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

export const listFolders = (folder: string) => {
  try {
    return fs
      .readdirSync(homePath(folder), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}
