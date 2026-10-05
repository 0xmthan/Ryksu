// The bot's air, 0-20 like health. Read from the bot's own entity metadata rather than bot.oxygenLevel:
// mineflayer's metadata handler (entities.js, 1.13+) sets oxygenLevel from every entity's air update, so a
// nearby mob in water would show its air as the bot's.
const AIR_SUPPLY_KEY = 1
const MAX_AIR_TICKS = 300

const readOxygen = (bot) => {
  const entity = bot.entity
  const keys = entity?.name ? bot.registry?.entitiesByName?.[entity.name]?.metadataKeys : null
  const index = keys ? keys.indexOf('air_supply') : -1
  const air = entity?.metadata?.[index >= 0 ? index : AIR_SUPPLY_KEY]
  if (!Number.isFinite(air)) return 20
  return Math.max(0, Math.min(20, Math.round(air / (MAX_AIR_TICKS / 20))))
}

module.exports = { readOxygen }
