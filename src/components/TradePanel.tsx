import React, { useEffect, useRef, useState } from 'react'
import { ArrowRight, Store, X } from 'lucide-react'
import type { InventoryItem, TradeOffer } from '../types'
import ItemStack, { itemDetails } from './ItemStack'
import './inventory.css'

type TradePanelProps = {
  title: string
  trades: TradeOffer[]
  onTradesChange: (trades: TradeOffer[]) => void
  onClose: () => void
}

const Slot: React.FC<{ item: NonNullable<InventoryItem> }> = ({ item }) => (
  <span
    title={[`${item.count}× ${item.displayName}`, ...itemDetails(item)].join('\n')}
    className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/5
      bg-black/30"
  >
    <ItemStack item={item} />
  </span>
)

// The open trader's offers: what it costs, what you get, how much stock is left, and buttons to trade
// once or as many times as the bot can afford.
const TradePanel: React.FC<TradePanelProps> = ({ title, trades, onTradesChange, onClose }) => {
  const [busy, setBusy] = useState<number | null>(null)
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null)
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => panel.current?.focus(), [])
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.code !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [onClose])

  const trade = async (offer: TradeOffer, count: number) => {
    if (busy !== null) return
    setBusy(offer.index)
    setFeedback(null)
    try {
      const response = await window.electronAPI.bot.trade(offer.index, count)
      if (response.trades) onTradesChange(response.trades)
      setFeedback(
        response.ok
          ? { text: `Got ${offer.output.count * count}× ${offer.output.displayName}.`, error: false }
          : { text: response.message ?? 'The trade failed.', error: true }
      )
    } catch {
      setFeedback({ text: 'The trade failed. Try again.', error: true })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div
      className="fixed inset-x-0 bottom-0 top-12 z-40 flex items-center justify-center bg-black/30"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={`Trading with ${title}`}
        tabIndex={-1}
        className="flex max-h-[min(560px,calc(100%-32px))] w-[460px] max-w-[calc(100%-32px)] flex-col
          rounded-2xl border border-white/10 bg-neutral-900/85 text-xs text-neutral-300
          shadow-[0_20px_70px_#0009] outline-none backdrop-blur-2xl"
      >
        <header className="flex items-center justify-between gap-3 border-b border-white/5 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-400/10
                text-emerald-300"
            >
              <Store aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-white">{title}</h2>
              <p className="text-[0.65rem] text-neutral-500">
                {trades.length} {trades.length === 1 ? 'offer' : 'offers'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close trading"
            className="rounded-md p-1 text-neutral-400 hover:bg-white/10 hover:text-white"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </header>

        <ul className="flex-1 space-y-1.5 overflow-y-auto p-3">
          {trades.length === 0 ? (
            <li className="py-6 text-center text-neutral-500">No offers right now.</li>
          ) : null}
          {trades.map((offer) => {
            const price = offer.inputs[0]
            const priceChange = price.count - offer.basePrice
            const left = Math.max(0, offer.maxUses - offer.uses)
            const canTrade = !offer.disabled && offer.affordable > 0 && busy === null
            return (
              <li
                key={offer.index}
                className={`flex items-center gap-3 rounded-xl px-2.5 py-2 transition-colors ${
                  offer.disabled ? 'bg-white/[0.02] opacity-50' : 'bg-white/[0.04] hover:bg-white/[0.07]'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="relative">
                    <Slot item={price} />
                    {priceChange !== 0 ? (
                      <span
                        title={priceChange < 0 ? 'Discounted' : 'Raised by demand'}
                        className={`absolute -top-1.5 -left-1 rounded bg-neutral-950/90 px-1 font-mono
                          text-[0.55rem] ${
                            priceChange < 0 ? 'text-emerald-300 line-through' : 'text-amber-300'
                          }`}
                      >
                        {offer.basePrice}
                      </span>
                    ) : null}
                  </span>
                  {offer.inputs[1] ? (
                    <>
                      <span className="text-neutral-600">+</span>
                      <Slot item={offer.inputs[1]} />
                    </>
                  ) : null}
                </div>
                <ArrowRight
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 text-neutral-600"
                  strokeWidth={2}
                />
                <Slot item={offer.output} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-neutral-100" title={offer.output.displayName}>
                    {offer.output.displayName}
                  </div>
                  {offer.disabled ? (
                    <div className="text-[0.65rem] text-rose-300">Sold out</div>
                  ) : (
                    <div
                      className="mt-1 flex items-center gap-1.5"
                      title={`${left} of ${offer.maxUses} left`}
                    >
                      <span className="h-1 w-12 overflow-hidden rounded-full bg-white/10">
                        <span
                          className="block h-full rounded-full bg-emerald-400/70"
                          style={{ width: `${(left / Math.max(1, offer.maxUses)) * 100}%` }}
                        />
                      </span>
                      <span className="text-[0.6rem] text-neutral-500">{left} left</span>
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    disabled={!canTrade}
                    onClick={() => trade(offer, 1)}
                    title={
                      offer.affordable === 0 && !offer.disabled ? 'Not enough items to pay' : 'Trade once'
                    }
                    className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-1.5
                      text-emerald-200 hover:bg-emerald-500/20 disabled:cursor-not-allowed
                      disabled:border-white/5 disabled:bg-transparent disabled:text-neutral-600"
                  >
                    {busy === offer.index ? 'Trading…' : 'Trade'}
                  </button>
                  {offer.affordable > 1 ? (
                    <button
                      type="button"
                      disabled={!canTrade}
                      onClick={() => trade(offer, offer.affordable)}
                      title={`Trade ${offer.affordable} times`}
                      className="rounded-lg border border-white/10 px-2 py-1.5 font-mono text-neutral-300
                        hover:bg-white/10 disabled:cursor-not-allowed disabled:text-neutral-600"
                    >
                      ×{offer.affordable}
                    </button>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>

        {feedback ? (
          <p
            role="status"
            className={`border-t border-white/5 px-4 py-2.5
              ${feedback.error ? 'text-rose-300' : 'text-emerald-300'}`}
          >
            {feedback.text}
          </p>
        ) : null}
      </div>
    </div>
  )
}

export default TradePanel
