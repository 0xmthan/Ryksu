import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseMotd } from '../src/utils/motd'

type Segment = ReturnType<typeof parseMotd>[number]

const pick = (segments: Segment[]) => segments.map(({ text, color, bold }) => [text, color, bold])

test('motd colors reset formatting while §r clears everything', () => {
  assert.deepEqual(pick(parseMotd('§lBold §agreen§r plain')), [
    ['Bold ', null, true],
    ['green', '#55ff55', false],
    [' plain', null, false],
  ])
})

test('motd reads both hex color forms', () => {
  assert.deepEqual(pick(parseMotd('§#12abef A§x§f§f§0§0§0§0B')), [
    [' A', '#12abef', false],
    ['B', '#ff0000', false],
  ])
})
