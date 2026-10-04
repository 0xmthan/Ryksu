const assert = require('node:assert/strict')
const test = require('node:test')
const braces = require('braces')

test('braces preserves ordinary glob compilation and expansion', () => {
  assert.equal(braces.compile('src/{main,renderer}/*.{js,ts}'), 'src/(main|renderer)/*.(js|ts)')
  assert.deepEqual(braces.expand('file-{1..3}.js'), ['file-1.js', 'file-2.js', 'file-3.js'])
})

test('braces rejects excessive AST nesting before recursive walkers run', () => {
  const patterns = [
    '{'.repeat(4000) + 'a,b' + '}'.repeat(4000),
    '('.repeat(4000) + 'x' + ')'.repeat(4000),
    '{('.repeat(51) + 'a,b' + ')}'.repeat(51),
    '{'.repeat(101) + 'x',
  ]
  for (const pattern of patterns) {
    for (const method of [braces, braces.parse, braces.compile, braces.expand, braces.stringify]) {
      assert.throws(() => method(pattern), {
        name: 'SyntaxError',
        message: 'Input exceeds maximum nesting depth (100)',
      })
    }
  }
})

test('braces accepts the depth limit and ignores escaped or quoted braces', () => {
  assert.doesNotThrow(() => braces.compile('{'.repeat(100) + 'x' + '}'.repeat(100)))
  assert.doesNotThrow(() => braces.compile('\\{'.repeat(200)))
  assert.doesNotThrow(() => braces.compile('"' + '{'.repeat(200) + '"'))
  assert.doesNotThrow(() => braces.compile('{a,b}'.repeat(200)))
})
