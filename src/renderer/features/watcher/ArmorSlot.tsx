import React from 'react'
import type { InventoryItem } from '../../../shared/types'
import { itemIcon } from '../../lib/itemIcons'
import ItemIcon from '../../components/ItemIcon'
import ItemStack, { itemDetails } from '../../components/ItemStack'

// Faded stand-ins for empty slots, like the inventory's.
const EMPTY_ICONS = ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots']

// One worn piece in the arc over the bot.
const ArmorSlot: React.FC<{ index: number; label: string; item: InventoryItem }> = ({
  index,
  label,
  item,
}) => {
  const ghost = item ? null : itemIcon(EMPTY_ICONS[index])
  return (
    <div
      title={item ? [`${label}: ${item.displayName}`, ...itemDetails(item)].join('\n') : `${label}: empty`}
      className="relative flex h-11 w-11 items-center justify-center rounded-xl border border-white/10
        bg-neutral-950/70 bg-[radial-gradient(circle_at_50%_40%,#ffffff14,#ffffff03_70%)]
        shadow-[0_8px_24px_#0008] backdrop-blur-xl"
    >
      {item ? (
        <ItemStack item={item} />
      ) : ghost ? (
        <span className="opacity-20 grayscale">
          <ItemIcon icon={ghost} alt={`No ${label.toLowerCase()}`} />
        </span>
      ) : null}
    </div>
  )
}

export default ArmorSlot
