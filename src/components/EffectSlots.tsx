import React, { useEffect, useState } from 'react'
import type { StatusEffect } from '../types'
import effectIcons from '../generated/effectIcons.json'

const icons = (effectIcons as { icons: Record<string, string> }).icons

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']

// What each effect does, for the tooltip.
const DESCRIPTIONS: Record<string, string> = {
  speed: 'Moves 20% faster per level.',
  slowness: 'Moves 15% slower per level.',
  haste: 'Mines and swings faster.',
  mining_fatigue: 'Mines and swings much slower.',
  strength: 'Melee hits deal 3 more damage per level.',
  instant_health: 'Heals right away.',
  instant_damage: 'Hurts right away.',
  jump_boost: 'Jumps higher and takes less fall damage.',
  nausea: 'The view warps and wobbles.',
  regeneration: 'Regains health over time.',
  resistance: 'Takes 20% less damage per level.',
  fire_resistance: 'Immune to fire and lava.',
  water_breathing: "Doesn't run out of air underwater.",
  invisibility: 'Invisible to mobs and players (worn armor still shows).',
  blindness: "Can barely see, can't sprint or land critical hits.",
  night_vision: 'Sees clearly in the dark.',
  hunger: 'Food drains faster.',
  weakness: 'Melee hits deal 4 less damage.',
  poison: 'Loses health over time, but never below half a heart.',
  wither: 'Loses health over time, and it can kill.',
  health_boost: 'Adds 2 hearts of max health per level.',
  absorption: 'Extra golden hearts that take damage first.',
  saturation: 'Refills food right away.',
  glowing: 'Outlined through walls.',
  levitation: 'Floats upward.',
  luck: 'Better loot from chests and fishing.',
  unluck: 'Worse loot from chests and fishing.',
  slow_falling: 'Falls slowly and takes no fall damage.',
  conduit_power: 'Breathes and sees underwater, and mines faster there.',
  dolphins_grace: 'Swims much faster.',
  bad_omen: 'Turns into a raid or trial omen in a village or trial chamber.',
  raid_omen: 'A raid is about to start.',
  trial_omen: 'Trial spawners turn ominous.',
  hero_of_the_village: 'Villagers give discounts and gifts.',
  darkness: 'The view keeps fading to dark.',
  wind_charged: 'Bursts with wind on death.',
  weaving: 'Spreads cobwebs on death.',
  oozing: 'Splits into slimes on death.',
  infested: 'Silverfish may crawl out when hurt.',
}

const secondsLeft = (effect: StatusEffect, now: number) =>
  effect.ticks < 0 ? Infinity : Math.max(0, effect.ticks / 20 - (now - effect.since) / 1000)

const clock = (seconds: number) => {
  if (!Number.isFinite(seconds)) return '∞'
  const total = Math.ceil(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = String(total % 60).padStart(2, '0')
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`
}

// One effect: its icon in a square, level in the corner, a bar running down with the time left. Blinks for
// its last 10 seconds like the game's. Hover for the details.
const EffectSlot: React.FC<{ effect: StatusEffect; now: number }> = ({ effect, now }) => {
  const [hover, setHover] = useState(false)
  const left = secondsLeft(effect, now)
  const total = effect.ticks / 20
  const fraction = Number.isFinite(left) && total > 0 ? Math.min(1, left / total) : 1
  const ending = left <= 10
  const level = ROMAN[effect.level] ?? String(effect.level)
  const tone = effect.good
    ? { border: 'border-emerald-400/25', bar: 'bg-emerald-300/80', text: 'text-emerald-300' }
    : { border: 'border-rose-400/30', bar: 'bg-rose-300/80', text: 'text-rose-300' }
  return (
    <div className="relative" onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}>
      <div
        aria-label={`${effect.label} ${level}, ${clock(left)} left`}
        className={`relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg border
          bg-black/40 ${tone.border} ${ending ? 'vitals-blink' : ''}`}
      >
        {icons[effect.name] ? (
          <img
            src={icons[effect.name]}
            alt=""
            draggable={false}
            className="h-[18px] w-[18px] [image-rendering:pixelated]"
          />
        ) : (
          <span className="text-[0.6rem] text-neutral-300">{effect.label.slice(0, 2)}</span>
        )}
        {effect.level > 1 ? (
          <span
            className="absolute right-0.5 top-0 font-mono text-[0.5rem] font-bold text-white
              [text-shadow:0_1px_1px_#000]"
          >
            {level}
          </span>
        ) : null}
        <span className="absolute inset-x-0 bottom-0 h-[2px] bg-white/10">
          <span className={`block h-full ${tone.bar}`} style={{ width: `${fraction * 100}%` }} />
        </span>
      </div>
      {hover ? (
        <div
          role="tooltip"
          className="absolute left-0 top-full z-50 mt-1.5 w-52 rounded-lg border border-white/10
            bg-neutral-950/90 p-2.5 text-xs shadow-xl backdrop-blur-xl"
        >
          <div className="flex items-center gap-2">
            {icons[effect.name] ? (
              <img src={icons[effect.name]} alt="" className="h-4 w-4 [image-rendering:pixelated]" />
            ) : null}
            <span className="font-semibold text-neutral-100">
              {effect.label} {level}
            </span>
          </div>
          <div className="mt-1 flex justify-between text-[0.65rem]">
            <span className={tone.text}>{effect.good ? 'Beneficial' : 'Harmful'}</span>
            <span className="font-mono text-neutral-300">{clock(left)} left</span>
          </div>
          {DESCRIPTIONS[effect.name] ? (
            <p className="mt-1.5 leading-snug text-neutral-400">{DESCRIPTIONS[effect.name]}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

// The bot's status effects, good ones first, each counting down.
const EffectSlots: React.FC<{ effects: StatusEffect[] }> = ({ effects }) => {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!effects.length) return
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [effects.length])
  if (!effects.length) return null
  const sorted = [...effects].sort(
    (a, b) => Number(b.good) - Number(a.good) || a.label.localeCompare(b.label)
  )
  return (
    <div className="flex flex-wrap gap-1.5 pt-0.5">
      {sorted.map((effect) => (
        <EffectSlot key={effect.name} effect={effect} now={now} />
      ))}
    </div>
  )
}

export default EffectSlots
