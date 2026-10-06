// How the watcher cuts the world open so the bot stays in sight (bits set by src/bot/viewModes.js):
// - full: everything.
// - roof: indoors, the roof over the bot's room is drawn as a faint ghost; trees and other buildings stay.
// - cave: only the walls of the cave the bot is in, with the ceiling cut away.
import type { BlockView } from '../types'

export type ViewMode = 'full' | 'roof' | 'cave'
export type Environment = BlockView['environment']

const FACES = 0b111111
// Top face shown when everything above the cut is hidden.
const CUT_TOP_BIT = 1 << 6
// The block's column is the bot's room or its walls.
const ROOM_BIT = 1 << 7
// The block borders the air the bot can reach.
const SHELL_BIT = 1 << 8
// Submerged plants and waterlogged blocks with geometry inside water.
const WATER_PLANT_BIT = 1 << 9
// The block has a solid block on top that may turn into a see-through hologram: its top is drawn darkened
// then (see src/components/watcher/seeThrough.ts).
export const CAP_BIT = 1 << 10

export const modeFor = (environment: Environment | undefined): ViewMode =>
  !environment || environment === 'outside' ? 'full' : environment === 'indoors' ? 'roof' : 'cave'

// null: not drawn. Otherwise the faces to draw and whether it's a see-through ghost.
export const blockVisibility = (
  mode: ViewMode,
  y: number,
  cutoff: number,
  faces: number
): { mask: number; ghost: boolean } | null => {
  const above = y >= cutoff
  let mask = faces & FACES
  const hasPlant = Boolean(faces & WATER_PLANT_BIT)
  if (mode === 'cave') {
    if (above || !(faces & SHELL_BIT)) return null
    if (faces & CUT_TOP_BIT) mask |= 1
  } else if (mode === 'roof' && faces & ROOM_BIT) {
    if (above) return mask || hasPlant ? { mask, ghost: true } : null
    if (faces & CUT_TOP_BIT) mask |= 1
  }
  return mask || hasPlant ? { mask, ghost: false } : null
}
