// The world's blocks as 16×16 chunk meshes instead of one big mesh. Each update, a chunk is rebuilt only
// when its blocks (or the light around them) changed, so breaking or placing a block rebuilds a chunk or
// two instead of the whole view. When the view moves (a new origin or view mode), the new chunks are built
// a few per frame, nearest first, while the old meshes stay up until the new set is complete, so moving
// never stalls a frame or flashes holes. Off-screen chunks are skipped by the GPU (frustum culling).
import * as THREE from 'three'
import type { BlockView } from '../../../../shared/types'
import type { BlockAtlas } from './blockAtlas'
import { buildBlockMeshes, type MeshOptions } from './blockMesher'
import type { ViewMode } from '../viewMode'
import type { Pickable } from '../picking'

type Blocks = BlockView
type Materials = {
  opaque: THREE.Material
  translucent: THREE.Material
  water: THREE.Material
  ghost: THREE.Material
  cap: THREE.Material
}

const CHUNK = 16
// Changed chunks are rebuilt right away when there are this few (a block broken or placed); more than
// that (a big change) are spread over frames like a move.
const IMMEDIATE_CHUNKS = 8
// Time per frame for building queued chunks (ms).
const FRAME_BUDGET_MS = 6

type Chunk = { signature: number; meshes: THREE.Mesh[]; pickable: Pickable[] }

const hashStep = (hash: number, value: number) => Math.imul(hash ^ (value | 0), 16777619)
const hashString = (text: string) => {
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) hash = hashStep(hash, text.charCodeAt(i))
  return hash
}

// Block indices per chunk, and a fingerprint of each chunk's blocks (state, position, visible faces and
// view hints). Light changes are found separately, by comparing with the last payload's light.
const chunksOf = (blocks: Blocks) => {
  const radius = blocks.radius
  const stateSignatures = blocks.palette.map((name, index) =>
    hashString(`${name}${JSON.stringify(blocks.properties?.[index] ?? {})}`)
  )
  const indices = new Map<number, number[]>()
  const signatures = new Map<number, number>()
  const keyOf = (cx: number, cz: number) => cx * 4096 + cz
  for (let i = 0; i < blocks.blocks.length; i++) {
    const x = blocks.positions[i * 3]
    const y = blocks.positions[i * 3 + 1]
    const z = blocks.positions[i * 3 + 2]
    const key = keyOf(Math.floor((x + radius) / CHUNK), Math.floor((z + radius) / CHUNK))
    let list = indices.get(key)
    if (!list) indices.set(key, (list = []))
    list.push(i)
    let hash = signatures.get(key) ?? 2166136261
    hash = hashStep(hashStep(hashStep(hash, x), y), z)
    hash = hashStep(hashStep(hash, stateSignatures[blocks.blocks[i]]), blocks.faces[i])
    signatures.set(key, hash)
  }
  return { indices, signatures, center: Math.floor(radius / CHUNK) }
}

// Chunks whose smooth lighting changed: cells whose light differs, plus the cells around them (a face
// samples the light of the cells next to it).
const lightChanges = (before: Uint8Array, after: Uint8Array, width: number) => {
  const keys = new Set<number>()
  if (before.length !== after.length) return null
  for (let i = 0; i < after.length; i++) {
    if (before[i] === after[i]) continue
    const x = i % width
    const z = Math.floor(i / width) % width
    for (const dx of [-1, 0, 1]) {
      for (const dz of [-1, 0, 1]) {
        keys.add(Math.floor((x + dx) / CHUNK) * 4096 + Math.floor((z + dz) / CHUNK))
      }
    }
  }
  return keys
}

export const createChunkMeshes = (
  scene: THREE.Scene,
  materials: Materials,
  initialOptions: MeshOptions = {}
) => {
  let options = { ...initialOptions }
  // What the current meshes were built for; a change of any of these builds a new set.
  let context = ''
  let group: THREE.Group | null = null
  let chunks = new Map<number, Chunk>()
  // While a new set is being built: the old set, still shown, and the chunks still to build.
  let previous: { group: THREE.Group; chunks: Map<number, Chunk> } | null = null
  let queue: { key: number; indices: number[]; signature: number }[] = []
  let latest: { blocks: Blocks; atlas: BlockAtlas; mode: ViewMode; offset: THREE.Vector3 } | null = null
  let pickable: Pickable[] = []
  let lastLight: Uint8Array | null = null

  const disposeChunk = (chunk: Chunk) => {
    for (const mesh of chunk.meshes) {
      mesh.geometry.dispose()
      mesh.removeFromParent()
    }
  }
  const refreshPickable = () => {
    const shown = previous ? previous.chunks : chunks
    pickable = [...shown.values()].flatMap((chunk) => chunk.pickable)
  }

  const buildChunk = (key: number, indices: number[], signature: number) => {
    const { blocks, atlas, mode } = latest!
    const meshes = buildBlockMeshes(blocks, atlas, mode, indices, options)
    const chunk: Chunk = { signature, meshes: [], pickable: [] }
    const add = (
      geometry: THREE.BufferGeometry,
      material: THREE.Material,
      setup: (mesh: THREE.Mesh) => void,
      quads?: number[]
    ) => {
      if (!geometry.getAttribute('position')?.count) {
        geometry.dispose()
        return
      }
      const mesh = new THREE.Mesh(geometry, material)
      setup(mesh)
      group!.add(mesh)
      chunk.meshes.push(mesh)
      if (quads) chunk.pickable.push({ mesh, quads, blocks })
    }
    add(
      meshes.opaque,
      materials.opaque,
      (mesh) => {
        mesh.castShadow = true
        mesh.receiveShadow = true
      },
      meshes.opaqueQuads
    )
    // Water draws after the solid blocks so they show through it.
    add(
      meshes.translucent,
      materials.translucent,
      (mesh) => {
        mesh.renderOrder = 1
        mesh.receiveShadow = true
      },
      meshes.translucentQuads
    )
    add(
      meshes.water,
      materials.water,
      (mesh) => {
        mesh.renderOrder = 1
        mesh.receiveShadow = true
      },
      meshes.waterQuads
    )
    add(meshes.ghost, materials.ghost, (mesh) => {
      mesh.renderOrder = 2
    })
    add(
      meshes.caps,
      materials.cap,
      (mesh) => {
        mesh.receiveShadow = true
      },
      meshes.capQuads
    )
    const old = chunks.get(key)
    if (old) disposeChunk(old)
    chunks.set(key, chunk)
  }

  // Swaps the finished new set in for the old one.
  const finishMove = () => {
    if (!previous || queue.length) return
    for (const chunk of previous.chunks.values()) disposeChunk(chunk)
    previous.group.removeFromParent()
    previous = null
  }

  // A new payload from the bot. `offset` places the payload's origin in the scene.
  const update = (blocks: Blocks, atlas: BlockAtlas, mode: ViewMode, offset: THREE.Vector3) => {
    latest = { blocks, atlas, mode, offset: offset.clone() }
    const { indices, signatures, center } = chunksOf(blocks)
    const nextContext = `${blocks.origin.x},${blocks.origin.y},${blocks.origin.z}|${mode}|${offset.x},${offset.y},${offset.z}|${atlas.texture.uuid}`
    const moved = nextContext !== context
    context = nextContext
    const relit = moved || !lastLight ? null : lightChanges(lastLight, blocks.light.cells, blocks.light.width)
    lastLight = blocks.light.cells
    const byDistance = (a: { key: number }, b: { key: number }) => {
      const distance = (key: number) => {
        const cx = Math.floor(key / 4096)
        return Math.abs(cx - center) + Math.abs(key - cx * 4096 - center)
      }
      return distance(a.key) - distance(b.key)
    }

    if (moved) {
      // Keep showing what's there (if anything finished) until the new set is built.
      if (group) {
        if (previous) {
          // A move while another was still building: drop the half-built set.
          for (const chunk of chunks.values()) disposeChunk(chunk)
          group.removeFromParent()
        } else {
          previous = { group, chunks }
        }
      }
      group = new THREE.Group()
      group.position.copy(offset)
      scene.add(group)
      chunks = new Map()
      queue = [...indices].map(([key, list]) => ({ key, indices: list, signature: signatures.get(key)! }))
      queue.sort(byDistance)
      refreshPickable()
      return
    }

    // Same place: drop chunks that emptied, and rebuild the ones whose fingerprint changed.
    for (const [key, chunk] of chunks) {
      if (!indices.has(key)) {
        disposeChunk(chunk)
        chunks.delete(key)
      }
    }
    // Chunks still waiting are built from this payload instead.
    const entryFor = (key: number) => ({ key, indices: indices.get(key)!, signature: signatures.get(key)! })
    queue = queue.filter((entry) => indices.has(entry.key)).map((entry) => entryFor(entry.key))
    const waiting = new Set(queue.map((entry) => entry.key))
    // Chunks whose own blocks changed are rebuilt now, so a broken or placed block shows this frame;
    // chunks only relit (a torch's light reaching them) follow over the next frames.
    const changed: ReturnType<typeof entryFor>[] = []
    const relitOnly: ReturnType<typeof entryFor>[] = []
    for (const key of indices.keys()) {
      if (waiting.has(key)) continue
      if (chunks.get(key)?.signature !== signatures.get(key)) changed.push(entryFor(key))
      else if (relit === null || relit.has(key)) relitOnly.push(entryFor(key))
    }
    if (!previous && changed.length <= IMMEDIATE_CHUNKS) {
      for (const entry of changed) buildChunk(entry.key, entry.indices, entry.signature)
    } else {
      queue.push(...changed)
    }
    queue.push(...relitOnly)
    queue.sort(byDistance)
    refreshPickable()
  }

  return {
    update,
    // Mesh options (ambient occlusion) changed: every chunk is rebuilt, like a move, so the old look stays
    // up until the new one is ready.
    setOptions: (next: MeshOptions) => {
      if (next.ambientOcclusion === options.ambientOcclusion) return
      options = { ...next }
      if (!latest) return
      context = ''
      update(latest.blocks, latest.atlas, latest.mode, latest.offset)
    },
    // Each frame: builds queued chunks within the frame budget.
    tick: () => {
      if (!queue.length || !latest) return
      const start = performance.now()
      while (queue.length && performance.now() - start < FRAME_BUDGET_MS) {
        const entry = queue.shift()!
        buildChunk(entry.key, entry.indices, entry.signature)
      }
      finishMove()
      refreshPickable()
    },
    pickable: () => pickable,
    dispose: () => {
      for (const chunk of chunks.values()) disposeChunk(chunk)
      if (previous) for (const chunk of previous.chunks.values()) disposeChunk(chunk)
      group?.removeFromParent()
      previous?.group.removeFromParent()
      chunks.clear()
      queue = []
      previous = null
      group = null
      latest = null
      lastLight = null
    },
  }
}
