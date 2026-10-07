import type { Bot, ControlStateStatus } from 'mineflayer'
import type { Block } from 'prismarine-block'
import type { Item } from 'prismarine-item'
import type { Vec3 } from 'vec3'
import type { AStar } from './pathfinder/lib/astar'
import type { Goal } from './pathfinder/lib/goals'
import type { Move } from './pathfinder/lib/move'
import type { Movements } from './pathfinder/lib/movements'
import type { Tool } from './tool/Tool'
import type { EatUtil } from './autoEat'

export type Callback = (error?: unknown) => void
export interface Placement {
  x: number
  y: number
  z: number
  dx: number
  dy: number
  dz: number
  jump?: boolean
  useOne?: boolean
  returnPos?: Vec3
}
export type PathStatus = 'success' | 'partial' | 'timeout' | 'noPath'
export interface PathResult {
  status: PathStatus
  cost: number
  time: number
  visitedNodes: number
  generatedNodes: number
  path: Move[]
  context: AStar
}
export interface PathOptions {
  optimizePath?: boolean
  resetEntityIntersects?: boolean
  timeout?: number
  tickTimeout?: number
  searchRadius?: number
  startMove?: Move
}
export interface Pathfinder {
  thinkTimeout: number
  tickTimeout: number
  searchRadius: number
  enablePathShortcut: boolean
  LOSWhenPlacingBlocks: boolean
  // "x,y,z" → until when (performance.now()) the server is assumed to refuse digging or placing there.
  refused: Map<string, number>
  isPaused: () => boolean
  readonly goal: Goal | null
  readonly movements: Movements
  bestHarvestTool(block: Block): Item | null
  getPathTo(movements: Movements, goal: Goal, timeout?: number): PathResult
  getPathFromTo(
    movements: Movements,
    startPos: Vec3,
    goal: Goal,
    options?: PathOptions
  ): Generator<{ result: PathResult; astarContext: AStar }, void>
  setGoal(goal: Goal | null, dynamic?: boolean): void
  setMovements(movements: Movements): void
  isMoving(): boolean
  isMining(): boolean
  isBuilding(): boolean
  goto(goal: Goal): Promise<void>
  stop(): void
}
export interface SimulationState {
  pos: Vec3
  yaw: number
  control: ControlStateStatus
  onGround: boolean
  isInWater: boolean
  isInLava: boolean
}

declare module 'mineflayer' {
  interface Bot {
    pathfinder: Pathfinder
    tool: Tool
    autoEat: EatUtil
    armorManager: { equipAll(): Promise<void> }
  }
  interface BotEvents {
    path_reset: (reason: string) => void
    path_update: (result: PathResult) => void
    path_stop: () => void
    goal_reached: (goal: Goal) => void
    goal_updated: (goal: Goal | null, dynamic: boolean) => void
  }
  interface GameState {
    minY: number
  }
  interface PhysicsOptions {
    simulatePlayer(state: SimulationState, world: { getBlock(pos: Vec3): Block | null }): SimulationState
  }
}

export type CoreBot = Bot

// Mineflayer adds physics state to its player entity at runtime.
declare module 'prismarine-entity' {
  interface Entity {
    isInWater?: boolean
  }
}
