// Trading with villagers and wandering traders. Mineflayer's openVillager only takes villagers, so this
// opens the trade window itself, then leaves the trade to bot.trade (which works for both).
import type { Bot, Villager, VillagerTrade } from 'mineflayer'
import type { Entity } from 'prismarine-entity'
import loadItem, { type Item } from 'prismarine-item'
import type { TradeOffer } from '../types'
import { goals } from './plugins/core/pathfinder'
import { describeItem } from './worldView'

const TRADERS = new Set(['villager', 'wandering_trader'])
const REACH = 3
const WALK_TIMEOUT_MS = 20000
const OPEN_TIMEOUT_MS = 5000

// A trade as read below: mineflayer's VillagerTrade plus the input list it builds.
type Trade = Omit<VillagerTrade, 'realPrice'> & { inputs: Item[]; outputs: Item[]; realPrice: number }
export type TraderWindow = Omit<Villager, 'trades'> & { trades: Trade[] }

// The trade list packet: items still in notch format until readTrades converts them.
type RawTrade = Record<string, unknown> & {
  inputItem1?: unknown
  inputItem2?: { itemCount?: unknown } | null
  outputItem?: unknown
}
type TradeListPacket = { windowId: number; trades: RawTrade[] }

export const isTrader = (entity: Entity | null | undefined) => TRADERS.has(entity?.name ?? '')

// Same packet choice as mineflayer's villager plugin, which registers the older channels.
const tradeListPacket = (bot: Bot) =>
  bot.supportFeature('useMCTrList' as never)
    ? 'MC|TrList'
    : bot.supportFeature('usetraderlist' as never)
      ? 'minecraft:trader_list'
      : 'trade_list'

// The trade list as mineflayer's plugin reads it: items, plus the price after demand and reputation.
const readTrades = (bot: Bot, packet: TradeListPacket): Trade[] => {
  const ItemClass = loadItem(bot.registry)
  const fromNotch = (value: unknown) => ItemClass.fromNotch((value || { blockId: -1 }) as never) as Item
  return packet.trades.map((raw) => {
    const trade = raw as unknown as Trade
    trade.inputs = [(trade.inputItem1 = fromNotch(raw.inputItem1))]
    if (raw.inputItem2?.itemCount != null) {
      trade.inputs.push((trade.inputItem2 = fromNotch(raw.inputItem2)))
    }
    trade.hasItem2 = Boolean(trade.inputItem2 && trade.inputItem2.type && trade.inputItem2.count)
    trade.outputs = [(trade.outputItem = fromNotch(raw.outputItem))]
    if (trade.demand !== undefined && trade.specialPrice !== undefined) {
      const demandDiff = Math.max(
        0,
        Math.floor(trade.inputItem1.count * trade.demand * (trade.priceMultiplier ?? 0))
      )
      trade.realPrice = Math.min(
        Math.max(trade.inputItem1.count + trade.specialPrice + demandDiff, 1),
        trade.inputItem1.stackSize
      )
    } else {
      trade.realPrice = trade.inputItem1.count
    }
    return trade
  })
}

const walkTo = async (bot: Bot, entity: Entity) => {
  if (bot.entity.position.distanceTo(entity.position) <= REACH) return
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      bot.pathfinder.goto(new goals.GoalFollow(entity, 2)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          bot.pathfinder.setGoal(null)
          reject(new Error('Could not reach the trader.'))
        }, WALK_TIMEOUT_MS)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export const openTrader = async (bot: Bot, entity: Entity): Promise<TraderWindow> => {
  if (bot.currentWindow) throw new Error('Close the current container first.')
  await walkTo(bot, entity)
  if (!entity.isValid) throw new Error('The trader is gone.')
  if (bot.entity.position.distanceTo(entity.position) > REACH + 1) throw new Error('The trader is out of reach.')

  const packetName = tradeListPacket(bot)
  let trades: TradeListPacket | null = null
  let window: TraderWindow | null = null
  let listener: ((packet: TradeListPacket) => void) | undefined
  const gotTrades = new Promise<void>((resolve) => {
    listener = (packet) => {
      if (window && packet.windowId !== window.id) return
      trades = packet
      if (window) resolve()
    }
    bot._client.on(packetName, listener)
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    // Mineflayer's typings ask for a window class, but the function only takes the entity.
    const openEntity = bot.openEntity as unknown as (entity: Entity) => Promise<TraderWindow>
    window = await Promise.race([
      openEntity(entity),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('The trader did not respond.')), OPEN_TIMEOUT_MS)
      }),
    ])
    clearTimeout(timer)
    const opened: TraderWindow = window
    // The list can arrive before the window promise settles.
    if (!trades || (trades as TradeListPacket).windowId !== opened.id) {
      await Promise.race([
        gotTrades,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('The trader has nothing to trade.')), OPEN_TIMEOUT_MS)
        }),
      ])
    }
    opened.trades = readTrades(bot, trades as unknown as TradeListPacket)
    return opened
  } catch (error) {
    if (window) bot.closeWindow(window)
    throw error
  } finally {
    clearTimeout(timer)
    if (listener) bot._client.removeListener(packetName, listener)
  }
}

// What the trade panel shows for each offer, including how many times the bot can afford it now.
export const describeTrades = (bot: Bot, window: TraderWindow): TradeOffer[] =>
  window.trades.map((trade, index) => {
    const left = Math.max(0, trade.maximumNbTradeUses - trade.nbTradeUses)
    const have1 = window.count(trade.inputItem1.type, trade.inputItem1.metadata)
    let affordable = Math.floor(have1 / trade.realPrice)
    const item2 = trade.hasItem2 ? trade.inputItem2 : null
    if (item2) {
      const have2 = window.count(item2.type, item2.metadata)
      affordable = Math.min(affordable, Math.floor(have2 / item2.count))
    }
    return {
      index,
      inputs: [
        { ...describeItem(bot, trade.inputItem1)!, count: trade.realPrice },
        ...(item2 ? [describeItem(bot, item2)!] : []),
      ],
      basePrice: trade.inputItem1.count,
      output: describeItem(bot, trade.outputItem)!,
      uses: trade.nbTradeUses,
      maxUses: trade.maximumNbTradeUses,
      disabled: Boolean(trade.tradeDisabled) || left === 0,
      affordable: Math.min(affordable, left),
    }
  })

const MESSAGES: [RegExp, string][] = [
  [/not enough item 1/i, "The bot doesn't have enough to pay for that."],
  [/not enough item 2/i, "The bot doesn't have the second item that trade needs."],
  [/trade blocked/i, 'That trade is sold out.'],
]

export const runTrade = async (bot: Bot, window: TraderWindow, index: number, count: number) => {
  const trade = window.trades?.[index]
  if (!trade) throw new Error('That trade is gone.')
  try {
    await bot.trade(window, index, count)
  } catch (error) {
    const message = (error as Error | undefined)?.message
    const known = MESSAGES.find(([pattern]) => pattern.test(String(message)))
    throw new Error(known ? known[1] : message || 'The trade failed.')
  }
}
