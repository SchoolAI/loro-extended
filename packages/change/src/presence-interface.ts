import type { Value } from "loro-crdt"

/**
 * A record of string keys to Loro values, used for presence data.
 */
export type ObjectValue = Record<string, Value>

/**
 * Interface for presence management that can be implemented by different backends.
 * This abstraction allows TypedPresence to work with any presence provider.
 */
export interface PresenceInterface {
  /**
   * Set multiple presence values at once.
   */
  set: (values: ObjectValue) => void

  /**
   * Get a single presence value by key.
   */
  get: (key: string) => Value

  /**
   * The current peer's presence state.
   */
  readonly self: ObjectValue

  /**
   * All peers' presence states, keyed by peer ID.
   */
  readonly all: Record<string, ObjectValue>

  /**
   * Set a single raw value by key (escape hatch for arbitrary keys).
   */
  setRaw: (key: string, value: Value) => void

  /**
   * Subscribe to presence changes.
   * @param cb Callback that receives the aggregated presence values
   * @returns Unsubscribe function
   */
  subscribe: (cb: (values: ObjectValue) => void) => () => void
}
