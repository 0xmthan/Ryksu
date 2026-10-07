// Item frames in the watcher, with what they hold: maps drawn from their pixels (so map art walls show
// as the picture), other items as their icon. Invisible frames show only their contents, like the game.
import * as THREE from 'three'
import type { ItemFrame, MapPixels } from '../../../../shared/types'
import { buildItemMesh } from './itemMesh'
import { disposeObject } from '../sceneUtils'

const MAP_SIZE = 128

// The game's map base colors by id (id 0 is see-through); each pixel is base × 4 + shade.
// prettier-ignore
const BASE_COLORS = [
  0x000000, 0x7fb238, 0xf7e9a3, 0xc7c7c7, 0xff0000, 0xa0a0ff, 0xa7a7a7, 0x007c00, 0xffffff, 0xa4a8b8,
  0x976d4d, 0x707070, 0x4040ff, 0x8f7748, 0xfffcf5, 0xd87f33, 0xb24cd8, 0x6699d8, 0xe5e533, 0x7fcc19,
  0xf27fa5, 0x4c4c4c, 0x999999, 0x4c7f99, 0x7f3fb2, 0x334cb2, 0x664c33, 0x667f33, 0x993333, 0x191919,
  0xfaee4d, 0x5cdbd5, 0x4a80ff, 0x00d93a, 0x815631, 0x700200, 0xd1b1a1, 0x9f5224, 0x95576c, 0x706c8a,
  0xba8524, 0x677535, 0xa04d4e, 0x392923, 0x876b62, 0x575c5c, 0x7a4958, 0x4c3e5c, 0x4c3223, 0x4c522a,
  0x8e3c2e, 0x251610, 0xbd3031, 0x943f61, 0x5c191d, 0x167e86, 0x3a8e8c, 0x562c3e, 0x14b485, 0x646464,
  0xd8af93, 0x7fa796,
]
const SHADES = [180, 220, 255, 135]

// RGBA for every color id.
const PALETTE = (() => {
  const palette = new Uint8Array(256 * 4)
  for (let id = 4; id < 256; id++) {
    const base = BASE_COLORS[id >> 2]
    if (base === undefined) continue
    const shade = SHADES[id & 3]
    palette[id * 4] = (((base >> 16) & 0xff) * shade) / 255
    palette[id * 4 + 1] = (((base >> 8) & 0xff) * shade) / 255
    palette[id * 4 + 2] = ((base & 0xff) * shade) / 255
    palette[id * 4 + 3] = 255
  }
  return palette
})()

// Turns that point the frame's local +z out of the wall, by facing (down, up, north, south, west, east).
const FACING_ROTATIONS: [number, number][] = [
  [Math.PI / 2, 0],
  [-Math.PI / 2, 0],
  [0, Math.PI],
  [0, 0],
  [0, -Math.PI / 2],
  [0, Math.PI / 2],
]

// The frame entity sits in the middle of its 1/16-deep board, so the wall is half that behind it.
const WALL = -1 / 32
const BOARD_DEPTH = 1 / 16
const ITEM_SIZE = 0.5

const boardMaterials = {
  plain: new THREE.MeshLambertMaterial({ color: '#8a5d34' }),
  glow: new THREE.MeshLambertMaterial({ color: '#5c8f86' }),
}
const smallBoard = new THREE.BoxGeometry(0.75, 0.75, BOARD_DEPTH)
const mapBoard = new THREE.BoxGeometry(1, 1, BOARD_DEPTH)
const mapPlane = new THREE.PlaneGeometry(1, 1)

type MapTexture = { version: number; texture: THREE.DataTexture; material: THREE.MeshBasicMaterial }
type Shown = { object: THREE.Group; look: string }

const lookOf = (frame: ItemFrame) =>
  [frame.facing, frame.rotation, frame.invisible, frame.glow, frame.item, frame.map?.id].join()

export const createItemFrames = (scene: THREE.Scene) => {
  // Frames are placed by world position; the group takes the anchor off.
  const group = new THREE.Group()
  scene.add(group)
  const shown = new Map<number, Shown>()
  const textures = new Map<number, MapTexture>()
  const fetching = new Set<number>()
  let disposed = false

  const mapTexture = (id: number) => {
    let entry = textures.get(id)
    if (!entry) {
      const texture = new THREE.DataTexture(new Uint8Array(MAP_SIZE * MAP_SIZE * 4), MAP_SIZE, MAP_SIZE)
      texture.colorSpace = THREE.SRGBColorSpace
      texture.magFilter = THREE.NearestFilter
      texture.minFilter = THREE.NearestMipmapLinearFilter
      texture.generateMipmaps = true
      const material = new THREE.MeshBasicMaterial({ map: texture, alphaTest: 0.5 })
      // Version 0 is a map the server hasn't sent pixels for yet.
      entry = { version: 0, texture, material }
      textures.set(id, entry)
    }
    return entry
  }

  const paint = (pixels: MapPixels) => {
    const entry = textures.get(pixels.id)
    if (!entry || pixels.version <= entry.version) return
    const data = entry.texture.image.data as Uint8Array
    for (let y = 0; y < MAP_SIZE; y++) {
      // Texture rows run bottom up; map rows top down.
      const row = (MAP_SIZE - 1 - y) * MAP_SIZE
      for (let x = 0; x < MAP_SIZE; x++) {
        const color = pixels.colors[y * MAP_SIZE + x] * 4
        data.set(PALETTE.subarray(color, color + 4), (row + x) * 4)
      }
    }
    entry.texture.needsUpdate = true
    entry.version = pixels.version
  }

  const fetchMaps = (ids: number[]) => {
    for (const id of ids) fetching.add(id)
    window.electronAPI.bot
      .getMaps(ids)
      .then((list) => {
        if (!disposed) for (const pixels of list) paint(pixels)
      })
      .catch(() => {})
      .finally(() => {
        for (const id of ids) fetching.delete(id)
      })
  }

  const build = (frame: ItemFrame) => {
    const object = new THREE.Group()
    const [pitch, yaw] = FACING_ROTATIONS[frame.facing]
    object.rotation.set(pitch, yaw, 0, 'YXZ')
    const material = frame.glow ? boardMaterials.glow : boardMaterials.plain
    if (!frame.invisible) {
      const board = new THREE.Mesh(frame.map ? mapBoard : smallBoard, material)
      board.userData.sharedGeometry = true
      object.add(board)
    }
    // In front of the board, or flat on the wall when there's no board.
    const front = frame.invisible ? WALL + 0.002 : WALL + BOARD_DEPTH + 0.002
    if (frame.map) {
      const plane = new THREE.Mesh(mapPlane, mapTexture(frame.map.id).material)
      plane.userData.sharedGeometry = true
      // Maps turn in quarter turns, clockwise as you face them.
      plane.rotation.z = -((frame.rotation % 4) * Math.PI) / 2
      plane.position.z = front
      object.add(plane)
    } else if (frame.item) {
      const item = buildItemMesh(frame.item)
      if (item) {
        item.object.scale.set(ITEM_SIZE, ITEM_SIZE, item.block ? ITEM_SIZE : ITEM_SIZE / 2)
        item.object.rotation.z = -(frame.rotation * Math.PI) / 4
        item.object.position.z = front + (item.block ? ITEM_SIZE / 2 : 0.02)
        object.add(item.object)
      }
    }
    object.position.set(frame.x, frame.y, frame.z)
    return object
  }

  // Frees a frame's meshes but not the shared board, plane and map materials.
  const remove = (object: THREE.Group) => {
    object.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (mesh.material === boardMaterials.plain || mesh.material === boardMaterials.glow) mesh.material = []
      else if ([...textures.values()].some((entry) => entry.material === mesh.material)) mesh.material = []
    })
    disposeObject(object)
  }

  return {
    update(frames: ItemFrame[], anchor: THREE.Vector3) {
      group.position.copy(anchor).negate()
      const seen = new Set<number>()
      const stale: number[] = []
      for (const frame of frames) {
        seen.add(frame.id)
        const look = lookOf(frame)
        let entry = shown.get(frame.id)
        if (entry?.look !== look) {
          if (entry) remove(entry.object)
          entry = { object: build(frame), look }
          group.add(entry.object)
          shown.set(frame.id, entry)
        } else {
          entry.object.position.set(frame.x, frame.y, frame.z)
        }
        if (
          frame.map &&
          !fetching.has(frame.map.id) &&
          mapTexture(frame.map.id).version < frame.map.version
        ) {
          if (!stale.includes(frame.map.id)) stale.push(frame.map.id)
        }
      }
      for (const [id, entry] of shown) {
        if (seen.has(id)) continue
        remove(entry.object)
        shown.delete(id)
      }
      if (stale.length) fetchMaps(stale)
      // Maps no frame shows anymore.
      const used = new Set(frames.flatMap((frame) => (frame.map ? [frame.map.id] : [])))
      for (const [id, entry] of textures) {
        if (used.has(id) || fetching.has(id)) continue
        entry.texture.dispose()
        entry.material.dispose()
        textures.delete(id)
      }
    },
    dispose() {
      disposed = true
      for (const entry of shown.values()) remove(entry.object)
      shown.clear()
      for (const entry of textures.values()) {
        entry.texture.dispose()
        entry.material.dispose()
      }
      textures.clear()
      group.removeFromParent()
    },
  }
}
