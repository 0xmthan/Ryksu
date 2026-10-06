// The bot's vitals for the HUD: health, food, air, effects, position, XP and ping.
import type { Bot } from 'mineflayer'
import type { BotSnapshot, StatusEffect } from '../types'
import { readOxygen } from './oxygen'

type Connected = Extract<BotSnapshot, { connected: true }>
export type Vitals = Pick<
  Connected,
  'effects' | 'health' | 'food' | 'saturation' | 'oxygen' | 'underwater' | 'position' | 'xp' | 'ping'
>

const finiteOr = (value: number | undefined, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

// Whether the bot's eyes are in water, when the game shows the air bubbles.
const headUnderwater = (bot: Bot) => {
  try {
    const eyes = bot.entity?.position?.offset(0, bot.entity.eyeHeight ?? 1.62, 0)
    const block = eyes ? bot.blockAt(eyes) : null
    if (!block) return false
    const waterlogged = block.getProperties?.().waterlogged
    return block.name === 'water' || block.name === 'bubble_column' || waterlogged === true || waterlogged === 'true'
  } catch {
    return false
  }
}

// The bot's status effects, for the row under health and food. `effectStarts`: when each effect (by id)
// arrived, since effects only say how long they had left at that moment.
const statusEffects = (bot: Bot, effectStarts: ReadonlyMap<number, number>): StatusEffect[] => {
  const effects = bot.entity?.effects ?? {}
  return Object.values(effects).flatMap((effect) => {
    const info = bot.registry.effects?.[effect.id] as { name: string; displayName?: string; type?: string } | undefined
    if (!info) return []
    return [
      {
        // Icon name, e.g. "jump_boost".
        name: info.name.replace(/([a-z])([A-Z])/g, '$1_$2').replace(/[\s']/g, '_').toLowerCase(),
        label: info.displayName ?? info.name,
        level: (effect.amplifier ?? 0) + 1,
        good: info.type === 'good',
        // Ticks left when it arrived (-1: no end), and when that was.
        ticks: effect.duration,
        since: effectStarts.get(effect.id) ?? Date.now(),
      },
    ]
  })
}

export const readVitals = (bot: Bot, effectStarts: ReadonlyMap<number, number>): Vitals => {
  const position = bot.entity?.position
  const experience: Partial<Bot['experience']> = bot.experience ?? {}
  const ping = bot.player?.ping
  return {
    effects: statusEffects(bot, effectStarts),
    health: finiteOr(bot.health, 0),
    food: finiteOr(bot.food, 0),
    saturation: finiteOr(bot.foodSaturation, 0),
    oxygen: readOxygen(bot),
    underwater: headUnderwater(bot),
    position: position
      ? {
          x: Number(position.x.toFixed(2)),
          y: Number(position.y.toFixed(2)),
          z: Number(position.z.toFixed(2)),
        }
      : null,
    xp: {
      level: finiteOr(experience.level, 0),
      points: finiteOr(experience.points, 0),
      progress: finiteOr(experience.progress, 0),
    },
    ping: typeof ping === 'number' && Number.isFinite(ping) ? ping : null,
  }
}
