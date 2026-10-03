// Texture variants for mobs, by the variant names the bot side sends (see src/bot/entityVariants.js).
// Paths are relative to the minecraft-assets data folder. Each must fit the same old geometry as the
// mob's base texture, which is why some come from older versions (cats, rabbits and llamas were
// redrawn in 26.1; warm and cold cows got a new model in 1.21.5, so cows have no variants here).
const named = (names, file) => Object.fromEntries(names.map((name) => [name, file(name)]))

const VARIANTS = {
  cat: named(
    [
      'tabby',
      'black',
      'red',
      'siamese',
      'british_shorthair',
      'calico',
      'persian',
      'ragdoll',
      'white',
      'jellie',
      'all_black',
    ],
    (name) => `1.21.11/entity/cat/${name}`
  ),
  wolf: {
    pale: '26.1/entity/wolf/wolf',
    ...named(
      ['spotted', 'snowy', 'black', 'ashen', 'rusty', 'woods', 'chestnut', 'striped'],
      (name) => `26.1/entity/wolf/wolf_${name}`
    ),
  },
  horse: named(
    ['white', 'creamy', 'chestnut', 'brown', 'black', 'gray', 'darkbrown'],
    (name) => `26.1/entity/horse/horse_${name}`
  ),
  rabbit: named(
    ['brown', 'white', 'black', 'white_splotched', 'gold', 'salt', 'caerbannog', 'toast'],
    (name) => `1.21.11/entity/rabbit/${name}`
  ),
  llama: named(['creamy', 'white', 'brown', 'gray'], (name) => `1.21.11/entity/llama/${name}`),
  parrot: named(
    ['red_blue', 'blue', 'green', 'yellow_blue', 'grey'],
    (name) => `26.1/entity/parrot/parrot_${name}`
  ),
  fox: { red: '26.1/entity/fox/fox', snow: '26.1/entity/fox/fox_snow' },
  mooshroom: named(['red', 'brown'], (name) => `1.21.11/entity/cow/${name}_mooshroom`),
  panda: {
    normal: '26.1/entity/panda/panda',
    ...named(
      ['lazy', 'worried', 'playful', 'brown', 'weak', 'aggressive'],
      (name) => `26.1/entity/panda/panda_${name}`
    ),
  },
  pig: named(['temperate', 'warm', 'cold'], (name) => `1.21.5/entity/pig/${name}_pig`),
  chicken: named(['temperate', 'warm', 'cold'], (name) => `1.21.5/entity/chicken/${name}_chicken`),
}

// Horse coat patterns, drawn over the coat color.
const HORSE_MARKINGS = named(
  ['white', 'whitefield', 'whitedots', 'blackdots'],
  (name) => `26.1/entity/horse/horse_markings_${name}`
)

// Villager outfits: a biome layer and a profession layer drawn over the base skin, in the order of the
// game's registries (the ids the server sends).
const VILLAGER_TYPES = ['desert', 'jungle', 'plains', 'savanna', 'snow', 'swamp', 'taiga']
const PROFESSIONS = [
  'none',
  'armorer',
  'butcher',
  'cartographer',
  'cleric',
  'farmer',
  'fisherman',
  'fletcher',
  'leatherworker',
  'librarian',
  'mason',
  'nitwit',
  'shepherd',
  'toolsmith',
  'weaponsmith',
]

module.exports = { VARIANTS, HORSE_MARKINGS, VILLAGER_TYPES, PROFESSIONS }
