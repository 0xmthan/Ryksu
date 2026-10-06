import React, { useEffect, useState } from 'react'

// Skins as data URLs by player name, shared by every head on screen. Offline-mode players have none.
const skins = new Map<string, Promise<string | null>>()

const skinFor = (name: string) => {
  if (!skins.has(name)) {
    skins.set(
      name,
      window.electronAPI.bot
        .getPlayerSkin(name)
        .then((url) => (url ? window.electronAPI.bot.getSkin(url) : null))
        .then((dataUrl) => {
          // Try again later (they may join, or the server may send the skin late).
          if (!dataUrl) setTimeout(() => skins.delete(name), 30000)
          return dataUrl
        })
        .catch(() => {
          skins.delete(name)
          return null
        })
    )
  }
  return skins.get(name)!
}

// A steady color per name, for the stand-in head.
const hue = (name: string) => [...name].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 360, 7)

// A player's face (and hat layer) cut from their skin; their initial on a colored tile without one.
const PlayerHead: React.FC<{ name: string; size?: number; className?: string }> = ({
  name,
  size = 14,
  className = '',
}) => {
  const [skin, setSkin] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    skinFor(name).then((dataUrl) => {
      if (!cancelled) setSkin(dataUrl)
    })
    return () => {
      cancelled = true
    }
  }, [name])

  const box: React.CSSProperties = { width: size, height: size }
  if (!skin) {
    return (
      <span
        aria-hidden="true"
        className={`inline-flex shrink-0 items-center justify-center rounded-[3px] font-sans font-bold
          text-white/90 ${className}`}
        style={{ ...box, fontSize: size * 0.62, background: `hsl(${hue(name)} 35% 38%)` }}
      >
        {name[0]?.toUpperCase()}
      </span>
    )
  }
  // The face is the 8×8 square at (8, 8) of the skin; the hat layer at (40, 8).
  const layer = (x: number): React.CSSProperties => ({
    position: 'absolute',
    inset: 0,
    backgroundImage: `url(${skin})`,
    backgroundSize: `${size * 8}px auto`,
    backgroundPosition: `${-x * (size / 8)}px ${-size}px`,
    imageRendering: 'pixelated',
  })
  return (
    <span
      aria-hidden="true"
      className={`relative inline-block shrink-0 overflow-hidden rounded-xs ${className}`}
      style={box}
    >
      <span style={layer(8)} />
      <span style={layer(40)} />
    </span>
  )
}

export default PlayerHead
