// The release version a commit subject asks for ("v2.1.1 Release" → "2.1.1"), or '' for none.
export function releaseVersion(message = ''): string {
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
