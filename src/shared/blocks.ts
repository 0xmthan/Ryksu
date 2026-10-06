// Facts about blocks that both the bot and the watcher need.

// Whether a block state property is on. Depending on where the block came from, its properties are
// booleans or the strings the protocol sends.
export const isTrue = (value: unknown) => value === true || value === 'true'

// A door the bot can open by hand (any wood, iron or copper door; not trapdoors). `door` and `wooden_door`
// are the names before 1.13.
export const isDoorBlock = (name: unknown) =>
  typeof name === 'string' &&
  (name.endsWith('_door') || name === 'door' || name === 'wooden_door') &&
  !name.endsWith('trapdoor')
