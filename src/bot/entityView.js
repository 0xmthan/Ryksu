// Positions and looks of the bot and the things around it, for the 3D watcher. Sent often so it can
// move smoothly, so everything here stays cheap.
const { entityEvents } = require('./entityEvents')
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
const CROUCHING_POSE = 5

const posture = (bot, entity) => {
  const result = {}
  const pose = entityEvents(bot, entity).typed.pose
  const crouching =
    entity === bot.entity
      ? bot.getControlState?.('sneak')
      : entity.crouching || pose === CROUCHING_POSE || pose === 'crouching'
  if (crouching) result.crouching = true
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
    // Mob type (zombie, cow, …) for picking its model, and what a dropped item is.
    type: entity.name ?? null,
    item,
    name: entity.username ?? entity.displayName ?? entity.name ?? kind,
    ...pose(bot, entity, entity.yaw ?? 0, entity.headYaw ?? entity.yaw ?? 0),
    ...(equipment ? { equipment } : {}),
    ...appearance(bot, entity, kind),
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
