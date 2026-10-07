// Item frames and the maps in them, for the watcher. Map art is a grid of item frames (often invisible
// ones), each holding a filled map whose 128×128 pixels the server sends in map packets; the frames go
// out with each motion update and the pixels only when the watcher asks for them.
import type { Bot } from 'mineflayer'
import type { Entity } from 'prismarine-entity'
import loadItem, { type Item } from 'prismarine-item'
import * as nbt from 'prismarine-nbt'
import type { ItemFrame, MapPixels } from '../../../shared/types'
import { entityEvents } from './entityEvents'

const MAP_SIZE = 128
const FRAME_RANGE = 80
// Shared flags bit for an invisible entity (a frame that only shows what it holds).
const INVISIBLE = 0x20
const SOUTH = 3

type MapState = { version: number; colors: Uint8Array }

type MapPacket = {
  itemDamage?: number
  columns?: number
  rows?: number
  x?: number
  y?: number
  data?: Uint8Array
}

const maps = new WeakMap<Bot, Map<number, MapState>>()

// Call right after creating the bot, so maps sent while joining aren't missed.
export const attachMapTracking = (bot: Bot) => {
  const known = new Map<number, MapState>()
  maps.set(bot, known)
  bot._client.on('map', (packet: MapPacket) => {
    const id = Number(packet.itemDamage)
    const { columns = 0, rows = 0, x = 0, y = 0, data } = packet
    // No columns: only the map's icons changed.
    if (!Number.isInteger(id) || !columns || !data) return
    let entry = known.get(id)
    if (!entry) {
      entry = { version: 0, colors: new Uint8Array(MAP_SIZE * MAP_SIZE) }
      known.set(id, entry)
    }
    for (let row = 0; row < rows && y + row < MAP_SIZE; row++) {
      for (let column = 0; column < columns && x + column < MAP_SIZE; column++) {
        entry.colors[(y + row) * MAP_SIZE + x + column] = data[row * columns + column] ?? 0
      }
    }
    entry.version++
  })
}

export const mapPixels = (bot: Bot, ids: number[]): MapPixels[] => {
  const known = maps.get(bot)
  if (!known) return []
  return ids.flatMap((id) => {
    const entry = known.get(id)
    return entry ? [{ id, version: entry.version, colors: entry.colors }] : []
  })
}

// Map ids the server has sent pixels for, with their update counts.
export const knownMaps = (bot: Bot) =>
  Object.fromEntries(
    [...(maps.get(bot) ?? new Map<number, MapState>())].map(([id, entry]) => [id, entry.version])
  )

const metadataReader = (bot: Bot, entity: Entity) => {
  const keys = entity.name ? bot.registry.entitiesByName?.[entity.name]?.metadataKeys : undefined
  return (key: string): unknown => {
    const index = Array.isArray(keys) ? keys.indexOf(key) : -1
    return index >= 0 ? entity.metadata?.[index] : undefined
  }
}

type RawItem = Item & { components?: { type?: string; data?: unknown }[] }

// The map id a filled map points to: a map_id component on 1.20.5+, `map` NBT before, its damage
// before 1.13.
const mapIdOf = (item: RawItem) => {
  const component = Array.isArray(item.components)
    ? item.components.find((entry) => entry?.type === 'map_id')
    : null
  if (component) {
    const data = component.data as number | { id?: number; value?: number }
    const id = typeof data === 'number' ? data : (data?.id ?? data?.value)
    return typeof id === 'number' ? id : null
  }
  if (item.nbt) {
    const id = (nbt.simplify(item.nbt) as { map?: unknown }).map
    if (typeof id === 'number') return id
  }
  return typeof item.metadata === 'number' ? item.metadata : null
}

const heldItem = (bot: Bot, slot: unknown): Item | null => {
  if (!slot || typeof slot !== 'object') return null
  try {
    return loadItem(bot.registry).fromNotch(slot as never) ?? null
  } catch {
    return null
  }
}

const describeFrame = (bot: Bot, entity: Entity): ItemFrame | null => {
  const read = metadataReader(bot, entity)
  // 1.21.9+ keep the facing in metadata, left out while it's the default (south); before, only the
  // spawn packet has it.
  const keys = bot.registry.entitiesByName?.[entity.name ?? '']?.metadataKeys
  const facing = Number(
    Array.isArray(keys) && keys.includes('direction')
      ? (read('direction') ?? SOUTH)
      : entityEvents(bot, entity).typed.direction
  )
  if (!Number.isInteger(facing) || facing < 0 || facing > 5) return null
  const frame: ItemFrame = {
    id: entity.id,
    x: entity.position.x,
    y: entity.position.y,
    z: entity.position.z,
    facing,
    rotation: Number(read('rotation')) || 0,
  }
  if (Number(read('shared_flags')) & INVISIBLE) frame.invisible = true
  if (entity.name === 'glow_item_frame') frame.glow = true
  const item = heldItem(bot, read('item'))
  if (item?.name) {
    frame.item = item.name
    const mapId = item.name === 'filled_map' ? mapIdOf(item as RawItem) : null
    if (mapId !== null) frame.map = { id: mapId, version: maps.get(bot)?.get(mapId)?.version ?? 0 }
  }
  return frame
}

export const getItemFrames = (bot: Bot): ItemFrame[] => {
  const position = bot.entity?.position
  if (!position) return []
  const frames: ItemFrame[] = []
  for (const entity of Object.values(bot.entities)) {
    if (!entity?.name?.endsWith('item_frame') || entity.position.distanceTo(position) > FRAME_RANGE) continue
    const frame = describeFrame(bot, entity)
    if (frame) frames.push(frame)
  }
  return frames
}
