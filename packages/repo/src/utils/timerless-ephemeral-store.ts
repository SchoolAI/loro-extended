import { EphemeralStore, type Value } from "loro-crdt"

/**
 * An EphemeralStore that never expires its data.
 *
 * Used for "my" presence data, which should persist as long as the repo exists.
 * From my perspective, I am always here - my presence should never time out.
 *
 * ## Implementation Details
 *
 * The loro-crdt `EphemeralStore` has a timer that expires data after a timeout.
 * The timer is started by `set()` and `apply()` methods via `startTimerIfNotEmpty()`.
 *
 * This class bypasses the timer by:
 * 1. Using a large timeout (max 32-bit signed int ~24.8 days) so applied data
 *    isn't immediately expired when received
 * 2. Overriding `set()` and `apply()` to call the inner wasm methods directly,
 *    bypassing the `startTimerIfNotEmpty()` call
 *
 * ## Why not use `null` timeout?
 *
 * The loro-crdt EphemeralStore constructor accepts `null` as a timeout value,
 * but stores created with `null` timeout cannot receive data via `apply()` -
 * applied data is treated as immediately expired. Using a large timeout avoids
 * this issue.
 *
 * @example
 * ```typescript
 * const myStore = new TimerlessEphemeralStore()
 * myStore.set('cursor', { x: 10, y: 20 })
 * myStore.set('name', 'Alice')
 * // These values will never expire
 * ```
 */
export class TimerlessEphemeralStore<
  T extends Record<string, Value> = Record<string, Value>,
> extends EphemeralStore<T> {
  constructor() {
    // Use max 32-bit signed int (~24.8 days) so applied data isn't immediately expired
    // The timer itself won't run because we override set/apply to bypass it
    super(2147483647)
  }

  /**
   * Set a value without triggering the expiration timer.
   */
  override set<K extends keyof T>(key: K, value: T[K]): void {
    // Call inner.set directly without triggering the timer
    // The parent class's set() calls startTimerIfNotEmpty() which we want to skip
    this.inner.set(key as string, value)
  }

  /**
   * Apply encoded data without triggering the expiration timer.
   */
  override apply(bytes: Uint8Array): void {
    // Call inner.apply directly without triggering the timer
    // The parent class's apply() calls startTimerIfNotEmpty() which we want to skip
    this.inner.apply(bytes)
  }

  /**
   * Touch all values to update their timestamps to the current time.
   *
   * This is essential for heartbeat functionality. The EphemeralStore encodes
   * data with the original timestamps from when values were set. When a receiving
   * store applies this data, it uses these timestamps to determine expiration.
   *
   * Without touching, heartbeat data would have stale timestamps and be
   * immediately expired on the receiving end.
   *
   * @example
   * ```typescript
   * // Before sending heartbeat
   * myStore.touch()
   * const data = myStore.encodeAll()
   * sendToServer(data)
   * ```
   */
  touch(): void {
    const states = this.getAllStates()
    for (const [key, value] of Object.entries(states)) {
      this.inner.set(key, value)
    }
  }

  /**
   * Encode all data with fresh timestamps for transmission.
   *
   * This is a convenience method that combines touch() and encodeAll().
   * Use this for heartbeat messages to ensure timestamps are current.
   *
   * @returns Encoded data with current timestamps
   */
  encodeAllFresh(): Uint8Array {
    this.touch()
    return this.encodeAll()
  }
}
