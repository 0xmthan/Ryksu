// Which texture variant a mob shows, decoded from its metadata into the names the watcher's textures use
// (scripts/assets/mobVariants.js). Most are plain enums; cats, wolves, pigs, cows and chickens point into
// registries the server sends while joining, whose order entityEvents.js records.
import type { Bot } from 'mineflayer'
import { registryOrder } from './entityEvents'

// DyeColor texture colors, by dye id.
const DYE_COLORS = [
  '#f9fffe',
  '#f9801d',
  '#c74ebd',
  '#3ab3da',
  '#fed83d',
  '#80c71f',
  '#f38baa',
  '#474f52',
  '#9d9d97',
  '#169c9c',
  '#8932b8',
  '#3c44aa',
  '#835432',
  '#5e7c16',
  '#b02e26',
  '#1d1d21',
]
const HORSE_COLORS = ['white', 'creamy', 'chestnut', 'brown', 'black', 'gray', 'darkbrown']
const HORSE_MARKINGS = [null, 'white', 'whitefield', 'whitedots', 'blackdots']
const RABBIT_TYPES: Record<number, string> = {
  0: 'brown',
  1: 'white',
  2: 'black',
  3: 'white_splotched',
  4: 'gold',
  5: 'salt',
  99: 'caerbannog',
}
const LLAMA_TYPES = ['creamy', 'white', 'brown', 'gray']
const PARROT_TYPES = ['red_blue', 'blue', 'green', 'yellow_blue', 'grey']
const FOX_TYPES = ['red', 'snow']
const MOOSHROOM_TYPES = ['red', 'brown']
const PANDA_GENES = ['normal', 'lazy', 'worried', 'playful', 'brown', 'weak', 'aggressive']
// Brown and weak only show when both genes carry them.
const RECESSIVE_GENES = new Set(['brown', 'weak'])

// Registry-backed variants: [registry, vanilla's entries sorted the way the server sends them when it
// doesn't say otherwise, the default]. The server leaves out values still at their default, so a mob with
// no variant in its metadata has the default one (a tuxedo cat is the default "black").
const REGISTRY_VARIANTS: Record<string, [registry: string, fallback: string[], defaultVariant: string]> = {
  cat: [
    'cat_variant',
    [
      'all_black',
      'black',
      'british_shorthair',
      'calico',
      'jellie',
      'persian',
      'ragdoll',
      'red',
      'siamese',
      'tabby',
      'white',
    ],
    'black',
  ],
  wolf: [
    'wolf_variant',
    ['ashen', 'black', 'chestnut', 'pale', 'rusty', 'snowy', 'spotted', 'striped', 'woods'],
    'pale',
  ],
  pig: ['pig_variant', ['cold', 'temperate', 'warm'], 'temperate'],
  cow: ['cow_variant', ['cold', 'temperate', 'warm'], 'temperate'],
  chicken: ['chicken_variant', ['cold', 'temperate', 'warm'], 'temperate'],
}

// Metadata ids arrive as numbers, or for some types as { id } or a "minecraft:name" string.
const asId = (value: unknown): unknown =>
  typeof value === 'object' && value
    ? ((value as { id?: unknown; value?: unknown }).id ?? (value as { value?: unknown }).value)
    : value
const fromList = (
  list: readonly (string | null)[] | Record<number, string>,
  value: unknown
): string | null => {
  const id = asId(value)
  if (typeof id === 'string') return id.replace(/^minecraft:/, '')
  return typeof id === 'number' ? ((list as Record<number, string | null>)[id] ?? null) : null
}

// { variant, markings, wool } for mobs that have them; `read(key)` gets a metadata value by name and
// `typed` holds values by metadata type (cat_variant, …).
export type EntityVariant = {
  variant?: string
  markings?: string
  wool?: string | null
  shearedColor?: string
}

export const entityVariant = (
  bot: Bot,
  type: string,
  read: (key: string) => unknown,
  typed: Record<string, unknown> = {}
): EntityVariant => {
  if (REGISTRY_VARIANTS[type]) {
    const [registry, fallback, defaultVariant] = REGISTRY_VARIANTS[type]
    const raw = typed[registry] ?? read('variant')
    const variant = raw == null ? defaultVariant : fromList(registryOrder(bot, registry) ?? fallback, raw)
    return variant ? { variant } : {}
  }
  switch (type) {
    case 'horse': {
      const value = asId(read('type_variant'))
      if (typeof value !== 'number') return {}
      const markings = HORSE_MARKINGS[(value >> 8) & 0xff]
      return { variant: HORSE_COLORS[value & 0xff] ?? 'white', ...(markings ? { markings } : {}) }
    }
    case 'rabbit':
      return { variant: fromList(RABBIT_TYPES, read('type')) ?? 'brown' }
    case 'llama':
    case 'trader_llama':
      return { variant: fromList(LLAMA_TYPES, read('variant')) ?? 'creamy' }
    case 'parrot':
      return { variant: fromList(PARROT_TYPES, read('variant')) ?? 'red_blue' }
    case 'fox':
      return { variant: fromList(FOX_TYPES, read('type')) ?? 'red' }
    case 'mooshroom':
      return { variant: fromList(MOOSHROOM_TYPES, read('type')) ?? 'red' }
    case 'panda': {
      const main = fromList(PANDA_GENES, read('main_gene')) ?? 'normal'
      const hidden = fromList(PANDA_GENES, read('hidden_gene'))
      return { variant: RECESSIVE_GENES.has(main) && hidden !== main ? 'normal' : main }
    }
    case 'sheep': {
      const wool = asId(read('wool'))
      if (typeof wool !== 'number') return {}
      // Low four bits are the dye; bit 4 means sheared.
      const color = DYE_COLORS[wool & 0x0f]
      return { wool: wool & 0x10 ? null : color, shearedColor: wool & 0x10 ? color : undefined }
    }
    default:
      return {}
  }
}
