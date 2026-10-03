// Things about entities that only show up as one-off packets, kept so the watcher can pick them up on its
// next motion update: arm swings, hurts and deaths (as counters it can compare), and the order of the
// registries the server sends while joining (mob variants are ids into them). Variant and pose values are
// also kept by their metadata type, which stays right even where minecraft-data's key list is off.
const state = new WeakMap()

const stateFor = (bot) => {
  let entry = state.get(bot)
  if (!entry) {
    entry = { registries: {}, events: new WeakMap() }
    state.set(bot, entry)
  }
  return entry
}

const eventsFor = (bot, entity) => {
  const { events } = stateFor(bot)
  let entry = events.get(entity)
  if (!entry) {
    entry = { swing: 0, hurt: 0, dead: false, typed: {} }
    events.set(entity, entry)
  }
  return entry
}

// Call right after creating the bot, before it joins, so the registry packets aren't missed.
const attachEntityTracking = (bot) => {
  const { registries } = stateFor(bot)
  const client = bot._client
  client.on('registry_data', (packet) => {
    // 1.20.5+: one packet per registry, entries in id order.
    if (typeof packet?.id === 'string' && Array.isArray(packet.entries)) {
      registries[packet.id.replace(/^minecraft:/, '')] = packet.entries.map((entry) =>
        String(entry.key).replace(/^minecraft:/, '')
      )
    }
  })

  client.on('entity_metadata', (packet) => {
    const entity = bot.entities?.[packet.entityId]
    if (!entity || !Array.isArray(packet.metadata)) return
    const { typed } = eventsFor(bot, entity)
    for (const entry of packet.metadata) {
      if (
        typeof entry?.type === 'string' &&
        (entry.type === 'pose' || /(?<!sound)_variant$/.test(entry.type))
      ) {
        typed[entry.type] = entry.value
      }
    }
  })

  bot.on('entitySwingArm', (entity) => eventsFor(bot, entity).swing++)
  bot.on('entityHurt', (entity) => eventsFor(bot, entity).hurt++)
  bot.on('entityDead', (entity) => (eventsFor(bot, entity).dead = true))
  bot.on('spawn', () => {
    if (bot.entity) eventsFor(bot, bot.entity).dead = false
  })

  // The server doesn't echo the bot's own swings, so count the ones it sends.
  const write = client.write.bind(client)
  client.write = (name, params) => {
    if (name === 'arm_animation' && bot.entity) eventsFor(bot, bot.entity).swing++
    return write(name, params)
  }
}

const registryOrder = (bot, name) => stateFor(bot).registries[name] ?? null
const entityEvents = (bot, entity) => eventsFor(bot, entity)

module.exports = { attachEntityTracking, registryOrder, entityEvents }
