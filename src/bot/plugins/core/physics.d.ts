declare module 'prismarine-physics' {
  import type { Bot, ControlStateStatus } from 'mineflayer'
  import type { Vec3 } from 'vec3'
  export class PlayerState {
    constructor(bot: Bot, control: ControlStateStatus)
    pos: Vec3
    yaw: number
    control: ControlStateStatus
    onGround: boolean
    isInWater: boolean
    isInLava: boolean
  }
}
