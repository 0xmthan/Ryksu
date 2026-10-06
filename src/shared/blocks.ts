// Whether a block state property is on. Depending on where the block came from, its properties are
// booleans or the strings the protocol sends.
export const isTrue = (value: unknown) => value === true || value === 'true'
