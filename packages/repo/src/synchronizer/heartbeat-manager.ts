/**
 * HeartbeatManager - Manages periodic heartbeat for ephemeral store synchronization
 *
 * The heartbeat ensures ephemeral data (presence, cursors, etc.) is periodically
 * broadcast to all peers, keeping the data fresh and preventing expiration.
 *
 * @example
 * ```typescript
 * const heartbeat = new HeartbeatManager(10000, () => {
 *   // Broadcast ephemeral state to all peers
 *   broadcastEphemeralToAllPeers()
 * })
 *
 * heartbeat.start()
 * // ... later
 * heartbeat.stop()
 * ```
 */
export class HeartbeatManager {
  #interval: ReturnType<typeof setInterval> | undefined
  readonly #intervalMs: number
  readonly #onHeartbeat: () => void

  /**
   * Create a new HeartbeatManager.
   *
   * @param intervalMs - Interval between heartbeats in milliseconds
   * @param onHeartbeat - Callback invoked on each heartbeat
   */
  constructor(intervalMs: number, onHeartbeat: () => void) {
    this.#intervalMs = intervalMs
    this.#onHeartbeat = onHeartbeat
  }

  /**
   * Start the heartbeat timer.
   * If already running, this is a no-op.
   */
  start(): void {
    if (this.#interval !== undefined) {
      return
    }
    this.#interval = setInterval(() => {
      this.#onHeartbeat()
    }, this.#intervalMs)
  }

  /**
   * Stop the heartbeat timer.
   * If not running, this is a no-op.
   */
  stop(): void {
    if (this.#interval !== undefined) {
      clearInterval(this.#interval)
      this.#interval = undefined
    }
  }

  /**
   * Check if the heartbeat is currently running.
   */
  get isRunning(): boolean {
    return this.#interval !== undefined
  }

  /**
   * Get the configured interval in milliseconds.
   */
  get intervalMs(): number {
    return this.#intervalMs
  }
}
