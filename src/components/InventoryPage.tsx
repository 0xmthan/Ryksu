import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { InventoryAction, InventoryClick, InventoryItem, WorldView } from '../types'
import { itemIcon } from '../utils/itemIcons'
import ItemIcon from './ItemIcon'
import Item, { isEnchanted } from './ItemStack'
import InventoryPlayer from './InventoryPlayer'
import './inventory.css'
import { inventoryWindowLayout } from '../utils/inventoryWindows'

type Inventory = WorldView['inventory']
const ARMOR = ['Helmet', 'Chestplate', 'Leggings', 'Boots']
const EMPTY_ICONS: Record<string, string> = {
  Helmet: 'iron_helmet',
  Chestplate: 'iron_chestplate',
  Leggings: 'iron_leggings',
  Boots: 'iron_boots',
  Shield: 'shield',
}

const InventoryPage: React.FC<{ inventory: Inventory | null; onClose: () => void }> = ({
  inventory,
  onClose,
}) => {
  const container = inventory?.window ?? null
  const layout = container ? inventoryWindowLayout(container) : null
  const mainStart = container?.inventoryStart ?? 9
  const resultSlot = container?.resultSlot ?? 0
  const openedId = useRef(container?.id ?? 0)
  const [anvilName, setAnvilName] = useState('')
  const [mouse, setMouse] = useState({ x: 0, y: 0 })
  const [hover, setHover] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragSlots, setDragSlots] = useState<number[]>([])
  const gesture = useRef<{ button: number; slots: number[] } | null>(null)
  const queue = useRef(Promise.resolve())
  const latest = useRef(inventory)
  latest.current = inventory
  const run = useCallback((action: InventoryAction) => {
    if (action.type === 'click') action = { ...action, windowId: latest.current?.window?.id ?? 0 }
    queue.current = queue.current.then(async () => {
      try {
        const result = await window.electronAPI.bot.inventoryAction(action)
        setError(result.ok ? null : (result.message ?? 'Could not move that item.'))
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Inventory action failed.')
      }
    })
  }, [])
  // Finish pending gestures before closing, so no cursor stack remains stranded.
  useEffect(
    () => () => {
      queue.current = queue.current
        .then(async () => {
          await window.electronAPI.bot.inventoryAction({ type: 'close', windowId: openedId.current })
        })
        .catch(() => {})
    },
    []
  )
  const click = useCallback(
    (slot: number, button = 0, mode: InventoryClick['mode'] = 0) => {
      run({ type: 'click', clicks: [{ slot, button, mode }] })
    },
    [run]
  )
  const itemAt = (slot: number): InventoryItem => {
    if (!inventory) return null
    if (container) return container.slots[slot] ?? null
    if (slot === 0) return inventory.craftingResult
    if (slot < 5) return inventory.crafting[slot - 1] ?? null
    if (slot < 9) return inventory.armor[(['head', 'torso', 'legs', 'feet'] as const)[slot - 5]]
    if (slot < 36) return inventory.main[slot - 9] ?? null
    if (slot < 45) return inventory.hotbar[slot - 36] ?? null
    return inventory.offhand
  }
  useEffect(() => {
    const finish = () => {
      const drag = gesture.current
      gesture.current = null
      setDragSlots([])
      if (!drag) return
      const count = latest.current?.cursor?.count ?? 0
      if (drag.slots.length === 1) {
        click(drag.slots[0], drag.button)
        return
      }
      // Prismarine does not implement native drag mode: use ordinary right clicks
      // to distribute evenly (left drag), or place one per slot (right drag).
      const perSlot = drag.button === 1 ? 1 : Math.floor(count / drag.slots.length)
      let remaining = count
      const clicks: InventoryClick[] = []
      for (const slot of drag.slots) {
        for (let n = 0; n < perSlot && remaining > 0; n++, remaining--)
          clicks.push({ slot, button: 1, mode: 0 })
      }
      if (clicks.length) run({ type: 'click', clicks })
    }
    const key = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
      const typing =
        event.target instanceof HTMLElement &&
        event.target.closest('input, textarea, [contenteditable="true"]')
      if (event.code === 'Escape' || (!typing && event.code === 'KeyE')) {
        event.preventDefault()
        event.stopImmediatePropagation()
        onClose()
        return
      }
      if (typing || hover === null) return
      if (event.code === 'KeyQ') {
        event.preventDefault()
        click(hover, event.shiftKey ? 1 : 0, 4)
      }
      if (/^Digit[1-9]$/.test(event.code)) {
        event.preventDefault()
        click(hover, Number(event.code.slice(-1)) - 1, 2)
      }
    }
    const cancel = () => {
      gesture.current = null
      setDragSlots([])
    }
    window.addEventListener('mouseup', finish)
    window.addEventListener('blur', cancel)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mouseup', finish)
      window.removeEventListener('blur', cancel)
      window.removeEventListener('keydown', key)
    }
  }, [click, hover, onClose, run])
  const slot = (id: number, placeholder?: string, extra = '') => {
    const item = itemAt(id)
    const ghost = placeholder ? itemIcon(EMPTY_ICONS[placeholder]) : null
    return (
      <button
        key={id}
        type="button"
        data-slot={id}
        aria-label={`${placeholder ?? `Slot ${id}`}${item ? `: ${item.displayName}, ${item.count}` : ': empty'}`}
        className={`mc-slot ${dragSlots.includes(id) ? 'mc-slot-drag' : ''} ${extra}`}
        onFocus={() => setHover(id)}
        onClick={(event) => {
          if (event.detail === 0) click(id)
        }}
        onMouseEnter={() => {
          setHover(id)
          const drag = gesture.current
          if (
            drag &&
            id !== resultSlot &&
            !drag.slots.includes(id) &&
            (!item || item.name === inventory?.cursor?.name)
          ) {
            drag.slots.push(id)
            setDragSlots([...drag.slots])
          }
        }}
        onMouseLeave={() => setHover(null)}
        onMouseDown={(event) => {
          if (event.button > 1) return
          event.preventDefault()
          event.stopPropagation()
          if (event.shiftKey) {
            click(id, event.button, 1)
            return
          }
          if (inventory?.cursor && id !== resultSlot && (!item || item.name === inventory.cursor.name)) {
            gesture.current = { button: event.button, slots: [id] }
            setDragSlots([id])
          } else click(id, event.button)
        }}
      >
        <Item item={item} />
        {!item && placeholder && (
          <span className="mc-placeholder">
            {ghost ? <ItemIcon icon={ghost} alt={placeholder} /> : placeholder}
          </span>
        )}
      </button>
    )
  }
  useEffect(() => {
    if (layout?.anvil) setAnvilName(container?.slots[0]?.displayName ?? '')
  }, [container?.id, container?.slots[0]?.displayName, layout?.anvil])
  const hovered = hover === null ? null : itemAt(hover)
  return (
    <div
      className="mc-inventory-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Inventory"
      onContextMenu={(event) => event.preventDefault()}
      onMouseMove={(event) => setMouse({ x: event.clientX, y: event.clientY })}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && event.button <= 1 && inventory?.cursor)
          click(-999, event.button)
      }}
    >
      {inventory ? (
        <div className="mc-inventory-panel">
          {container && layout ? (
            <div className="mc-container-upper">
              <div className="mc-container-title">{layout.title}</div>
              {layout.anvil && (
                <input
                  className="mc-anvil-name"
                  aria-label="Anvil item name"
                  placeholder="Item name"
                  maxLength={35}
                  value={anvilName}
                  onChange={(event) => {
                    setAnvilName(event.target.value)
                    run({ type: 'rename', name: event.target.value, windowId: container.id })
                  }}
                />
              )}
              <div className={`mc-container-row ${layout.storage ? 'mc-storage-row' : ''}`}>
                <div
                  className="mc-container-grid"
                  style={{ gridTemplateColumns: `repeat(${layout.columns}, 40px)` }}
                >
                  {layout.inputs.map((id) => slot(id))}
                </div>
                {layout.result !== null && (
                  <>
                    <span className="mc-arrow" aria-hidden>
                      ➜
                    </span>
                    {slot(layout.result, undefined, 'mc-result')}
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="mc-upper">
              <div className="mc-armor">{ARMOR.map((label, i) => slot(5 + i, label))}</div>
              <InventoryPlayer />
              <div className="mc-offhand">{slot(45, 'Shield')}</div>
              <div className="mc-crafting">
                <span className="mc-label">Crafting</span>
                <div className="mc-crafting-row">
                  <div className="mc-crafting-grid">{[1, 2, 3, 4].map((id) => slot(id))}</div>
                  <span className="mc-arrow" aria-hidden>
                    ➜
                  </span>
                  {slot(0, undefined, 'mc-result')}
                </div>
              </div>
            </div>
          )}
          <div className="mc-main">{Array.from({ length: 27 }, (_, i) => slot(mainStart + i))}</div>
          <div className="mc-hotbar">{Array.from({ length: 9 }, (_, i) => slot(mainStart + 27 + i))}</div>
          {error && (
            <div className="mc-error" role="alert">
              {error}
            </div>
          )}
        </div>
      ) : (
        <p>Waiting for the bot to spawn…</p>
      )}
      {hovered && !inventory?.cursor && (
        <div
          className="mc-tooltip"
          style={{
            left: Math.min(mouse.x + 16, window.innerWidth - 230),
            top: Math.min(mouse.y - 28, window.innerHeight - 65),
          }}
        >
          <b className={`font-normal ${isEnchanted(hovered) ? 'text-cyan-300' : ''}`}>
            {hovered.displayName}
          </b>
          {hovered.enchantments?.map((enchantment) => (
            <em
              key={enchantment.label}
              className={`mc-tooltip-line ${enchantment.curse ? 'text-rose-400' : ''}`}
            >
              {enchantment.label}
            </em>
          ))}
          {hovered.durability ? (
            <em className="mc-tooltip-line">
              Durability {hovered.durability.max - hovered.durability.used} / {hovered.durability.max}
            </em>
          ) : null}
          <span>{hovered.name}</span>
        </div>
      )}
      {inventory?.cursor && (
        <div className="mc-cursor" style={{ left: mouse.x - 16, top: mouse.y - 16 }}>
          <Item item={inventory.cursor} />
        </div>
      )}
    </div>
  )
}
export default InventoryPage
