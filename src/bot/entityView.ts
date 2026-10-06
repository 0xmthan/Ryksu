// Positions and looks of the bot and the things around it, for the 3D watcher. Sent often so it can
// move smoothly, so everything here stays cheap.
import type { Bot } from 'mineflayer'
import type { Block } from 'prismarine-block'
import type { Entity } from 'prismarine-entity'
import type { Item } from 'prismarine-item'
import { Vec3 } from 'vec3'
import type { EntityKind, EntityPose, EquipmentSlot, Motion, MotionEntity, WornItem } from '../types'
import { entityEvents } from './entityEvents'
import { entityVariant } from './entityVariants'
import { nameForUuid } from './playerNames'
import { skinUrl, capeUrl } from './profileTextures'

type Equipment = Partial<Record<EquipmentSlot, WornItem>>
type Appearance = Pick<MotionEntity, 'variant' | 'markings' | 'wool' | 'shearedColor' | 'baby' | 'villager' | 'skin' | 'cape' | 'slim'>
type Posture = Partial<Pick<EntityPose, 'crouching' | 'sitting' | 'sleeping' | 'x' | 'y' | 'z'>>

const ENTITY_RANGE = 80
// mineflayer's entity.equipment order.
const EQUIPMENT_SLOTS: EquipmentSlot[] = ['mainhand', 'offhand', 'feet', 'legs', 'chest', 'head']
// The bot's own gear lives in its inventory window.
const BOT_SLOTS = { offhand: 45, head: 5, chest: 6, legs: 7, feet: 8 }

const entityKind = (entity: Entity): EntityKind | null => {
  if (entity.type === 'player') return 'player'
  if (entity.name === 'item') return 'item'
  if (entity.type === 'hostile') return 'hostile'
  if (['mob', 'animal', 'passive', 'water_creature', 'ambient'].includes(entity.type as string)) return 'passive'
  return null
}

const round = (value: number) => Math.round(value * 100) / 100

// Where a mob's metadata keeps a given value (it shifts between versions), from minecraft-data.
const metadataReader = (bot: Bot, entity: Entity) => {
  const keys = entity.name ? bot.registry.entitiesByName?.[entity.name]?.metadataKeys : undefined
  return (key: string): unknown => {
    const index = Array.isArray(keys) ? keys.indexOf(key) : -1
    return index >= 0 ? entity.metadata?.[index] : undefined
  }
}

// Leather armor's dye: a dyed_color component on 1.20.5+, display.color NBT before.
// Item components (1.20.5+) and raw NBT, which prismarine-item's typings leave loose.
type RawItem = Item & {
  components?: { type?: string; data?: unknown }[]
  nbt?: { value?: { display?: { value?: { color?: { value?: unknown } } } } } | null
}

const dyeColor = (item: RawItem) => {
  const component = Array.isArray(item.components)
    ? item.components.find((entry) => entry?.type === 'dyed_color')
    : null
  const data = component?.data as number | { color?: number; rgb?: number } | undefined
  const value =
    typeof data === 'number'
      ? data
      : (data?.color ?? data?.rgb ?? item.nbt?.value?.display?.value?.color?.value)
  return typeof value === 'number' ? `#${(value & 0xffffff).toString(16).padStart(6, '0')}` : null
}

const wornItem = (item: Item | null | undefined): WornItem | null => {
  if (!item?.name) return null
  const color = item.name.startsWith('leather_') ? dyeColor(item as RawItem) : null
  return color ? { name: item.name, color } : { name: item.name }
}

// Held and worn items by slot; empty slots are left out.
const equipmentOf = (items: Partial<Record<EquipmentSlot, Item | null | undefined>>) => {
  const result: Equipment = {}
  for (const [slot, item] of Object.entries(items)) {
    const worn = wornItem(item)
    if (worn) result[slot as EquipmentSlot] = worn
  }
  return Object.keys(result).length ? result : undefined
}

const entityEquipment = (entity: Entity) =>
  equipmentOf(Object.fromEntries(EQUIPMENT_SLOTS.map((slot, index) => [slot, entity.equipment?.[index]])))

const botEquipment = (bot: Bot) => {
  const slots = bot.inventory?.slots ?? []
  return equipmentOf({
    mainhand: bot.heldItem,
    ...Object.fromEntries(Object.entries(BOT_SLOTS).map(([slot, index]) => [slot, slots[index]])),
  })
}

// Baby flag, variant, villager outfit and player skin, for drawing the mob the way it looks in game.
const appearance = (bot: Bot, entity: Entity, kind: EntityKind) => {
  const read = metadataReader(bot, entity)
  const result: Appearance = entityVariant(bot, entity.name ?? '', read, entityEvents(bot, entity).typed)
  if (read('baby') === true) {
    result.baby = true
  }
  const villager = read('villager_data')
  if (villager && typeof villager === 'object') {
    const data = villager as { villagerType?: number; villagerProfession?: number }
    result.villager = { type: data.villagerType ?? 0, profession: data.villagerProfession ?? 0 }
  }
  if (kind === 'player') {
    const player = entity.username ? bot.players?.[entity.username] : undefined
    const skin = skinUrl(player)
    if (skin) result.skin = skin
    const cape = capeUrl(player, read('player_mode_customisation'))
    if (cape) result.cape = cape
    // Slim ("Alex") skins are drawn for 3-pixel-wide arms.
    if ((player?.skinData as { model?: string } | undefined)?.model === 'slim') result.slim = true
  }
  return result
}

// Cats, wolves and parrots told to sit keep it in bit 0 of their tameable flags.
const TAMEABLE = new Set(['cat', 'wolf', 'parrot'])
// Horse-family mobs keep "tamed" in bit 1 of their flags, but no longer say who tamed them.
const HORSES = new Set(['horse', 'donkey', 'mule', 'llama', 'trader_llama', 'skeleton_horse', 'zombie_horse', 'camel'])

const plainUuid = (uuid: unknown) => String(uuid).replace(/-/g, '').toLowerCase()

// Tamed or not, and for pets, the owner: named when they're online, remembered, or matched by their
// offline-mode UUID (see playerNames.js), else just their UUID.
const tameness = (bot: Bot, entity: Entity): Pick<MotionEntity, 'tamed' | 'owner'> => {
  const flags = Number(metadataReader(bot, entity)('flags'))
  if (HORSES.has(entity.name ?? '')) return flags & 2 ? { tamed: true } : {}
  if (!TAMEABLE.has(entity.name ?? '') || !(flags & 4)) return {}
  const uuid = entityEvents(bot, entity).typed.owner_uuid ?? metadataReader(bot, entity)('owneruuid')
  if (!uuid) return { tamed: true }
  const found = nameForUuid(bot, String(uuid))
  return { tamed: true, owner: { uuid: plainUuid(uuid), ...(found ?? {}) } }
}

const SLEEPING_POSE = 2
const CROUCHING_POSE = 5
// Yaw that faces each way; a bed's facing points from its foot to its head.
const FACING_YAW: Record<string, number> = { north: 0, west: Math.PI / 2, south: Math.PI, east: -Math.PI / 2 }

// The game moves sleepers onto the bed's head block at mattress height (the bot's own position isn't
// updated, so it can't be trusted). The bed comes from the sleeping position metadata, else the nearest
// bed's head.
const MATTRESS_Y = 0.6875

const bedHead = (bot: Bot, entity: Entity): Block | null => {
  const saved = (entityEvents(bot, entity).typed.sleeping_pos ?? metadataReader(bot, entity)('sleeping_pos')) as
    | { x: number; y: number; z: number }
    | null
    | undefined
  const at = (x: number, y: number, z: number) => bot.blockAt(new Vec3(x, y, z))
  if (saved && Number.isFinite(saved.x)) {
    const block = at(saved.x, saved.y, saved.z)
    if (block?.name?.endsWith('_bed')) return block
  }
  const origin = entity.position.floored()
  let nearest: { block: Block; distance: number } | null = null
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -2; dz <= 2; dz++) {
        const block = at(origin.x + dx, origin.y + dy, origin.z + dz)
        if (!block?.name?.endsWith('_bed') || block.getProperties?.().part !== 'head') continue
        const distance = block.position.offset(0.5, 0.5, 0.5).distanceTo(entity.position)
        if (!nearest || distance < nearest.distance) nearest = { block, distance }
      }
    }
  }
  return nearest?.block ?? null
}

const sleepingPlace = (bot: Bot, entity: Entity): Posture => {
  try {
    const bed = bedHead(bot, entity)
    const facing = String(bed?.getProperties?.().facing)
    if (bed && facing in FACING_YAW) {
      return {
        x: bed.position.x + 0.5,
        y: bed.position.y + MATTRESS_Y,
        z: bed.position.z + 0.5,
        sleeping: FACING_YAW[facing],
      }
    }
  } catch {
    // Chunk not loaded.
  }
  return { sleeping: entity.yaw ?? 0 }
}

const posture = (bot: Bot, entity: Entity) => {
  const result: Posture = {}
  const pose = entityEvents(bot, entity).typed.pose
  const crouching =
    entity === bot.entity
      ? bot.getControlState?.('sneak')
      : (entity as Entity & { crouching?: boolean }).crouching || pose === CROUCHING_POSE || pose === 'crouching'
  if (crouching) result.crouching = true
  const sleeping =
    entity === bot.entity ? bot.isSleeping : pose === SLEEPING_POSE || pose === 'sleeping'
  if (sleeping) {
    const place = sleepingPlace(bot, entity)
    for (const key of ['x', 'y', 'z', 'sleeping'] as const) {
      const value = place[key]
      if (value !== undefined) result[key] = round(value)
    }
  }
  if (TAMEABLE.has(entity.name ?? '') && Number(metadataReader(bot, entity)('flags')) & 1) result.sitting = true
  return result
}

// Where it is, how it faces and stands, and the swing/hurt counters the watcher animates from.
const pose = (bot: Bot, entity: Entity, yaw: number, headYaw: number): EntityPose => {
  const events = entityEvents(bot, entity)
  return {
    x: round(entity.position.x),
    y: round(entity.position.y),
    z: round(entity.position.z),
    yaw: round(yaw),
    headYaw: round(headYaw),
    pitch: round(entity.pitch ?? 0),
    swing: events.swing,
    hurt: events.hurt,
    ...(events.dead ? { dead: true } : {}),
    // Last, so a sleeper's place on the bed wins over where it stood.
    ...posture(bot, entity),
  }
}

const describeEntity = (bot: Bot, entity: Entity, trustedPlayers: ReadonlySet<string>): MotionEntity | null => {
  const kind = entityKind(entity)
  if (!kind) {
    return null
  }
  let item: string | null = null
  if (kind === 'item') {
    try {
      item = entity.getDroppedItem?.()?.name ?? null
    } catch {
      // Metadata not in yet.
    }
  }
  const equipment = kind === 'item' ? undefined : entityEquipment(entity)
  const health = metadataReader(bot, entity)('health')
  const ping = kind === 'player' && entity.username ? bot.players?.[entity.username]?.ping : undefined
  return {
    id: entity.id,
    kind,
    ...(typeof health === 'number' && Number.isFinite(health) ? { health } : {}),
    ...(typeof ping === 'number' && Number.isFinite(ping) ? { ping } : {}),
    ...(kind === 'player' && trustedPlayers.has(entity.username?.toLowerCase() ?? '') ? { trusted: true } : {}),
    // Mob type (zombie, cow, …) for picking its model, and what a dropped item is.
    type: entity.name ?? null,
    item,
    name: entity.username ?? entity.displayName ?? entity.name ?? kind,
    ...pose(bot, entity, entity.yaw ?? 0, (entity as Entity & { headYaw?: number }).headYaw ?? entity.yaw ?? 0),
    ...(equipment ? { equipment } : {}),
    ...appearance(bot, entity, kind),
    ...tameness(bot, entity),
  }
}

// `trustedPlayers`: lowercase names badged on their nametags.
export const getMotion = (bot: Bot | null, trustedPlayers: ReadonlySet<string> = new Set()): Motion | null => {
  if (!bot?.entity) {
    return null
  }
  const position = bot.entity.position
  const entities: MotionEntity[] = []
  for (const entity of Object.values(bot.entities)) {
    if (entity === bot.entity || !entity?.position || entity.position.distanceTo(position) > ENTITY_RANGE) {
      continue
    }
    const described = describeEntity(bot, entity, trustedPlayers)
    if (described) entities.push(described)
  }
  const equipment = botEquipment(bot)
  return {
    bot: {
      // The bot looks where it faces.
      ...pose(bot, bot.entity, bot.entity.yaw, bot.entity.yaw),
      name: bot.username ?? bot.player?.username ?? 'Bot',
      ...(Number.isFinite(bot.health) ? { health: bot.health } : {}),
      // Still on its way somewhere (a click, a door, following), for the walk marker.
      walking: Boolean(bot.pathfinder?.goal),
      skin: skinUrl(bot.player),
      cape: capeUrl(bot.player, metadataReader(bot, bot.entity)('player_mode_customisation')),
      slim: (bot.player?.skinData as { model?: string } | undefined)?.model === 'slim',
      ...(equipment ? { equipment } : {}),
    },
    entities,
    time: bot.time?.timeOfDay ?? 6000,
  }
}
