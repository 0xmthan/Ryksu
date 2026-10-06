import test from 'node:test'
import assert from 'node:assert/strict'
import { auditCounts, summary, packageDetails } from '../scripts/ci/report'

const counts = { critical: 1, high: 32, moderate: 14, low: 3, info: 0 }
const results = {
  packages: { result: 'failure', outputs: { vulnerabilities: JSON.stringify(counts) } },
  checks: { result: 'success', outputs: { install: 'success', types: 'success', tests: 'success' } },
  release: { result: 'skipped' },
}
const env = {
  GITHUB_EVENT_NAME: 'push',
  GITHUB_SHA: 'abc123456',
  GITHUB_REPOSITORY: '0xmthan/Ryksu',
  GITHUB_RUN_ID: '123',
}

test('package details group findings and retain per-advisory fixes and paths', () => {
  const report = {
    advisories: {
      one: {
        module_name: 'example',
        severity: 'high',
        title: 'Issue',
        patched_versions: '>=2.0.0',
        findings: [{ version: '1.0.0', dev: false, paths: ['.>parent>example'] }],
      },
      two: {
        module_name: 'example',
        severity: 'critical',
        title: 'Other issue',
        patched_versions: null,
        findings: [{ version: '1.0.0', dev: true, paths: ['.>dev-parent>example'] }],
      },
    },
  }
  const text = packageDetails(report).join('\n')
  assert.match(text, /1 packages · 2 advisories/)
  assert.match(
    text,
    /\| example \| critical \| 1.0.0 \| Transitive · Dev \+ Runtime \| dev-parent<br>parent \| 2 \|/
  )
  assert.match(text, /No published fix: 1/)
  assert.match(text, /Patched: &#62;=2.0.0/)
  assert.match(text, /No fix published/)
  assert.match(text, /parent&#62;example/)
  assert.match(packageDetails(report, { dependencies: { example: '*' } }).join('\n'), /Direct ·/)
})

test('parents are deduplicated at the direct dependency and absent paths stay unknown', () => {
  const report = {
    advisories: {
      one: {
        module_name: 'child',
        severity: 'high',
        patched_versions: '<0.0.0',
        findings: [{ paths: ['.>@scope/parent>middle>child', '.>@scope/parent>child'] }],
      },
      two: { module_name: 'unknown', severity: 'low', patched_versions: '>=1.0.0' },
    },
  }
  const text = packageDetails(report).join('\n')
  assert.match(text, /Transitive · Unknown \| @scope\/parent \| 1/)
  assert.match(text, /\| unknown \| low \| Unknown \| Transitive · Unknown \| Unknown \| 1/)
  assert.match(text, /No published fix: 1/)
})

test('full audit download is available after a failed audit and unsafe URLs are rejected', () => {
  const url = 'https://github.com/0xmthan/Ryksu/actions/runs/123/artifacts/789'
  const withUrl = (url: string) => ({
    ...results,
    packages: { ...results.packages, outputs: { ...results.packages.outputs, 'artifact-url': url } },
  })
  assert.ok(summary(withUrl(url), env).includes(`[Download full package audit (JSON)](${url})`))
  assert.doesNotMatch(
    summary(withUrl('javascript:alert(1)'), env),
    /javascript:|Download full package audit \(JSON\)/
  )
})

test('advisory text is escaped and unsafe links are not rendered', () => {
  const report = {
    advisories: {
      one: {
        module_name: 'bad|name',
        severity: 'high',
        title: '<script>bad</script>',
        url: 'javascript:alert(1)',
      },
    },
  }
  const text = packageDetails(report).join('\n')
  assert.match(text, /bad&#124;name/)
  assert.doesNotMatch(text, /<script>|javascript:/)
  assert.match(text, /No advisory link available/)
})

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
  const report = summary(
    {
      packages: { result: 'failure' },
      checks: { result: 'failure', outputs: { tests: 'skipped' } },
      release: { result: 'skipped' },
    },
    { ...env, COMMIT_MESSAGE: 'v2.1.1 Release' }
  )
  assert.match(report, /counts unavailable/)
  assert.match(report, /\| Tests \| ⏭ Skipped/)
  assert.match(report, /Skipped · checks did not pass/)
})

test('successful release reports link to the build artifact', () => {
  const url = 'https://github.com/0xmthan/Ryksu/actions/runs/123/artifacts/456'
  const report = summary(
    {
      ...results,
      packages: { result: 'success' },
      release: { result: 'success', outputs: { 'artifact-url': url } },
    },
    { ...env, COMMIT_MESSAGE: 'v2.1.1 Release' }
  )
  assert.match(report, /All checks passed/)
  assert.ok(report.includes(`[Download macOS release ZIP](${url})`))
})

test('pull requests and cancelled runs retain their actual status', () => {
  const report = summary(
    { ...results, packages: { result: 'cancelled' } },
    { ...env, GITHUB_EVENT_NAME: 'pull_request', COMMIT_MESSAGE: 'v2.1.1 Release' }
  )
  assert.match(report, /Run cancelled/)
  assert.match(report, /Regular commit/)
  assert.doesNotMatch(report, /All checks passed/)
})
