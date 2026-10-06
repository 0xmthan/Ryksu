import React, { useEffect, useRef, useState } from 'react'
import { Apple } from 'lucide-react'
import type { AutoEatOptions, InventoryItem, StatusEffect } from '../../../shared/types'
import EffectSlots from './EffectSlots'
import Item, { itemDetails } from '../../components/ItemStack'
import './vitals.css'

type Change = { delta: number; id: number }

// The latest change to a value, kept around long enough to animate it.
const useChange = (value: number) => {
  const previous = useRef(value)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [change, setChange] = useState<Change | null>(null)

  useEffect(() => {
    const delta = value - previous.current
    previous.current = value
    if (Math.abs(delta) < 0.05) return
    setChange((current) => ({ delta, id: (current?.id ?? 0) + 1 }))
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setChange(null), 1100)
  }, [value])
  useEffect(() => () => clearTimeout(timer.current), [])

  return change
}

// Lags behind drops so the lost chunk stays visible for a moment before draining away.
const useTrail = (value: number) => {
  const [trail, setTrail] = useState(value)
  useEffect(() => {
    setTrail((current) => Math.max(current, value))
    const timer = setTimeout(() => setTrail(value), 450)
    return () => clearTimeout(timer)
  }, [value])
  return trail
}

const formatPoints = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1))
const percent = (value: number) => `${Math.max(0, Math.min(1, value / 20)) * 100}%`

const Bar: React.FC<{
  label: string
  value: number
  status: { label: string; className: string }
  fillClass: string
  lossClass: string
  saturation?: number
  // Auto eat threshold, drawn as a tick on the bar.
  mark?: { at: number; title: string }
  badge?: React.ReactNode
}> = ({ label, value, status, fillClass, lossClass, saturation, mark, badge }) => {
  const change = useChange(value)
  const trail = useTrail(value)
  const gained = change ? change.delta > 0 : false

  return (
    <div className="relative flex items-center gap-2" title={status.label}>
      <span
        className={`flex w-11 items-center gap-1 text-[0.6rem] font-semibold uppercase tracking-[0.12em]
          ${status.className}`}
      >
        {label}
        {badge}
      </span>
      <span className="flex flex-1 flex-col gap-[2px]">
        <span className="relative block">
          <span
            key={change?.id}
            className={`vitals-track relative block h-1.5 overflow-hidden rounded-full ${
              change ? (gained ? 'vitals-heal' : lossClass) : ''
            }`}
          >
            <span
              className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-out ${
                gained ? 'bg-white/25' : 'bg-rose-400/50'
              }`}
              style={{ width: percent(trail) }}
            />
            <span
              className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-300 ease-out
                ${fillClass}`}
              style={{ width: percent(value) }}
            />
          </span>
          {mark ? (
            <span
              className="absolute -inset-y-[3px] w-[2px] -translate-x-1/2 rounded-full bg-neutral-950
                shadow-[0_0_0_1px_#ffffff73]"
              style={{ left: percent(mark.at) }}
              title={mark.title}
            />
          ) : null}
        </span>
        {saturation != null ? (
          <span
            className="block h-[2px] overflow-hidden rounded-full"
            title={`Saturation ${saturation.toFixed(1)}`}
          >
            <span
              className="vitals-fill-saturation block h-full rounded-full transition-[width] duration-500"
              style={{ width: percent(saturation) }}
            />
          </span>
        ) : null}
      </span>
      <span className="w-7 text-right font-mono text-[0.6rem] tabular-nums text-neutral-400">
        {formatPoints(value)}
      </span>
      {change ? (
        <span
          className={`vitals-float pointer-events-none absolute -top-2.5 right-0 font-mono text-[0.6rem]
            font-bold ${gained ? 'text-emerald-200' : 'text-rose-300'}`}
        >
          {gained ? '+' : '−'}
          {formatPoints(Math.round(Math.abs(change.delta) * 10) / 10)}
        </span>
      ) : null}
    </div>
  )
}

const healthStatus = (health: number, food: number) => {
  if (health <= 0) return { label: 'Dead', className: 'text-rose-400' }
  if (health <= 6) return { label: 'Critical', className: 'text-rose-300' }
  if (health < 20 && food >= 18) return { label: 'Regenerating', className: 'text-emerald-200/80' }
  if (health < 14) return { label: 'Hurt', className: 'text-rose-200/70' }
  return { label: health >= 20 ? 'Full health' : 'Healthy', className: 'text-neutral-500' }
}

const foodStatus = (food: number) => {
  if (food <= 0) return { label: 'Starving', className: 'text-rose-300' }
  if (food <= 6) return { label: "Can't sprint", className: 'text-rose-300' }
  return { label: food < 18 ? 'Peckish' : 'Well fed', className: 'text-neutral-500' }
}

const oxygenStatus = (oxygen: number, underwater: boolean) => {
  if (oxygen <= 0) return { label: 'Drowning', className: 'text-rose-300' }
  if (oxygen <= 6) return { label: 'Low on air', className: 'text-rose-300' }
  return { label: underwater ? 'Holding breath' : 'Catching breath', className: 'text-sky-200/80' }
}

export const Hotbar: React.FC<{
  items: InventoryItem[]
  selected: number
  onSelect: (index: number) => Promise<boolean>
}> = ({ items, selected, onSelect }) => {
  const [pending, setPending] = useState<number | null>(null)
  // Show the new slot straight away; the bot's next update confirms it.
  useEffect(() => setPending(null), [selected])
  const select = (index: number) => {
    setPending(index)
    onSelect(index).then((ok) => {
      if (!ok) setPending(null)
    })
  }
  const shown = pending ?? selected
  return (
    <div
      className="flex gap-1 rounded-xl border border-neutral-800 bg-neutral-900/90 p-1.5 shadow-lg
        backdrop-blur"
    >
      {Array.from({ length: 9 }, (_, index) => {
        const item = items[index] ?? null
        const active = index === shown
        return (
          <button
            key={index}
            type="button"
            onClick={() => select(index)}
            title={
              item
                ? [
                    `${index + 1}: ${item.displayName}${item.count > 1 ? ` ×${item.count}` : ''}`,
                    ...itemDetails(item),
                  ].join('\n')
                : `${index + 1}: Empty`
            }
            aria-label={`Hotbar slot ${index + 1}${item ? `: ${item.displayName}` : ': empty'}`}
            aria-pressed={active}
            className={`relative flex h-[34px] w-[34px] items-center justify-center rounded-md border
            transition-colors ${
              active
                ? 'border-white/40 bg-white/[0.08] shadow-[0_0_12px_#ffffff14]'
                : 'border-white/[0.04] bg-black/30 hover:border-white/15 hover:bg-white/[0.04]'
            }`}
          >
            <span
              className={`pointer-events-none absolute left-1 top-0.5 font-mono text-[0.5rem] leading-none ${
                active ? 'text-neutral-200' : 'text-neutral-600'
              }`}
            >
              {index + 1}
            </span>
            <Item item={item} />
          </button>
        )
      })}
    </div>
  )
}

const VitalBars: React.FC<{
  health: number
  food: number
  saturation: number
  autoEat: AutoEatOptions | null
  // What the bot is eating right now, if anything.
  eating?: string
  effects?: StatusEffect[]
  oxygen: number
  underwater: boolean
}> = ({ health, food, saturation, autoEat, eating, effects = [], oxygen, underwater }) => {
  const critical = health > 0 && health <= 6
  return (
    <section
      className={`flex flex-col gap-2 rounded-xl border bg-neutral-900/90 px-3 py-2.5 shadow-lg backdrop-blur
        ${critical ? 'vitals-danger border-rose-400/30' : 'border-neutral-800'}`}
    >
      <Bar
        label="HP"
        value={health}
        status={healthStatus(health, food)}
        fillClass={critical ? 'vitals-fill-low vitals-blink' : 'vitals-fill-normal'}
        lossClass="vitals-hit"
        mark={
          autoEat ? { at: autoEat.minHealth, title: `Auto eat below ${autoEat.minHealth} HP` } : undefined
        }
      />
      <Bar
        label="Food"
        value={food}
        status={
          eating
            ? { label: `Eating ${eating}…`, className: 'vitals-eating text-emerald-200' }
            : foodStatus(food)
        }
        fillClass={food <= 6 ? `vitals-fill-low ${food <= 3 ? 'vitals-blink' : ''}` : 'vitals-fill-normal'}
        lossClass="vitals-hunger"
        saturation={saturation}
        mark={
          autoEat ? { at: autoEat.minHunger, title: `Auto eat below ${autoEat.minHunger} food` } : undefined
        }
        badge={
          autoEat ? (
            <span title={eating ? `Eating ${eating}…` : 'Auto eat is on'}>
              <Apple
                aria-label={eating ? `Eating ${eating}` : 'Auto eat on'}
                className={`h-2.5 w-2.5 ${eating ? 'vitals-chew text-emerald-300' : 'text-neutral-300'}`}
                strokeWidth={2.25}
              />
            </span>
          ) : null
        }
      />
      {/* Like the game's bubbles: only while underwater or still refilling. */}
      {underwater || oxygen < 20 ? (
        <Bar
          label="O2"
          value={oxygen}
          status={oxygenStatus(oxygen, underwater)}
          fillClass={
            oxygen <= 6 ? `vitals-fill-low ${oxygen <= 3 ? 'vitals-blink' : ''}` : 'vitals-fill-oxygen'
          }
          lossClass="vitals-air"
        />
      ) : null}
      <EffectSlots effects={effects} />
    </section>
  )
}

export default VitalBars
