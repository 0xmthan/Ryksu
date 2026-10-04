const test = require('node:test')
const assert = require('node:assert/strict')
const { auditCounts, summary } = require('../scripts/ci/report.cjs')

const counts = { critical: 1, high: 32, moderate: 14, low: 3, info: 0 }
const results = {
  packages: { result: 'failure', outputs: { vulnerabilities: JSON.stringify(counts) } },
  checks: { result: 'success', outputs: { install: 'success', types: 'success', tests: 'success' } },
  release: { result: 'skipped' },
}
const env = { GITHUB_EVENT_NAME: 'push', GITHUB_SHA: 'abc123456', GITHUB_REPOSITORY: '0xmthan/Ryksu', GITHUB_RUN_ID: '123' }

test('failed audits show severity totals alongside successful checks', () => {
  const report = summary(results, env)
  assert.match(report, /Checks need attention/)
  assert.match(report, /\| Tests \| ✅ Passed \|/)
  assert.match(report, /\| 1 \| 32 \| 14 \| 3 \| 0 \| 50 \|/)
  assert.match(report, /Skipped · no release requested/)
})

test('missing audit data and skipped tests are not reported as successful', () => {
  assert.equal(auditCounts({ error: 'Registry unavailable' }), null)
  assert.equal(auditCounts({ metadata: { vulnerabilities: { ...counts, high: -1 } } }), null)
  const report = summary({ packages: { result: 'failure' }, checks: { result: 'failure', outputs: { tests: 'skipped' } }, release: { result: 'skipped' } }, { ...env, COMMIT_MESSAGE: 'v2.1.1 Release' })
  assert.match(report, /counts unavailable/)
  assert.match(report, /\| Tests \| ⏭ Skipped/)
  assert.match(report, /Skipped · checks did not pass/)
})

test('successful release reports link to the build artifact', () => {
  const url = 'https://github.com/0xmthan/Ryksu/actions/runs/123/artifacts/456'
  const report = summary({ ...results, packages: { result: 'success' }, release: { result: 'success', outputs: { 'artifact-url': url } } }, { ...env, COMMIT_MESSAGE: 'v2.1.1 Release' })
  assert.match(report, /All checks passed/)
  assert.ok(report.includes(`[Download macOS release ZIP](${url})`))
})

test('pull requests and cancelled runs retain their actual status', () => {
  const report = summary({ ...results, packages: { result: 'cancelled' } }, { ...env, GITHUB_EVENT_NAME: 'pull_request', COMMIT_MESSAGE: 'v2.1.1 Release' })
  assert.match(report, /Run cancelled/)
  assert.match(report, /Regular commit/)
  assert.doesNotMatch(report, /All checks passed/)
})
