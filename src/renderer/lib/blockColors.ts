// Rough map colors for block names; first matching rule wins.
const RULES: [RegExp, string][] = [
  [/diamond_ore/, '#4ee6e0'],
  [/emerald_ore/, '#22d36b'],
  [/gold_ore/, '#f5c542'],
  [/iron_ore/, '#d8a47f'],
  [/copper_ore/, '#e07a4a'],
  [/redstone_ore/, '#e0322c'],
  [/lapis_ore/, '#2f5fd8'],
  [/coal_ore/, '#1a1a1a'],
  [/quartz_ore/, '#efe6dc'],
  [/ancient_debris/, '#7a4e3a'],
  [/chest|barrel/, '#b07a2e'],
  [/_bed$/, '#c23a3a'],
  [/lava/, '#ff7a1a'],
  [/water|bubble_column|kelp|seagrass/, '#2f6fdc'],
  [/ice/, '#9cc6ff'],
  [/snow/, '#f4f8ff'],
  [/grass_block|moss/, '#5c9e3a'],
  [/leaves/, '#3e7a2a'],
  [/short_grass|tall_grass|fern|flower|tulip|poppy|dandelion|bush/, '#6db34a'],
  [/_log|_wood|stem|hyphae/, '#6b4a2b'],
  [/planks|crafting_table|bookshelf|fence|door|trapdoor/, '#a8834d'],
  [/red_sand/, '#c0672c'],
  [/sandstone|sand$|suspicious_sand/, '#dccf98'],
  [/gravel/, '#8a8580'],
  [/clay|terracotta/, '#a46a50'],
  [/dirt|farmland|path|podzol|mud|rooted/, '#866043'],
  [/deepslate|tuff|basalt|blackstone/, '#4a4a50'],
  [/bedrock/, '#2a2a2a'],
  [/obsidian/, '#2a1a40'],
  [/netherrack|nether_/, '#7a2e2e'],
  [/soul_/, '#4e3c30'],
  [/end_stone/, '#dcdca0'],
  [/torch|lantern|glowstone|shroomlight/, '#ffd866'],
  [/wool|carpet|concrete|glass/, '#c8c8d0'],
  [/rail/, '#9a8a70'],
  [/cobble|stone|andesite|diorite|granite|calcite/, '#7d7d7d'],
]

const cache = new Map<string, string>()

export const blockColor = (name: string): string => {
  const cached = cache.get(name)
  if (cached) {
    return cached
  }
  const color = RULES.find(([pattern]) => pattern.test(name))?.[1] ?? '#9a9aa6'
  cache.set(name, color)
  return color
}

export const prettyName = (name: string) =>
  name.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
