// The Break / Place toggle: digging through blocks and placing scaffolding (bridging, pillaring up)
// while pathing. Pathfinder only places blocks from scafoldingBlocks, so an empty list turns placing off.
const defaultScaffolding = new WeakMap()

const applyBlockEditing = (movements, allowed) => {
  if (!movements) return
  if (!defaultScaffolding.has(movements)) {
    defaultScaffolding.set(movements, movements.scafoldingBlocks)
  }
  movements.canDig = allowed
  movements.allow1by1towers = allowed
  movements.scafoldingBlocks = allowed ? defaultScaffolding.get(movements) : []
}

module.exports = { applyBlockEditing }
