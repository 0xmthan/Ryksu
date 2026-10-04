import type { Callback } from '../types'
/**
 * A simple utility class for queuing up a series of async tasks to execute.
 */
export class TaskQueue {
  tasks: Array<(callback: Callback) => void>
  stopOnError: boolean

  constructor() {
    this.tasks = []
    /**
     * If true, the task list will stop executing if one of the tasks throws an error.
     */
    this.stopOnError = true
  }
  /**
   * Adds a new async task to this queue. The provided callback should be executed when
   * the async task is complete.
   *
   * @param task - The async task to add.
   */
  add(task: (callback: Callback) => void) {
    this.tasks.push(task)
  }
  /**
   * Adds a synchronous task toi this queue.
   *
   * @param task - The sync task to add.
   */
  addSync(task: () => void) {
    this.add((cb) => {
      try {
        task()
        cb()
      } catch (err) {
        cb(err)
      }
    })
  }
  /**
   * Runs all tasks currently in this queue and empties the queue.
   *
   * @param cb - The optional callback to be executed when all tasks in this queue have
   * finished executing.
   */
  runAll(cb?: Callback) {
    const taskList = this.tasks
    this.tasks = []
    let index = -1
    const runNext = () => {
      index++
      if (index >= taskList.length) {
        if (cb !== undefined) cb()
        return
      }
      try {
        taskList[index]((err) => {
          if (err !== undefined) {
            if (cb !== undefined) cb(err)
            if (this.stopOnError) return
          }
          runNext()
        })
      } catch (err) {
        if (cb !== undefined) cb(err)
      }
    }
    runNext()
  }
}
