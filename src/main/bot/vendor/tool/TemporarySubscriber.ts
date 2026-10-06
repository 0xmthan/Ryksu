import type { EventEmitter } from 'node:events'
class Subscription {
  eventName: string
  callback: (...args: unknown[]) => void

  constructor(eventName: string, callback: (...args: unknown[]) => void) {
    this.eventName = eventName
    this.callback = callback
  }
}
export class TemporarySubscriber {
  bot: EventEmitter
  subscriptions: Subscription[]

  constructor(bot: EventEmitter) {
    this.bot = bot
    this.subscriptions = []
  }
  /**
   * Adds a new temporary event listener to the bot.
   *
   * @param event - The event to subscribe to.
   * @param callback - The function to execute.
   */
  subscribeTo(event: string, callback: (...args: unknown[]) => void) {
    this.subscriptions.push(new Subscription(event, callback))
    this.bot.on(event, callback)
  }
  /**
   * Removes all attached event listeners from the bot.
   */
  cleanup() {
    for (const sub of this.subscriptions) {
      this.bot.removeListener(sub.eventName, sub.callback)
    }
  }
}
