const fs = require('node:fs')
const { releaseVersion } = require('./release-version.cjs')

const status = (result) => ({
  success: '✅ Passed',
  failure: '❌ Failed',
  cancelled: '⏹ Cancelled',
  skipped: '⏭ Skipped',
}[result] || '— Not run')

const cell = (value) => String(value).replace(/[&<>|`\[\]\\]/g, (char) => `&#${char.charCodeAt(0)};`).replace(/[\r\n]+/g, ' ')

function auditCounts(report) {
  const counts = report?.metadata?.vulnerabilities
  if (!counts || !['critical', 'high', 'moderate', 'low', 'info'].every((key) => Number.isInteger(counts[key]) && counts[key] >= 0)) return null
  return counts
}

function summary(results, env = {}) {
  const packages = results.packages || {}
  const checks = results.checks || {}
  const release = results.release || {}
  const outputs = checks.outputs || {}
  const requested = env.GITHUB_EVENT_NAME === 'push' ? releaseVersion(env.COMMIT_MESSAGE) : ''
  const failed = [packages, checks, release].some((job) => job.result === 'failure')
  const cancelled = [packages, checks, release].some((job) => job.result === 'cancelled')
  const complete = packages.result === 'success' && checks.result === 'success' && ['success', 'skipped'].includes(release.result)
  const lines = [
    '## CI report', '',
    failed ? '**❌ Checks need attention**' : cancelled ? '**⏹ Run cancelled**' : complete ? '**✅ All checks passed**' : '**— Checks incomplete**', '',
    `Commit: \`${cell((env.GITHUB_SHA || '').slice(0, 7))}\` · ${requested ? `Release: **v${cell(requested)}**` : 'Regular commit'}`, '',
    '| Check | Result |',
    '| :--- | :--- |',
    `| Package audit | ${status(packages.result)} |`,
    `| Dependency installation | ${status(outputs.install)} |`,
    `| Type check | ${status(outputs.types)} |`,
    `| Tests | ${status(outputs.tests)} |`,
    `| Release ZIP | ${release.result === 'skipped' ? (requested ? '⏭ Skipped · checks did not pass' : '⏭ Skipped · no release requested') : status(release.result)} |`, '',
  ]
  let counts
  try { counts = auditCounts({ metadata: { vulnerabilities: JSON.parse(packages.outputs?.vulnerabilities || 'null') } }) } catch {}
  if (counts) {
    lines.push('### Package vulnerabilities', '',
      '| Critical | High | Moderate | Low | Info | Total |',
      '| ---: | ---: | ---: | ---: | ---: | ---: |',
      `| ${counts.critical} | ${counts.high} | ${counts.moderate} | ${counts.low} | ${counts.info} | ${Object.values(counts).reduce((sum, count) => sum + count, 0)} |`, '',
      '**Audit fails on high or critical findings.**', '')
  } else {
    lines.push('Package vulnerability counts unavailable. Check the audit job logs.', '')
  }
  if (release.result === 'success' && release.outputs?.['artifact-url']) {
    const url = release.outputs['artifact-url']
    if (/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/\d+\/artifacts\/\d+$/.test(url)) {
      lines.push(`[Download macOS release ZIP](${url}) · Available for 30 days.`, '')
    }
  }
  const url = `${env.GITHUB_SERVER_URL || 'https://github.com'}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
  lines.push(`[View job logs](${url})`, '')
  return lines.join('\n')
}

if (require.main === module) {
  if (process.argv[2] === 'audit') {
    let counts
    try { counts = auditCounts(JSON.parse(fs.readFileSync('audit.json', 'utf8'))) } catch {}
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `vulnerabilities=${counts ? JSON.stringify(counts) : ''}\n`)
    if (counts) console.log('Vulnerabilities:', counts)
    else console.log('Audit did not return vulnerability counts; see the audit step for errors.')
  } else if (process.argv[2] === 'summary') {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary(JSON.parse(process.env.CI_RESULTS), process.env))
  } else {
    throw new Error('Expected audit or summary mode')
  }
}

module.exports = { auditCounts, summary }
