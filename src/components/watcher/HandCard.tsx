import React from 'react'
import type { InventoryItem } from '../../types'
import { itemIcon } from '../../utils/itemIcons'
import ItemIcon from '../ItemIcon'
import { durabilityColor, durabilityLeft, isEnchanted } from '../ItemStack'

// What the bot holds in one hand, shown beside it when it's clicked in the watcher. Inside a
// `group` with data-side set to the side of the bot it's on, so the icon stays nearest the bot.
const HandCard: React.FC<{ label: string; item: InventoryItem }> = ({ label, item }) => {
  const icon = item ? itemIcon(item.name) : null
  const left = item ? durabilityLeft(item) : null
  return (
    <div
      className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-neutral-950/70 py-1.5 pl-1.5 pr-3.5
        shadow-[0_8px_24px_#0008] backdrop-blur-xl group-data-[side=left]:flex-row-reverse
        group-data-[side=left]:pl-3.5 group-data-[side=left]:pr-1.5 group-data-[side=left]:text-right"
    >
      <span
        className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-lg
          bg-[radial-gradient(circle_at_50%_40%,#ffffff14,#ffffff03_70%)] ring-1 ring-inset ring-white/10"
      >
        {item ? (
          icon ? (
            <span className="scale-110">
              <ItemIcon icon={icon} alt={item.displayName} glint={isEnchanted(item)} />
            </span>
          ) : (
            <span className="text-[0.5rem] leading-tight text-neutral-300">{item.displayName}</span>
          )
        ) : (
          <span className="h-3 w-3 rounded-sm border border-dashed border-neutral-600" />
        )}
        {item && item.count > 1 ? (
          <span className="absolute bottom-0.5 right-1 font-mono text-[0.65rem] font-bold text-white [text-shadow:0_1px_2px_#000]">
            {item.count}
          </span>
        ) : null}
      </span>
      <span className="min-w-0 max-w-40">
        <span className="block text-[0.55rem] font-semibold uppercase tracking-[0.18em] text-neutral-500">{label}</span>
        <span
          className={`block truncate text-[0.8rem] ${
            !item ? 'text-neutral-500' : isEnchanted(item) ? 'text-cyan-200' : 'text-neutral-100'
          }`}
        >
          {item?.displayName ?? 'Empty'}
        </span>
        {item?.enchantments?.length ? (
          <span className="mt-0.5 block space-y-px">
            {item.enchantments.map((enchantment) => (
              <span
                key={enchantment.label}
                className={`block truncate text-[0.65rem] leading-tight ${
                  enchantment.curse ? 'text-rose-300/90' : 'text-violet-200/80'
                }`}
              >
                {enchantment.label}
              </span>
            ))}
          </span>
        ) : null}
        {item?.durability && left !== null ? (
          <span className="mt-1 flex items-center gap-1.5 group-data-[side=left]:flex-row-reverse">
            <span className="h-1 w-14 overflow-hidden rounded-full bg-white/10">
              <span
                className="block h-full rounded-full"
                style={{ width: `${left * 100}%`, background: durabilityColor(left) }}
              />
            </span>
            <span className="font-mono text-[0.6rem] tabular-nums text-neutral-400">
              {item.durability.max - item.durability.used}/{item.durability.max}
            </span>
          </span>
        ) : null}
      </span>
    </div>
  )
}

export default HandCard
