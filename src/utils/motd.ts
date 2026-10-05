// Splits text with Minecraft § formatting codes into styled runs: the 16 colors, hex colors (§#rrggbb and
// the §x§r§r§g§g§b§b form), bold, italic, underline, strikethrough, obfuscated and reset.
export type MotdSegment = {
  text: string
  color: string | null
  bold: boolean
  italic: boolean
  underlined: boolean
  strikethrough: boolean
  obfuscated: boolean
}

export const MOTD_COLORS: Record<string, string> = {
  '0': '#000000',
  '1': '#0000aa',
  '2': '#00aa00',
  '3': '#00aaaa',
  '4': '#aa0000',
  '5': '#aa00aa',
  '6': '#ffaa00',
  '7': '#aaaaaa',
  '8': '#555555',
  '9': '#5555ff',
  a: '#55ff55',
  b: '#55ffff',
  c: '#ff5555',
  d: '#ff55ff',
  e: '#ffff55',
  f: '#ffffff',
}

const PLAIN = { color: null, bold: false, italic: false, underlined: false, strikethrough: false, obfuscated: false }
const TOKEN = /§#([0-9a-f]{6})|§x((?:§[0-9a-f]){6})|§([0-9a-fk-or])/gi

export const parseMotd = (value: string): MotdSegment[] => {
  const segments: MotdSegment[] = []
  let style: Omit<MotdSegment, 'text'> = { ...PLAIN }
  let last = 0
  const push = (text: string) => {
    if (text) segments.push({ text, ...style })
  }

  for (const match of value.matchAll(TOKEN)) {
    push(value.slice(last, match.index))
    last = match.index + match[0].length
    const [, hex, spread, code] = match
    if (hex || spread) {
      style = { ...PLAIN, color: `#${hex ?? spread.replace(/§/g, '')}` }
      continue
    }
    const key = code.toLowerCase()
    if (key in MOTD_COLORS) style = { ...PLAIN, color: MOTD_COLORS[key] }
    else if (key === 'r') style = { ...PLAIN }
    else if (key === 'l') style = { ...style, bold: true }
    else if (key === 'o') style = { ...style, italic: true }
    else if (key === 'n') style = { ...style, underlined: true }
    else if (key === 'm') style = { ...style, strikethrough: true }
    else if (key === 'k') style = { ...style, obfuscated: true }
  }
  push(value.slice(last))
  return segments
}
