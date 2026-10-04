// Trading with villagers and wandering traders. Mineflayer's openVillager only takes villagers, so this
// opens the trade window itself, then leaves the trade to bot.trade (which works for both).
const { goals } = require('mineflayer-pathfinder')
const { describeItem } = require('./worldView')

const TRADERS = new Set(['villager', 'wandering_trader'])
const REACH = 3
const WALK_TIMEOUT_MS = 20000
const OPEN_TIMEOUT_MS = 5000

const isTrader = (entity) => TRADERS.has(entity?.name)

// Same packet choice as mineflayer's villager plugin, which registers the older channels.
const tradeListPacket = (bot) =>
  bot.supportFeature('useMCTrList')
    ? 'MC|TrList'
    : bot.supportFeature('usetraderlist')
      ? 'minecraft:trader_list'
      : 'trade_list'

// The trade list as mineflayer's plugin reads it: items, plus the price after demand and reputation.
const readTrades = (bot, packet) => {
  const Item = require('prismarine-item')(bot.registry)
  return packet.trades.map((trade) => {
    trade.inputs = [(trade.inputItem1 = Item.fromNotch(trade.inputItem1 || { blockId: -1 }))]
    if (trade.inputItem2?.itemCount != null) {
      trade.inputs.push((trade.inputItem2 = Item.fromNotch(trade.inputItem2 || { blockId: -1 })))
    }
    trade.hasItem2 = Boolean(trade.inputItem2 && trade.inputItem2.type && trade.inputItem2.count)
    trade.outputs = [(trade.outputItem = Item.fromNotch(trade.outputItem || { blockId: -1 }))]
    if (trade.demand !== undefined && trade.specialPrice !== undefined) {
      const demandDiff = Math.max(0, Math.floor(trade.inputItem1.count * trade.demand * trade.priceMultiplier))
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

const walkTo = async (bot, entity) => {
  if (bot.entity.position.distanceTo(entity.position) <= REACH) return
  let timer
  try {
    await Promise.race([
      bot.pathfinder.goto(new goals.GoalFollow(entity, 2)),
      new Promise((_, reject) => {
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

const openTrader = async (bot, entity) => {
  if (bot.currentWindow) throw new Error('Close the current container first.')
  await walkTo(bot, entity)
  if (!entity.isValid) throw new Error('The trader is gone.')
  if (bot.entity.position.distanceTo(entity.position) > REACH + 1) throw new Error('The trader is out of reach.')

  const packetName = tradeListPacket(bot)
  let trades = null
  let window = null
  let listener
  const gotTrades = new Promise((resolve) => {
    listener = (packet) => {
      if (window && packet.windowId !== window.id) return
      trades = packet
      if (window) resolve()
    }
    bot._client.on(packetName, listener)
  })
  let timer
  try {
    window = await Promise.race([
      bot.openEntity(entity),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('The trader did not respond.')), OPEN_TIMEOUT_MS)
      }),
    ])
    clearTimeout(timer)
    // The list can arrive before the window promise settles.
    if (!trades || trades.windowId !== window.id) {
      await Promise.race([
        gotTrades,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('The trader has nothing to trade.')), OPEN_TIMEOUT_MS)
        }),
      ])
    }
    window.trades = readTrades(bot, trades)
    return window
  } catch (error) {
    if (window) bot.closeWindow(window)
    throw error
  } finally {
    clearTimeout(timer)
    bot._client.removeListener(packetName, listener)
  }
}

// What the trade panel shows for each offer, including how many times the bot can afford it now.
const describeTrades = (bot, window) =>
  window.trades.map((trade, index) => {
    const left = Math.max(0, trade.maximumNbTradeUses - trade.nbTradeUses)
    const have1 = window.count(trade.inputItem1.type, trade.inputItem1.metadata)
    let affordable = Math.floor(have1 / trade.realPrice)
    if (trade.hasItem2) {
      const have2 = window.count(trade.inputItem2.type, trade.inputItem2.metadata)
      affordable = Math.min(affordable, Math.floor(have2 / trade.inputItem2.count))
    }
    return {
      index,
      inputs: [
        { ...describeItem(bot, trade.inputItem1), count: trade.realPrice },
        ...(trade.hasItem2 ? [describeItem(bot, trade.inputItem2)] : []),
      ],
      basePrice: trade.inputItem1.count,
      output: describeItem(bot, trade.outputItem),
      uses: trade.nbTradeUses,
      maxUses: trade.maximumNbTradeUses,
      disabled: Boolean(trade.tradeDisabled) || left === 0,
      affordable: Math.min(affordable, left),
    }
  })

const MESSAGES = [
  [/not enough item 1/i, "The bot doesn't have enough to pay for that."],
  [/not enough item 2/i, "The bot doesn't have the second item that trade needs."],
  [/trade blocked/i, 'That trade is sold out.'],
]

const runTrade = async (bot, window, index, count) => {
  const trade = window.trades?.[index]
  if (!trade) throw new Error('That trade is gone.')
  try {
    await bot.trade(window, index, count)
  } catch (error) {
    const known = MESSAGES.find(([pattern]) => pattern.test(String(error?.message)))
    throw new Error(known ? known[1] : error?.message || 'The trade failed.')
  }
}

module.exports = { isTrader, openTrader, describeTrades, runTrade }
