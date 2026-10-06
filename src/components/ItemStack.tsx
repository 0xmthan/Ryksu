import React from 'react'
import type { InventoryItem } from '../types'
import { itemIcon } from '../utils/itemIcons'
import ItemIcon from './ItemIcon'
import './itemStack.css'

type Item = NonNullable<InventoryItem>

export const isEnchanted = (item: Item) =>
  Boolean(item.enchantments?.length) || item.name === 'enchanted_book'

// Remaining durability, 0-1; null for items that don't wear out.
export const durabilityLeft = (item: Item) =>
  item.durability ? (item.durability.max - item.durability.used) / item.durability.max : null

// Green when fresh through yellow to red when nearly broken, as the game colors it.
export const durabilityColor = (left: number) => `hsl(${Math.round(left * 120)} 90% 50%)`

// Plain-text lines for tooltips: enchantments, then durability.
export const itemDetails = (item: Item) => [
  ...(item.enchantments ?? []).map((enchantment) => enchantment.label),
  ...(item.durability
    ? [`Durability ${item.durability.max - item.durability.used} / ${item.durability.max}`]
    : []),
]

// The game's bar under a damaged item: black track, colored remaining part.
const DurabilityBar: React.FC<{ left: number }> = ({ left }) => (
  <span
    className="pointer-events-none absolute bottom-[3px] left-1/2 z-[1] h-[3px] w-[70%] -translate-x-1/2
      bg-black"
  >
    <span className="block h-[2px]" style={{ width: `${left * 100}%`, background: durabilityColor(left) }} />
  </span>
)

// An item in a slot: icon (with glint when enchanted), stack count, and durability bar once damaged.
const ItemStack: React.FC<{ item: InventoryItem }> = ({ item }) => {
  if (!item) return null
  const icon = itemIcon(item.name)
  const left = durabilityLeft(item)
  return (
    <>
      {icon ? (
        <ItemIcon icon={icon} alt={item.displayName} glint={isEnchanted(item)} />
      ) : (
        <span className="mc-item-fallback">{item.displayName}</span>
      )}
      {item.count > 1 && <span className="mc-count">{item.count}</span>}
      {left !== null && left < 1 ? <DurabilityBar left={left} /> : null}
    </>
  )
}

export default ItemStack
