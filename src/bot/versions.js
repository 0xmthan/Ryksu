const { supportedVersions } = require('minecraft-data')

const SUPPORTED_VERSIONS = (supportedVersions?.pc ?? []).slice().reverse()

const getSupportedVersions = () => SUPPORTED_VERSIONS

module.exports = {
  SUPPORTED_VERSIONS,
  getSupportedVersions,
}
