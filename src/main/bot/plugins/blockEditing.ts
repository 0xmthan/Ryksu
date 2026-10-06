import type { Movements } from '../vendor/pathfinder/lib/movements'

// The Break / Place toggle: digging through blocks and placing scaffolding (bridging, pillaring up)
// while pathing. Pathfinder only places blocks from scafoldingBlocks, so an empty list turns placing off.
const defaultScaffolding = new WeakMap<Movements, Movements['scafoldingBlocks']>()

export const applyBlockEditing = (movements: Movements | null, allowed: boolean) => {
  if (!movements) return
  if (!defaultScaffolding.has(movements)) {
    defaultScaffolding.set(movements, movements.scafoldingBlocks)
  }
  movements.canDig = allowed
  movements.allow1by1towers = allowed
  movements.scafoldingBlocks = allowed ? (defaultScaffolding.get(movements) ?? []) : []
}
