// What scripts can call, described for the editor's completions, hover help and the Scripts panel. The
// calls themselves are in src/main/scripts/scriptApi.ts (a test keeps the two in step).

// The bot's automatic features, which a running script pauses and can turn back on (see
// src/main/bot/automation.ts).
export const AUTOMATIONS = [
  'armorManager',
  'autoEat',
  'autoTool',
  'autoShield',
  'attackMobs',
  'attackPlayer',
  'follow',
  'creeperDodge',
  'autoSleep',
  'gestures',
  'tpaAccept',
] as const

export type Automation = (typeof AUTOMATIONS)[number]

export const AUTOMATION_LABELS: Record<Automation, string> = {
  armorManager: 'Wear the best armor',
  autoEat: 'Eat when hungry',
  autoTool: 'Hold the best tool',
  autoShield: 'Raise the shield',
  attackMobs: 'Attack mobs',
  attackPlayer: 'Attack the picked player',
  follow: 'Follow the picked player',
  creeperDodge: 'Run from creepers',
  autoSleep: 'Sleep when others do',
  gestures: 'Follow trusted players who sneak-jump 3 times',
  tpaAccept: 'Accept /tpa from trusted players',
}

export type ScriptCall = {
  name: string
  // How it's called, as shown in completions.
  signature: string
  doc: string
  // Returns a promise to await.
  waits?: boolean
}

export const SCRIPT_CALLS: ScriptCall[] = [
  { name: 'chat', signature: 'chat(text)', doc: 'Say something or run a command, like "/wp home".' },
  { name: 'wait', signature: 'wait(ms)', doc: 'Pause for a while.', waits: true },
  {
    name: 'waitForTeleport',
    signature: 'waitForTeleport({ timeout = 15000 })',
    doc: 'Until the server teleports the bot. Resolves with the new position.',
    waits: true,
  },
  {
    name: 'waitForChat',
    signature: 'waitForChat(text | /regex/, { timeout = 30000 })',
    doc: 'Until a server message contains the text (or matches the regex). Resolves with the message.',
    waits: true,
  },
  {
    name: 'onChat',
    signature: 'onChat((text) => { … })',
    doc: 'Runs for every server message while the script is on. Returns a function that stops it.',
  },
  {
    name: 'goto',
    signature: 'goto({ x, y, z }, { range = 1 })',
    doc: 'Walks to the position, within range blocks.',
    waits: true,
  },
  { name: 'stopMoving', signature: 'stopMoving()', doc: 'Stops walking.' },
  {
    name: 'sneak',
    signature: 'sneak(on = true)',
    doc: "Holds sneak (or lets go with sneak(false)), even while walking, until the script turns off. Sneaking, the bot won't step off ledges.",
  },
  {
    name: 'blockAt',
    signature: 'blockAt({ x, y, z })',
    doc: 'The block there: { x, y, z, name, properties }, or null where the world is not loaded.',
  },
  {
    name: 'findBlocks',
    signature: "findBlocks('wheat', { maxDistance = 32, count = 4096, properties: { age: 7 } })",
    doc: 'Blocks with that name near the bot, nearest first. properties must all match (age 7 is ripe wheat).',
  },
  {
    name: 'dig',
    signature: 'dig({ x, y, z })',
    doc: 'Walks within reach of the block and breaks it.',
    waits: true,
  },
  {
    name: 'digAll',
    signature: "digAll(blocks, { order: 'nearest' | 'rows' })",
    doc: "Breaks all the blocks (like findBlocks gives): everything in reach first, then on to the next, the nearest or row by row like a snake ('rows', for fields). Resolves with { dug, skipped }.",
    waits: true,
  },
  {
    name: 'useItemOn',
    signature: "useItemOn({ x, y, z }, 'wheat_seeds')",
    doc: "Walks within reach and uses the item on the block's top, like planting seeds on farmland.",
    waits: true,
  },
  {
    name: 'useItemOnAll',
    signature: "useItemOnAll(blocks, 'wheat_seeds', { order: 'nearest' | 'rows' })",
    doc: 'Uses the item on the top of all the blocks, like planting a whole field, in the same way as digAll, until it runs out. Resolves with { used, skipped }.',
    waits: true,
  },
  {
    name: 'collectDrops',
    signature: 'collectDrops({ radius = 8 })',
    doc: 'Picks up the dropped items around the bot.',
    waits: true,
  },
  { name: 'inventory', signature: 'inventory()', doc: 'What the bot carries: [{ name, count }, …].' },
  { name: 'freeSlots', signature: 'freeSlots()', doc: 'How many inventory slots are empty.' },
  {
    name: 'deposit',
    signature: "deposit({ x, y, z }, { only: ['wheat'], keep: { wheat_seeds: 64 } })",
    doc: 'Walks to the chest there and puts items in: only those named (all when left out), keeping some. Resolves with how many went in.',
    waits: true,
  },
  {
    name: 'withdraw',
    signature: 'withdraw({ x, y, z }, { wheat_seeds: 64 })',
    doc: 'Walks to the chest there and takes up to that many of each item. Resolves with how many it took.',
    waits: true,
  },
  {
    name: 'exit',
    signature: 'exit(reason)',
    doc: 'Turns the script off (its stop() runs), writing the reason to the log.',
  },
  { name: 'position', signature: 'position()', doc: "The bot's position: { x, y, z }." },
  { name: 'vitals', signature: 'vitals()', doc: "The bot's health and food: { health, food }." },
  {
    name: 'toggles',
    signature: 'toggles()',
    doc: 'Each automatic feature: { autoEat: { on, yours }, … }. on: running now; yours: what you picked.',
  },
  {
    name: 'setToggle',
    signature: "setToggle('autoEat', true)",
    doc: 'Turns an automatic feature on or off while the script runs.',
  },
  {
    name: 'hideWorld',
    signature: 'hideWorld()',
    doc: "Stops drawing the world and shows the script's name, a Turn off button and the log instead. The world comes back when the script turns off.",
  },
  { name: 'showWorld', signature: 'showWorld()', doc: 'Draws the world again.' },
  {
    name: 'notify',
    signature: 'notify(text)',
    doc: "Shows a desktop notification with the script's name, and writes it to the log.",
  },
  { name: 'status', signature: 'status(text)', doc: 'Shows what the script is doing, next to its name.' },
  { name: 'log', signature: 'log(...values)', doc: "Writes a line to the scripts' log." },
]
