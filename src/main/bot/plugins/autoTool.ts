import type { Block } from 'prismarine-block'
import type { Item } from 'prismarine-item'
import * as nbt from 'prismarine-nbt'
import { plugin as toolPlugin } from '../vendor/tool'
import { ToggleablePlugin } from './toggleablePlugin'

type Enchant = { id?: string | { text?: string }; lvl?: unknown; Lvl?: unknown; level?: unknown }

export class AutoToolController extends ToggleablePlugin {
  private blockBreakListener: ((block: Block) => void) | null

  constructor() {
    super()
    this.blockBreakListener = null
  }

  async ensurePlugin() {
    if (!this.bot) {
      return false
    }

    if (!this.bot.tool) {
      try {
        this.bot.loadPlugin(toolPlugin)
      } catch (error) {
        console.error('Failed to load auto tool plugin', error)
        return false
      }
    }

    return Boolean(this.bot.tool)
  }

  private async _handleBlockBreak(block: Block) {
    if (!this.desiredEnabled || !block) {
      return
    }

    if (!(await this.ensurePlugin()) || !this.bot?.tool) {
      return
    }

    try {
      await this.bot.tool.equipForBlock(block, {})
    } catch (error) {
      console.error('Failed to equip tool for block', error)
    }
  }

  protected _enable() {
    if (!this.bot || this.enabled) {
      return
    }

    if (!this.blockBreakListener) {
      this.blockBreakListener = (block) => {
        this._handleBlockBreak(block)
      }
    }

    this.bot.on('blockBreakStart' as never, this.blockBreakListener as never)
    this.enabled = true
  }

  protected _disable() {
    if (!this.bot || !this.enabled) {
      return
    }

    if (this.blockBreakListener) {
      this.bot.removeListener('blockBreakStart' as never, this.blockBreakListener as never)
      this.blockBreakListener = null
    }

    this.enabled = false
  }

  async equipBestWeapon() {
    if (!this.desiredEnabled || !this.bot?.inventory) {
      return false
    }

    const bestWeapon = this._selectBestWeapon()
    if (!bestWeapon) {
      return false
    }

    // Already holding it, or one as good: equipping another would pull it out of the inventory into the
    // hotbar and move the selected slot, every attack.
    const held = this.bot.heldItem
    if (
      held &&
      this._isCombatWeapon(held) &&
      (held.slot === bestWeapon.slot || this._weaponScore(held) >= this._weaponScore(bestWeapon))
    ) {
      return true
    }

    try {
      await this.bot.equip(bestWeapon, 'hand')
      return true
    } catch (error) {
      console.error('Failed to equip combat weapon', error)
      return false
    }
  }

  private _selectBestWeapon() {
    if (!this.bot?.inventory) {
      return null
    }

    const items = this.bot.inventory.items()
    if (!Array.isArray(items) || items.length === 0) {
      return null
    }

    const candidates = items.filter((item) => this._isCombatWeapon(item))
    if (candidates.length === 0) {
      return null
    }

    // Among equally good ones, the one in hand, then one already in the hotbar (the main inventory lists first).
    const heldSlot = this.bot.heldItem?.slot
    const hotbarStart = this.bot.inventory.hotbarStart
    const nearness = (item: Item) => (item.slot === heldSlot ? 0 : item.slot >= hotbarStart ? 1 : 2)
    candidates.sort((a, b) => this._weaponScore(b) - this._weaponScore(a) || nearness(a) - nearness(b))
    return candidates[0] ?? null
  }

  private _isCombatWeapon(item: Item | null | undefined) {
    if (!item?.name) {
      return false
    }

    return (
      item.name.endsWith('_sword') ||
      item.name.endsWith('_axe') ||
      item.name === 'trident' ||
      item.name === 'mace' ||
      item.name.endsWith('_mace')
    )
  }

  private _weaponScore(item: Item) {
    if (!item || !this.bot?.registry) {
      return 0
    }

    const registryEntry = this.bot.registry.itemsByName?.[item.name]
    const attackDamage = (registryEntry as { attackDamage?: unknown } | undefined)?.attackDamage
    const baseDamage = typeof attackDamage === 'number' ? attackDamage : 1

    const sharpnessBonus = this._getSharpnessBonus(item)
    const materialBonus = this._materialTierBonus(item.name)
    const typeBonus = item.name.endsWith('_sword') ? 0.1 : 0

    return baseDamage + sharpnessBonus + materialBonus + typeBonus
  }

  private _materialTierBonus(name: string) {
    const tiers = ['wooden', 'golden', 'stone', 'iron', 'diamond', 'netherite']
    const match = tiers.findIndex((tier) => name.startsWith(tier))
    if (match === -1) {
      return 0
    }
    return match * 0.05
  }

  private _getSharpnessBonus(item: Item) {
    const level = this._getEnchantLevel(item, ['minecraft:sharpness', 'sharpness'])
    if (level <= 0) {
      return 0
    }
    return 0.5 + 0.5 * level
  }

  private _getEnchantLevel(item: Item, ids: string[]) {
    if (!item?.nbt) {
      return 0
    }

    try {
      const simplified = nbt.simplify(item.nbt)
      const enchantList = simplified?.Enchantments || simplified?.ench
      if (!Array.isArray(enchantList) || enchantList.length === 0) {
        return 0
      }

      for (const enchant of enchantList as Enchant[]) {
        const enchantId = typeof enchant?.id === 'string' ? enchant.id : enchant?.id?.text
        if (enchantId && ids.includes(enchantId)) {
          const lvl = Number(enchant?.lvl ?? enchant?.Lvl ?? enchant?.level ?? 0)
          if (Number.isFinite(lvl)) {
            return lvl
          }
        }
      }
    } catch (error) {
      console.error('Failed to read enchant data for weapon', error)
    }

    return 0
  }
}
