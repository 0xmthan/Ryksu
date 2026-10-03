import React, { useCallback, useEffect, useState } from 'react'
import { Hand, LoaderCircle, Trash2, X } from 'lucide-react'
import type { InventoryAction, InventoryItem, WorldView } from '../types'
import { blockColor } from '../utils/blockColors'
import { itemIcon } from '../utils/itemIcons'
import ItemIcon from './ItemIcon'

type Inventory = WorldView['inventory']

// Player window slot numbers, same as the bot uses.
const MAIN_START = 9
const HOTBAR_START = 36
const ARMOR_SLOTS = [
  { key: 'head', slot: 5, label: 'Head' },
  { key: 'torso', slot: 6, label: 'Chest' },
  { key: 'legs', slot: 7, label: 'Legs' },
  { key: 'feet', slot: 8, label: 'Feet' },
] as const
const OFFHAND_SLOT = 45
const DRAG_TYPE = 'application/x-ryksu-slot'

type SlotProps = {
  slot: number
  item: InventoryItem
  selected: boolean
  held?: boolean
  placeholder?: string
  onSelect: (slot: number) => void
  onMove: (from: number, to: number) => void
}

const Slot: React.FC<SlotProps> = ({ slot, item, selected, held = false, placeholder, onSelect, onMove }) => {
  const [isOver, setIsOver] = useState(false)
  const icon = item ? itemIcon(item.name) : null

  return (
    <button
      type="button"
      draggable={Boolean(item)}
      onClick={() => item && onSelect(slot)}
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_TYPE, String(slot))
        event.dataTransfer.effectAllowed = 'move'
        onSelect(slot)
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes(DRAG_TYPE)) {
          event.preventDefault()
          setIsOver(true)
        }
      }}
      onDragLeave={() => setIsOver(false)}
      onDrop={(event) => {
        event.preventDefault()
        setIsOver(false)
        const from = Number(event.dataTransfer.getData(DRAG_TYPE))
        if (Number.isInteger(from)) {
          onMove(from, slot)
        }
      }}
      title={item ? `${item.displayName} ×${item.count}` : placeholder}
      className={`relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-md border-2
        text-center transition ${
          isOver
            ? 'border-sky-300 bg-sky-900/40'
            : selected
              ? 'border-amber-400'
              : held
                ? 'border-sky-500'
                : 'border-neutral-800 hover:border-neutral-600'
        } ${item ? 'cursor-grab bg-neutral-900 active:cursor-grabbing' : 'cursor-default bg-neutral-950'}`}
    >
      {item ? (
        <>
          {icon ? (
            <ItemIcon icon={icon} alt={item.displayName} />
          ) : (
            <>
              <span
                className="pointer-events-none absolute inset-0 opacity-30"
                style={{ backgroundColor: blockColor(item.name) }}
                aria-hidden
              />
              <span
                className="pointer-events-none relative line-clamp-2 px-0.5 text-[0.5rem] leading-tight
                  text-neutral-100"
              >
                {item.displayName}
              </span>
            </>
          )}
          {item.count > 1 ? (
            <span
              className="pointer-events-none absolute bottom-0 right-0.5 text-[0.65rem] font-bold text-white
                drop-shadow"
            >
              {item.count}
            </span>
          ) : null}
        </>
      ) : placeholder ? (
        <span className="pointer-events-none text-[0.5rem] text-neutral-600">{placeholder}</span>
      ) : null}
    </button>
  )
}

type InventoryPageProps = {
  inventory: Inventory | null
  onClose: () => void
}

const InventoryPage: React.FC<InventoryPageProps> = ({ inventory, onClose }) => {
  const [selected, setSelected] = useState<number | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dropZoneActive, setDropZoneActive] = useState(false)

  const itemAt = useCallback(
    (slot: number): InventoryItem => {
      if (!inventory) return null
      if (slot >= HOTBAR_START && slot < HOTBAR_START + 9) return inventory.hotbar[slot - HOTBAR_START]
      if (slot >= MAIN_START && slot < HOTBAR_START) return inventory.main[slot - MAIN_START]
      if (slot === OFFHAND_SLOT) return inventory.offhand
      const armor = ARMOR_SLOTS.find((entry) => entry.slot === slot)
      return armor ? inventory.armor[armor.key] : null
    },
    [inventory]
  )

  const selectedItem = selected !== null ? itemAt(selected) : null
  const selectedIsHotbar = selected !== null && selected >= HOTBAR_START && selected < HOTBAR_START + 9

  const run = useCallback(async (action: InventoryAction) => {
    setIsBusy(true)
    setError(null)
    try {
      const response = await window.electronAPI.bot.inventoryAction(action)
      if (!response.ok) {
        setError(response.message ?? 'That did not work.')
      }
    } finally {
      setIsBusy(false)
    }
  }, [])

  const move = useCallback(
    (from: number, to: number) => {
      if (from === to) return
      setSelected(to)
      run({ type: 'move', from, to })
    },
    [run]
  )

  const drop = useCallback(
    (slot: number, all: boolean) => {
      run({ type: 'drop', slot, all })
    },
    [run]
  )

  // Clear the selection once the selected slot is emptied (dropped or moved away).
  useEffect(() => {
    if (selected !== null && !itemAt(selected)) {
      setSelected(null)
    }
  }, [itemAt, selected])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if ((event.key === 'q' || event.key === 'Q') && selected !== null && selectedItem && !isBusy) {
        drop(selected, event.shiftKey)
        return
      }
      const digit = Number(event.key)
      if (Number.isInteger(digit) && digit >= 1 && digit <= 9 && !isBusy) {
        // Like in game: a number key while an item is selected moves it to that hotbar slot.
        if (selected !== null && selectedItem) {
          move(selected, HOTBAR_START + digit - 1)
        } else {
          run({ type: 'hold', slot: HOTBAR_START + digit - 1 })
        }
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [drop, isBusy, move, onClose, run, selected, selectedItem])

  const slotProps = { onSelect: setSelected, onMove: move }

  return (
    <div className="fixed inset-x-0 bottom-0 top-12 z-40 flex flex-col overflow-y-auto bg-neutral-950">
      <button
        type="button"
        onClick={onClose}
        title="Close (Esc)"
        className="absolute right-3 top-3 rounded-full p-1.5 text-neutral-400 transition hover:bg-neutral-800
          hover:text-neutral-100"
      >
        <X className="h-4 w-4" />
      </button>

      {inventory ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-4">
          <div className="flex gap-3">
            <div className="flex flex-col gap-1">
              {ARMOR_SLOTS.map((entry) => (
                <Slot
                  key={entry.key}
                  slot={entry.slot}
                  item={inventory.armor[entry.key]}
                  selected={selected === entry.slot}
                  placeholder={entry.label}
                  {...slotProps}
                />
              ))}
            </div>
            <div className="flex flex-col justify-end">
              <div className="grid grid-cols-9 gap-1">
                {inventory.main.map((item, index) => (
                  <Slot
                    key={index}
                    slot={MAIN_START + index}
                    item={item}
                    selected={selected === MAIN_START + index}
                    {...slotProps}
                  />
                ))}
              </div>
              <div className="mt-2 grid grid-cols-9 gap-1">
                {inventory.hotbar.map((item, index) => (
                  <Slot
                    key={index}
                    slot={HOTBAR_START + index}
                    item={item}
                    selected={selected === HOTBAR_START + index}
                    held={index === inventory.selectedHotbar}
                    {...slotProps}
                  />
                ))}
              </div>
            </div>
            {/* Offhand sits beside the hotbar, like the shield slot in game. */}
            <div className="flex flex-col justify-end">
              <Slot
                slot={OFFHAND_SLOT}
                item={inventory.offhand}
                selected={selected === OFFHAND_SLOT}
                placeholder="Offhand"
                {...slotProps}
              />
            </div>

            <div className="flex w-36 flex-col gap-1.5">
              <span
                className="flex items-center gap-1.5 text-[0.65rem] uppercase tracking-[0.16em]
                  text-neutral-500"
              >
                {inventory.freeSlots} free slots
                {isBusy ? <LoaderCircle className="h-3 w-3 animate-spin" /> : null}
              </span>
              <span className="min-h-8 text-xs leading-snug text-neutral-300">
                {selectedItem ? (
                  <>
                    <span className="font-semibold text-neutral-100">{selectedItem.displayName}</span> ×
                    {selectedItem.count}
                  </>
                ) : (
                  <span className="text-neutral-500">Click an item to select it.</span>
                )}
              </span>
              <button
                type="button"
                disabled={!selectedItem || isBusy}
                onClick={() => selected !== null && drop(selected, false)}
                className="flex items-center gap-2 rounded-full border border-neutral-700 px-3 py-1 text-xs
                  font-semibold text-neutral-200 transition hover:border-neutral-500 disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Drop one
              </button>
              <button
                type="button"
                disabled={!selectedItem || isBusy}
                onClick={() => selected !== null && drop(selected, true)}
                className="flex items-center gap-2 rounded-full border border-red-900 bg-red-950/50 px-3 py-1
                  text-xs font-semibold text-red-200 transition hover:border-red-700 disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Drop stack
              </button>
              <button
                type="button"
                disabled={!selectedIsHotbar || isBusy}
                onClick={() => selected !== null && run({ type: 'hold', slot: selected })}
                className="flex items-center gap-2 rounded-full border border-sky-800 bg-sky-950/50 px-3 py-1
                  text-xs font-semibold text-sky-200 transition hover:border-sky-600 disabled:opacity-40"
              >
                <Hand className="h-3.5 w-3.5" />
                Hold
              </button>
              {error ? <p className="text-xs leading-snug text-red-400">{error}</p> : null}
            </div>
          </div>

          <div
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes(DRAG_TYPE)) {
                event.preventDefault()
                setDropZoneActive(true)
              }
            }}
            onDragLeave={() => setDropZoneActive(false)}
            onDrop={(event) => {
              event.preventDefault()
              setDropZoneActive(false)
              const from = Number(event.dataTransfer.getData(DRAG_TYPE))
              if (Number.isInteger(from)) {
                drop(from, true)
              }
            }}
            className={`flex h-11 w-full max-w-2xl items-center justify-center gap-2 rounded-lg border-2
              border-dashed text-xs transition ${
                dropZoneActive
                  ? 'border-red-400 bg-red-950/40 text-red-200'
                  : 'border-neutral-800 text-neutral-500'
              }`}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Drag an item here to drop it on the ground
          </div>

          <p className="max-w-2xl text-center text-[0.65rem] leading-snug text-neutral-500">
            Drag between slots to move or swap. Q drops one, Shift+Q the stack, 1–9 moves the selected item to
            that hotbar slot (or holds it when nothing is selected), Esc closes.
          </p>
        </div>
      ) : (
        <p className="p-6 text-sm text-neutral-500">Waiting for the bot to spawn…</p>
      )}
    </div>
  )
}

export default InventoryPage
