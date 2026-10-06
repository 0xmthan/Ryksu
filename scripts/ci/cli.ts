// The CI workflow's entry point, run with Node's built-in type stripping before anything is installed:
//   node scripts/ci/cli.ts audit            audit.json → the audit job's `vulnerabilities` output
//   node scripts/ci/cli.ts release-version  COMMIT_MESSAGE → the checks job's `version` output
//   node scripts/ci/cli.ts summary          job results (CI_RESULTS) → the run summary
import fs from 'node:fs'
import { releaseVersion } from './release-version.ts'
import { auditCounts, summary, type AuditReport, type JobResults, type Manifest } from './report.ts'

const readJson = (file: string): unknown => JSON.parse(fs.readFileSync(file, 'utf8'))

const appendTo = (variable: string, text: string) => {
  const file = process.env[variable]
  if (!file) throw new Error(`${variable} is not set`)
  fs.appendFileSync(file, text)
}

const mode = process.argv[2]
if (mode === 'audit') {
  let counts = null
  try {
    counts = auditCounts(readJson('audit.json') as AuditReport)
  } catch {}
  appendTo('GITHUB_OUTPUT', `vulnerabilities=${counts ? JSON.stringify(counts) : ''}\n`)
  if (counts) console.log('Vulnerabilities:', counts)
  else console.log('Audit did not return vulnerability counts; see the audit step for errors.')
} else if (mode === 'release-version') {
  const version = releaseVersion(process.env.COMMIT_MESSAGE)
  appendTo('GITHUB_OUTPUT', `version=${version}\n`)
  console.log(version ? `Release build requested: v${version}` : 'Regular commit: skip release build')
} else if (mode === 'summary') {
  let auditReport: AuditReport = null
  try {
    auditReport = readJson('audit-report/audit.json') as AuditReport
  } catch {}
  const manifest = readJson('package.json') as Manifest
  const results = JSON.parse(process.env.CI_RESULTS ?? '{}') as JobResults
  appendTo('GITHUB_STEP_SUMMARY', summary(results, process.env, auditReport, manifest))
} else {
  throw new Error('Expected audit, release-version or summary mode')
}
