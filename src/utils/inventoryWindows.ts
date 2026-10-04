import type { InventoryWindow } from '../types'

const windowTitle = (raw: string) => {
  const read = (value: unknown): string => {
    if (typeof value === 'string') return value
    if (Array.isArray(value)) return value.map(read).join('')
    if (!value || typeof value !== 'object') return ''
    const component = value as { text?: string; translate?: string; extra?: unknown[] }
    const translated = component.translate?.startsWith('container.')
      ? component.translate.slice(10).replace(/[_\.]/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()) : ''
    return (component.text ?? translated) + (component.extra?.map(read).join('') ?? '')
  }
  try { return read(JSON.parse(raw)) } catch { return raw }
}

export const inventoryWindowLayout = (window: InventoryWindow) => {
  const type = window.type.replace('minecraft:', '')
  const crafting = type === 'crafting' || type === 'crafting_table'
  const anvil = type.includes('anvil')
  const storage = /generic|chest|container|shulker|hopper|dispenser|dropper/.test(type)
  const fallbackTitle = crafting ? 'Crafting' : anvil ? 'Anvil' :
    /generic_9|chest|container/.test(type) ? 'Chest' :
    type.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())
  const title = windowTitle(window.title) || fallbackTitle
  const result = window.resultSlot >= 0 ? window.resultSlot : null
  const inputs = Array.from({ length: window.inventoryStart }, (_, i) => i).filter(id => id !== result)
  return { title, crafting, anvil, storage, result, inputs,
    columns: crafting || /3x3|dispenser|dropper/.test(type) ? 3 : storage ? Math.min(9, inputs.length) : Math.min(5, inputs.length) }
}
