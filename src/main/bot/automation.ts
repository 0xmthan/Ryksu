import { AUTOMATIONS, type Automation } from '../../shared/scriptApi'

// The bot's automatic features (listed in src/shared/scriptApi.ts). While a script runs they're all paused,
// whatever the user picked, and the script turns back on the ones it wants; when it stops, the user's picks
// apply again.
export { AUTOMATIONS, type Automation }

export const isAutomation = (name: unknown): name is Automation =>
  (AUTOMATIONS as readonly unknown[]).includes(name)

export class AutomationGate {
  // What the running script turned on, or null with no script running.
  private scriptPicks: Set<Automation> | null = null

  get paused() {
    return this.scriptPicks !== null
  }

  pause() {
    this.scriptPicks = new Set()
  }

  resume() {
    this.scriptPicks = null
  }

  // A script turning a feature on or off; does nothing with no script running.
  set(feature: Automation, on: boolean) {
    if (!this.scriptPicks) return
    if (on) this.scriptPicks.add(feature)
    else this.scriptPicks.delete(feature)
  }

  // Whether a feature runs now, given what the user picked for it.
  resolve(feature: Automation, userOn: boolean) {
    return this.scriptPicks ? this.scriptPicks.has(feature) : userOn
  }
}
