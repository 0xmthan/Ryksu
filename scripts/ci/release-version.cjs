const fs = require('node:fs')

function releaseVersion(message = '') {
  const subject = message.split(/\r?\n/, 1)[0]
  const match =
    /^v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)(?=\s|$)/.exec(
      subject
    )
  if (!match) return ''
  const prerelease = match[1].split('-').slice(1).join('-')
  if (prerelease.split('.').some((part) => /^0\d+$/.test(part))) return ''
  return match[1]
}

if (require.main === module) {
  const version = releaseVersion(process.env.COMMIT_MESSAGE)
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`)
  console.log(version ? `Release build requested: v${version}` : 'Regular commit: skip release build')
}

module.exports = { releaseVersion }
