import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { BlockView } from '../src/types'
import type { BlockAtlas } from '../src/utils/blockAtlas'
import { buildBlockMeshes } from '../src/utils/blockMesher'
import { fake } from './fakes'

// A 5×5×5 view: stone at the center with its top open, and a stone block up and to the east of it, sitting
// against the east edge of that top face.
const width = 5
const cells = new Uint8Array(width * width * width)
const cellOf = (x: number, y: number, z: number) => ((y + 2) * width + (z + 2)) * width + (x + 2)
cells[cellOf(0, 0, 0)] = 255
cells[cellOf(1, 1, 0)] = 255
const blocks: BlockView = {
  palette: ['stone'],
  properties: [{}],
  blocks: [0, 0],
  positions: [0, 0, 0, 1, 1, 0],
  // Only the center block's top (bit 0) is open.
  faces: [1, 0],
  origin: { x: 0, y: 64, z: 0 },
  key: 'test',
  roofCutoff: 100,
  radius: 2,
  light: { width, height: width, below: 2, cells },
  environment: 'outside',
}
const atlas = fake<BlockAtlas>({ uv: () => [0, 0], texture: { uuid: 'test' } })

// The top face's brightness at its west (x = 0) and east (x = 1) corners.
const topCorners = (options: { ambientOcclusion?: boolean }) => {
  const { opaque } = buildBlockMeshes(blocks, atlas, 'full', [0], options)
  const position = opaque.getAttribute('position')
  const color = opaque.getAttribute('color')
  const west: number[] = []
  const east: number[] = []
  for (let i = 0; i < position.count; i++) (position.getX(i) > 0.5 ? east : west).push(color.getX(i))
  return { west, east }
}

test('ambient occlusion darkens the corners of a face next to a solid block', () => {
  const { west, east } = topCorners({ ambientOcclusion: true })
  assert.equal(west.length, 2)
  assert.equal(east.length, 2)
  for (const shade of east) assert.ok(shade < west[0] * 0.8, `${shade} should be darker than ${west[0]}`)
  assert.equal(west[0], west[1])
})

test('without ambient occlusion every corner keeps the face shade', () => {
  const { west, east } = topCorners({})
  assert.deepEqual(new Set([...west, ...east]).size, 1)
})

test('water gets its own mesh, apart from glass and ice', () => {
  const water: BlockView = {
    ...blocks,
    palette: ['water', 'ice'],
    properties: [{ level: 0 }, {}],
    blocks: [0, 1],
    positions: [0, 0, 0, 2, 0, 0],
    faces: [1, 1],
  }
  const meshes = buildBlockMeshes(water, atlas, 'full')
  assert.ok(meshes.water.getAttribute('position').count > 0)
  assert.deepEqual(new Set(meshes.waterQuads), new Set([0]))
  assert.deepEqual(new Set(meshes.translucentQuads), new Set([1]))
})
