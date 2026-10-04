const semver = require('semver')

const RELEASES_URL = 'https://github.com/0xmthan/Ryksu/releases'

async function checkForUpdates(currentVersion, fetchRelease = fetch) {
  try {
    const response = await fetchRelease('https://api.github.com/repos/0xmthan/Ryksu/releases/latest', {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Ryksu' },
      signal: AbortSignal.timeout(10000),
    })
    if (response.status === 404) return { status: 'no-release' }
    if (!response.ok) throw new Error(`GitHub returned ${response.status}`)

    const release = await response.json()
    const latestVersion = typeof release.tag_name === 'string' ? semver.valid(release.tag_name) : null
    const installedVersion = semver.valid(currentVersion)
    if (!latestVersion || !installedVersion || release.draft || release.prerelease) {
      throw new Error('Invalid release version')
    }
    return {
      status: semver.gt(latestVersion, installedVersion) ? 'available' : 'current',
      version: latestVersion,
    }
  } catch {
    return { status: 'error', message: 'Could not check GitHub Releases. Please try again.' }
  }
}

module.exports = { checkForUpdates, RELEASES_URL }
