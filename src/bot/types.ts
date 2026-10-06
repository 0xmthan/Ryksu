// Fields set at runtime that mineflayer's typings leave out, and the ones Ryksu keeps on the bot itself.
import type { Slice } from './worldView'
import type { BlocksData } from './worldCompute'

declare module 'prismarine-entity' {
  interface Entity {
    eyeHeight?: number
    isCollidedHorizontally?: boolean
  }
}

declare module 'mineflayer' {
  interface Bot {
    parseBedMetadata(block: import('prismarine-block').Block): { occupied?: boolean } | undefined
    // The 3D view's dirty state (see readSlice in worldView.ts): "x,y,z" of changed blocks, "cx,cz" of
    // chunk columns that loaded or unloaded, and whether everything needs reading again.
    _worldChanges?: Set<string>
    _worldChunks?: Set<string>
    _worldDirty?: boolean
    _worldFullDirty?: boolean
    // Blocks out from the bot the view covers (the render distance).
    _worldRadius?: number
    _worldSlice?: { origin: { x: number; y: number; z: number }; slice: Slice; data: BlocksData | null }
    // Lowercase names of players allowed to command the bot with gestures (badged in the entity view).
    _trustedPlayers?: Set<string>
  }
}
