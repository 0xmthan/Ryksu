import type { Placement } from '../../types'
import { Vec3 } from 'vec3'

export class Move extends Vec3 {
  remainingBlocks: number
  cost: number
  toBreak: Vec3[]
  toPlace: Placement[]
  parkour: boolean
  hash: string
  constructor(
    x: number,
    y: number,
    z: number,
    remainingBlocks: number,
    cost: number,
    toBreak: Vec3[] = [],
    toPlace: Placement[] = [],
    parkour = false
  ) {
    super(Math.floor(x), Math.floor(y), Math.floor(z))
    this.remainingBlocks = remainingBlocks
    this.cost = cost
    this.toBreak = toBreak
    this.toPlace = toPlace
    this.parkour = parkour

    this.hash = this.x + ',' + this.y + ',' + this.z
  }
}
