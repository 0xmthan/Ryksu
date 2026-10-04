const test = require('node:test')
const assert = require('node:assert/strict')
const { releaseVersion } = require('../scripts/ci/release-version.cjs')

test('a version at the start of the subject requests a release', () => {
  assert.equal(releaseVersion('v2.1.1 Release'), '2.1.1')
  assert.equal(releaseVersion('v2.2.0-beta.1 Preview\n\nDetails'), '2.2.0-beta.1')
  assert.equal(releaseVersion('v2.1.1'), '2.1.1')
})

test('regular messages and malformed version prefixes skip release builds', () => {
  for (const message of [undefined, '', 'Fix inventory', 'vendor plugins',
    'Update v2.1.1', 'Fix\n\nv2.1.1', 'v2.1', 'v02.1.1 Release',
    'v2.1.1oops', 'v2.1.1-beta.01 Preview', 'v2.1.1; echo hello']) {
    assert.equal(releaseVersion(message), '', String(message))
  }
})
