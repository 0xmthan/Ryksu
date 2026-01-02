const { plugin: toolPlugin } = require('mineflayer-tool')
const nbt = require('prismarine-nbt')

class AutoToolController {
  constructor() {
    this.bot = null
    this.desiredEnabled = false
    this.enabled = false
    this.blockBreakListener = null
  }

  attach(bot) {
    this.bot = bot
    if (this.desiredEnabled) {
      this._enable()
    }
  }

  detach() {
    if (this.bot) {
      this._disable()
    }
    this.bot = null
  }

  setEnabled(enabled) {
    this.desiredEnabled = Boolean(enabled)

    if (!this.bot) {
      return
    }

    if (this.desiredEnabled) {
      this._enable()
    } else {
      this._disable()
    }
  }

  isEnabled() {
    return this.desiredEnabled
  }

  async _ensurePlugin() {
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

  async _handleBlockBreak(block) {
    if (!this.desiredEnabled || !block) {
      return
    }

    if (!(await this._ensurePlugin()) || !this.bot?.tool) {
      return
    }

    try {
      await this.bot.tool.equipForBlock(block, {})
    } catch (error) {
      console.error('Failed to equip tool for block', error)
    }
  }

  _enable() {
    if (!this.bot || this.enabled) {
      return
    }

    if (!this.blockBreakListener) {
      this.blockBreakListener = (block) => {
        this._handleBlockBreak(block)
      }
    }

    this.bot.on('blockBreakStart', this.blockBreakListener)
    this.enabled = true
  }

  _disable() {
    if (!this.bot || !this.enabled) {
      return
    }

    if (this.blockBreakListener) {
      this.bot.removeListener('blockBreakStart', this.blockBreakListener)
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

    const heldSlot = this.bot.getEquipmentDestSlot('hand')
    const held = this.bot.inventory.slots?.[heldSlot]
    if (held && held.slot === bestWeapon.slot) {
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

  _selectBestWeapon() {
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

    candidates.sort((a, b) => this._weaponScore(b) - this._weaponScore(a))
    return candidates[0] ?? null
  }

  _isCombatWeapon(item) {
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

  _weaponScore(item) {
    if (!item || !this.bot?.registry) {
      return 0
    }

    const registryEntry = this.bot.registry.itemsByName?.[item.name]
    const baseDamage =
      typeof registryEntry?.attackDamage === 'number' ? registryEntry.attackDamage : 1

    const sharpnessBonus = this._getSharpnessBonus(item)
    const materialBonus = this._materialTierBonus(item.name)
    const typeBonus = item.name.endsWith('_sword') ? 0.1 : 0

    return baseDamage + sharpnessBonus + materialBonus + typeBonus
  }

  _materialTierBonus(name) {
    const tiers = ['wooden', 'golden', 'stone', 'iron', 'diamond', 'netherite']
    const match = tiers.findIndex((tier) => name.startsWith(tier))
    if (match === -1) {
      return 0
    }
    return match * 0.05
  }

  _getSharpnessBonus(item) {
    const level = this._getEnchantLevel(item, ['minecraft:sharpness', 'sharpness'])
    if (level <= 0) {
      return 0
    }
    return 0.5 + 0.5 * level
  }

  _getEnchantLevel(item, ids) {
    if (!item?.nbt) {
      return 0
    }

    try {
      const simplified = nbt.simplify(item.nbt)
      const enchantList = simplified?.Enchantments || simplified?.ench
      if (!Array.isArray(enchantList) || enchantList.length === 0) {
        return 0
      }

      for (const enchant of enchantList) {
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

module.exports = { AutoToolController }
