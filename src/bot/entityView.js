// Positions and looks of the bot and the things around it, for the 3D watcher. Sent often so it can
// move smoothly, so everything here stays cheap.
const { Vec3 } = require('vec3')
const { entityEvents } = require('./entityEvents')
const { nameForUuid } = require('./playerNames')
const { entityVariant } = require('./entityVariants')
const { skinUrl, capeUrl } = require('./profileTextures')

const ENTITY_RANGE = 80
// mineflayer's entity.equipment order.
const EQUIPMENT_SLOTS = ['mainhand', 'offhand', 'feet', 'legs', 'chest', 'head']
// The bot's own gear lives in its inventory window.
const BOT_SLOTS = { offhand: 45, head: 5, chest: 6, legs: 7, feet: 8 }

const entityKind = (entity) => {
  if (entity.type === 'player') return 'player'
  if (entity.name === 'item') return 'item'
  if (entity.type === 'hostile') return 'hostile'
  if (['mob', 'animal', 'passive', 'water_creature', 'ambient'].includes(entity.type)) return 'passive'
  return null
}

const round = (value) => Math.round(value * 100) / 100

// Where a mob's metadata keeps a given value (it shifts between versions), from minecraft-data.
const metadataReader = (bot, entity) => {
  const keys = bot.registry.entitiesByName?.[entity.name]?.metadataKeys
  return (key) => {
    const index = Array.isArray(keys) ? keys.indexOf(key) : -1
    return index >= 0 ? entity.metadata?.[index] : undefined
  }
}

// Leather armor's dye: a dyed_color component on 1.20.5+, display.color NBT before.
const dyeColor = (item) => {
  const component = Array.isArray(item.components)
    ? item.components.find((entry) => entry?.type === 'dyed_color')
    : null
  const data = component?.data
  const value =
    typeof data === 'number'
      ? data
      : (data?.color ?? data?.rgb ?? item.nbt?.value?.display?.value?.color?.value)
  return typeof value === 'number' ? `#${(value & 0xffffff).toString(16).padStart(6, '0')}` : null
}

const wornItem = (item) => {
  if (!item?.name) return null
  const color = item.name.startsWith('leather_') ? dyeColor(item) : null
  return color ? { name: item.name, color } : { name: item.name }
}

// Held and worn items by slot; empty slots are left out.
const equipmentOf = (items) => {
  const result = {}
  for (const [slot, item] of Object.entries(items)) {
    const worn = wornItem(item)
    if (worn) result[slot] = worn
  }
  return Object.keys(result).length ? result : undefined
}

const entityEquipment = (entity) =>
  equipmentOf(Object.fromEntries(EQUIPMENT_SLOTS.map((slot, index) => [slot, entity.equipment?.[index]])))

const botEquipment = (bot) => {
  const slots = bot.inventory?.slots ?? []
  return equipmentOf({
    mainhand: bot.heldItem,
    ...Object.fromEntries(Object.entries(BOT_SLOTS).map(([slot, index]) => [slot, slots[index]])),
  })
}

// Baby flag, variant, villager outfit and player skin, for drawing the mob the way it looks in game.
const appearance = (bot, entity, kind) => {
  const read = metadataReader(bot, entity)
  const result = entityVariant(bot, entity.name, read, entityEvents(bot, entity).typed)
  if (read('baby') === true) {
    result.baby = true
  }
  const villager = read('villager_data')
  if (villager && typeof villager === 'object') {
    result.villager = { type: villager.villagerType ?? 0, profession: villager.villagerProfession ?? 0 }
  }
  if (kind === 'player') {
    const player = bot.players?.[entity.username]
    const skin = skinUrl(player)
    if (skin) result.skin = skin
    const cape = capeUrl(player, read('player_mode_customisation'))
    if (cape) result.cape = cape
    // Slim ("Alex") skins are drawn for 3-pixel-wide arms.
    if (player?.skinData?.model === 'slim') result.slim = true
  }
  return result
}

// Cats, wolves and parrots told to sit keep it in bit 0 of their tameable flags.
const TAMEABLE = new Set(['cat', 'wolf', 'parrot'])
// Horse-family mobs keep "tamed" in bit 1 of their flags, but no longer say who tamed them.
const HORSES = new Set(['horse', 'donkey', 'mule', 'llama', 'trader_llama', 'skeleton_horse', 'zombie_horse', 'camel'])

const plainUuid = (uuid) => String(uuid).replace(/-/g, '').toLowerCase()

// Tamed or not, and for pets, the owner: named when they're online, remembered, or matched by their
// offline-mode UUID (see playerNames.js), else just their UUID.
const tameness = (bot, entity) => {
  const flags = Number(metadataReader(bot, entity)('flags'))
  if (HORSES.has(entity.name)) return flags & 2 ? { tamed: true } : {}
  if (!TAMEABLE.has(entity.name) || !(flags & 4)) return {}
  const uuid = entityEvents(bot, entity).typed.owner_uuid ?? metadataReader(bot, entity)('owneruuid')
  if (!uuid) return { tamed: true }
  const found = nameForUuid(bot, uuid)
  return { tamed: true, owner: { uuid: plainUuid(uuid), ...(found ?? {}) } }
}

const SLEEPING_POSE = 2
const CROUCHING_POSE = 5
// Yaw that faces each way; a bed's facing points from its foot to its head.
const FACING_YAW = { north: 0, west: Math.PI / 2, south: Math.PI, east: -Math.PI / 2 }

// The game moves sleepers onto the bed's head block at mattress height (the bot's own position isn't
// updated, so it can't be trusted). The bed comes from the sleeping position metadata, else the nearest
// bed's head.
const MATTRESS_Y = 0.6875

const bedHead = (bot, entity) => {
  const saved = entityEvents(bot, entity).typed.sleeping_pos ?? metadataReader(bot, entity)('sleeping_pos')
  const at = (x, y, z) => bot.blockAt(new Vec3(x, y, z))
  if (saved && Number.isFinite(saved.x)) {
    const block = at(saved.x, saved.y, saved.z)
    if (block?.name?.endsWith('_bed')) return block
  }
  const origin = entity.position.floored()
  let nearest = null
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

const sleepingPlace = (bot, entity) => {
  try {
    const bed = bedHead(bot, entity)
    const facing = bed?.getProperties?.().facing
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

const posture = (bot, entity) => {
  const result = {}
  const pose = entityEvents(bot, entity).typed.pose
  const crouching =
    entity === bot.entity
      ? bot.getControlState?.('sneak')
      : entity.crouching || pose === CROUCHING_POSE || pose === 'crouching'
  if (crouching) result.crouching = true
  const sleeping =
    entity === bot.entity ? bot.isSleeping : pose === SLEEPING_POSE || pose === 'sleeping'
  if (sleeping) {
    const place = sleepingPlace(bot, entity)
    for (const key of Object.keys(place)) result[key] = round(place[key])
  }
  if (TAMEABLE.has(entity.name) && Number(metadataReader(bot, entity)('flags')) & 1) result.sitting = true
  return result
}

// Where it is, how it faces and stands, and the swing/hurt counters the watcher animates from.
const pose = (bot, entity, yaw, headYaw) => {
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

const describeEntity = (bot, entity) => {
  const kind = entityKind(entity)
  if (!kind) {
    return null
  }
  let item = null
  if (kind === 'item') {
    try {
      item = entity.getDroppedItem?.()?.name ?? null
    } catch {
      // Metadata not in yet.
    }
  }
  const equipment = kind === 'item' ? undefined : entityEquipment(entity)
  const health = metadataReader(bot, entity)('health')
  const ping = kind === 'player' ? bot.players?.[entity.username]?.ping : undefined
  return {
    id: entity.id,
    kind,
    ...(Number.isFinite(health) ? { health } : {}),
    ...(Number.isFinite(ping) ? { ping } : {}),
    ...(kind === 'player' && bot._trustedPlayers?.has(entity.username?.toLowerCase()) ? { trusted: true } : {}),
    // Mob type (zombie, cow, …) for picking its model, and what a dropped item is.
    type: entity.name ?? null,
    item,
    name: entity.username ?? entity.displayName ?? entity.name ?? kind,
    ...pose(bot, entity, entity.yaw ?? 0, entity.headYaw ?? entity.yaw ?? 0),
    ...(equipment ? { equipment } : {}),
    ...appearance(bot, entity, kind),
    ...tameness(bot, entity),
  }
}

const getMotion = (bot) => {
  if (!bot?.entity) {
    return null
  }
  const position = bot.entity.position
  const entities = []
  for (const entity of Object.values(bot.entities)) {
    if (entity === bot.entity || !entity?.position || entity.position.distanceTo(position) > ENTITY_RANGE) {
      continue
    }
    const described = describeEntity(bot, entity)
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
      slim: bot.player?.skinData?.model === 'slim',
      ...(equipment ? { equipment } : {}),
    },
    entities,
    time: bot.time?.timeOfDay ?? 6000,
  }
}

module.exports = { getMotion }
