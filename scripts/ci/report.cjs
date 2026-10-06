const fs = require('node:fs')
const { releaseVersion } = require('./release-version.cjs')

const status = (result) =>
  ({
    success: '✅ Passed',
    failure: '❌ Failed',
    cancelled: '⏹ Cancelled',
    skipped: '⏭ Skipped',
  })[result] || '— Not run'

const cell = (value) =>
  String(value)
    .replace(/[&<>|`[\]\\]/g, (char) => `&#${char.charCodeAt(0)};`)
    .replace(/[\r\n]+/g, ' ')
const hasPublishedFix = (advisory) =>
  typeof advisory.patched_versions === 'string' &&
  advisory.patched_versions.trim() !== '' &&
  !/^(?:none|<0\.0\.0)$/i.test(advisory.patched_versions.trim())
const isArtifactUrl = (url) =>
  /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/\d+\/artifacts\/\d+$/.test(url || '')

function auditCounts(report) {
  const counts = report?.metadata?.vulnerabilities
  if (
    !counts ||
    !['critical', 'high', 'moderate', 'low', 'info'].every(
      (key) => Number.isInteger(counts[key]) && counts[key] >= 0
    )
  )
    return null
  return counts
}

function packageDetails(report, manifest = {}) {
  const rank = { critical: 5, high: 4, moderate: 3, low: 2, info: 1 }
  const advisories = Object.values(report?.advisories || {})
    .filter((a) => a && typeof a.module_name === 'string')
    .sort(
      (a, b) =>
        (rank[b.severity] || 0) - (rank[a.severity] || 0) || a.module_name.localeCompare(b.module_name)
    )
  if (!advisories.length) return []
  const groups = new Map()
  for (const advisory of advisories) {
    const group = groups.get(advisory.module_name) || {
      severity: advisory.severity,
      versions: new Set(),
      scopes: new Set(),
      parents: new Set(),
      advisories: [],
    }
    group.advisories.push(advisory)
    for (const finding of advisory.findings || []) {
      if (finding.version) group.versions.add(finding.version)
      group.scopes.add(finding.dev === true ? 'Dev' : finding.dev === false ? 'Runtime' : 'Unknown')
      for (const path of finding.paths || []) {
        const parent = String(path)
          .split('>')
          .find((part) => part && part !== '.')
        if (parent) group.parents.add(parent)
      }
    }
    groups.set(advisory.module_name, group)
  }
  const lines = [
    '### Affected packages',
    '',
    `${groups.size} packages · ${advisories.length} advisories · No published fix: ${advisories.filter((advisory) => !hasPublishedFix(advisory)).length}. Highest severity first.`,
    '',
    '| Package | Severity | Installed | Dependency | Parent dependency to review | Findings |',
    '| :--- | :--- | :--- | :--- | :--- | ---: |',
  ]
  for (const [name, group] of groups) {
    const direct =
      Object.hasOwn(manifest.dependencies || {}, name) || Object.hasOwn(manifest.devDependencies || {}, name)
    const parentNames = [...group.parents].sort()
    const parents = parentNames.length
      ? parentNames.slice(0, 3).map(cell).join('<br>') +
        (parentNames.length > 3 ? `<br>+${parentNames.length - 3} more in paths` : '')
      : cell(direct ? name : 'Unknown')
    lines.push(
      `| ${cell(name)} | ${cell(group.severity)} | ${cell([...group.versions].join(', ') || 'Unknown')} | ${direct ? 'Direct' : 'Transitive'} · ${cell([...group.scopes].join(' + ') || 'Unknown')} | ${parents} | ${group.advisories.length} |`
    )
  }
  lines.push(
    '',
    '<details>',
    '<summary>Advisories, available fixes, and dependency paths</summary>',
    '',
    'Patched ranges below apply to each advisory individually. Transitive packages usually require updating the parent dependency.',
    ''
  )
  for (const advisory of advisories) {
    const patch = hasPublishedFix(advisory) ? advisory.patched_versions : 'No fix published'
    const link = /^https:\/\/github\.com\/advisories\/GHSA-[\w-]+$/.test(advisory.url || '')
      ? `[${cell(advisory.github_advisory_id || 'Advisory')}](${advisory.url})`
      : 'No advisory link available'
    lines.push(
      `**${cell(advisory.module_name)} · ${cell(advisory.severity)}** — ${cell(advisory.title || 'Security advisory')}`,
      '',
      `Patched: ${cell(patch)} · ${link}`,
      ''
    )
    const paths = [...new Set((advisory.findings || []).flatMap((finding) => finding.paths || []))]
    for (const path of paths) lines.push(`- ${cell(path)}`)
    lines.push('')
  }
  lines.push('</details>', '')
  return lines
}

function summary(results, env = {}, auditReport = null, manifest = {}) {
  const packages = results.packages || {}
  const checks = results.checks || {}
  const release = results.release || {}
  const outputs = checks.outputs || {}
  const requested = env.GITHUB_EVENT_NAME === 'push' ? releaseVersion(env.COMMIT_MESSAGE) : ''
  const failed = [packages, checks, release].some((job) => job.result === 'failure')
  const cancelled = [packages, checks, release].some((job) => job.result === 'cancelled')
  const complete =
    packages.result === 'success' &&
    checks.result === 'success' &&
    ['success', 'skipped'].includes(release.result)
  const lines = [
    '## CI report',
    '',
    failed
      ? '**❌ Checks need attention**'
      : cancelled
        ? '**⏹ Run cancelled**'
        : complete
          ? '**✅ All checks passed**'
          : '**— Checks incomplete**',
    '',
    `Commit: \`${cell((env.GITHUB_SHA || '').slice(0, 7))}\` · ${requested ? `Release: **v${cell(requested)}**` : 'Regular commit'}`,
    '',
    '| Check | Result |',
    '| :--- | :--- |',
    `| Package audit | ${status(packages.result)} |`,
    `| Dependency installation | ${status(outputs.install)} |`,
    `| Type check | ${status(outputs.types)} |`,
    `| Lint | ${status(outputs.lint)} |`,
    `| Format | ${status(outputs.format)} |`,
    `| Tests | ${status(outputs.tests)} |`,
    `| Release ZIP | ${release.result === 'skipped' ? (requested ? '⏭ Skipped · checks did not pass' : '⏭ Skipped · no release requested') : status(release.result)} |`,
    '',
  ]
  let counts
  try {
    counts = auditCounts({
      metadata: { vulnerabilities: JSON.parse(packages.outputs?.vulnerabilities || 'null') },
    })
  } catch {}
  if (counts) {
    lines.push(
      '### Package vulnerabilities',
      '',
      '| Critical | High | Moderate | Low | Info | Total |',
      '| ---: | ---: | ---: | ---: | ---: | ---: |',
      `| ${counts.critical} | ${counts.high} | ${counts.moderate} | ${counts.low} | ${counts.info} | ${Object.values(counts).reduce((sum, count) => sum + count, 0)} |`,
      '',
      '**Audit fails on high or critical findings.**',
      ''
    )
  } else {
    lines.push('Package vulnerability counts unavailable. Check the audit job logs.', '')
  }
  if (auditReport) lines.push(...packageDetails(auditReport, manifest))
  else if (counts && Object.values(counts).some((count) => count > 0)) {
    lines.push('Package details unavailable. Check the audit job or download the package-audit artifact.', '')
  }
  if (isArtifactUrl(packages.outputs?.['artifact-url'])) {
    lines.push(
      `[Download full package audit (JSON)](${packages.outputs['artifact-url']}) · Available for 30 days.`,
      ''
    )
  }
  if (release.result === 'success' && release.outputs?.['artifact-url']) {
    const url = release.outputs['artifact-url']
    if (isArtifactUrl(url)) {
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
    try {
      counts = auditCounts(JSON.parse(fs.readFileSync('audit.json', 'utf8')))
    } catch {}
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `vulnerabilities=${counts ? JSON.stringify(counts) : ''}\n`)
    if (counts) console.log('Vulnerabilities:', counts)
    else console.log('Audit did not return vulnerability counts; see the audit step for errors.')
  } else if (process.argv[2] === 'summary') {
    let auditReport = null
    try {
      auditReport = JSON.parse(fs.readFileSync('audit-report/audit.json', 'utf8'))
    } catch {}
    const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'))
    fs.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      summary(JSON.parse(process.env.CI_RESULTS), process.env, auditReport, manifest)
    )
  } else {
    throw new Error('Expected audit or summary mode')
  }
}

module.exports = { auditCounts, summary, packageDetails }
