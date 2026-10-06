import { EventEmitter } from 'node:events'
import type { Bot } from 'mineflayer'
import type { MotionEntity } from '../src/shared/types'

// Test doubles only fill in what the code under test reads; this gives one the type it stands in for.
export const fake = <T>(value: object): T => value as T

// A stand-in bot: an event emitter whose other fields each test sets to whatever it needs.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FakeBot = EventEmitter & Record<string, any>
export const fakeBot = (fields: object = {}): FakeBot => Object.assign(new EventEmitter(), fields)
export const asBot = (bot: FakeBot) => bot as unknown as Bot

// An entity as the watcher gets it, standing still at the origin unless `fields` say otherwise.
export const mob = (fields: Partial<MotionEntity> = {}): MotionEntity => ({
  id: 1,
  kind: 'passive',
  type: null,
  item: null,
  name: 'mob',
  x: 0,
  y: 0,
  z: 0,
  yaw: 0,
  headYaw: 0,
  pitch: 0,
  swing: 0,
  hurt: 0,
  ...fields,
})
