// Fields mineflayer sets at runtime that its typings leave out.
import type { Block } from 'prismarine-block'

declare module 'prismarine-entity' {
  interface Entity {
    eyeHeight?: number
    isCollidedHorizontally?: boolean
  }
}

declare module 'mineflayer' {
  interface Bot {
    parseBedMetadata(block: Block): { occupied?: boolean } | undefined
  }
}
