import type { ValueShape } from "@loro-extended/change"
import type { EphemeralStore, Value } from "loro-crdt"
import { equal } from "./utils/equal.js"

/**
 * TypedEphemeral provides type-safe access to an ephemeral store.
 * All ephemeral stores are shared key-value stores where keys can be anything
 * (often peerIds, but not required).
 */
export interface TypedEphemeral<T> {
  // ═══════════════════════════════════════════════════════════════
  // Core API - Shared key-value store
  // ═══════════════════════════════════════════════════════════════

  /** Set a value for any key */
  set(key: string, value: T): void

  /** Get a value by key */
  get(key: string): T | undefined

  /** Get all key-value pairs */
  getAll(): Map<string, T>

  /** Delete a key */
  delete(key: string): void

  // ═══════════════════════════════════════════════════════════════
  // Convenience API - For the common per-peer pattern
  // ═══════════════════════════════════════════════════════════════

  /** Get my value: equivalent to get(myPeerId) */
  readonly self: T | undefined

  /** Set my value: equivalent to set(myPeerId, value) */
  setSelf(value: T): void

  /** Get all peers except me */
  readonly peers: Map<string, T>

  // ═══════════════════════════════════════════════════════════════
  // Subscription
  // ═══════════════════════════════════════════════════════════════

  /** Subscribe to changes */
  subscribe(
    cb: (event: {
      key: string
      value: T | undefined
      source: "local" | "remote" | "initial"
    }) => void,
  ): () => void

  // ═══════════════════════════════════════════════════════════════
  // Escape Hatch
  // ═══════════════════════════════════════════════════════════════

  /** Access the underlying loro-crdt EphemeralStore */
  readonly raw: EphemeralStore
}

/**
 * Creates a TypedEphemeral wrapper around an EphemeralStore.
 *
 * Note: Broadcasting is handled automatically by the Synchronizer's subscription
 * to the store. When store.set() is called, the subscription fires with
 * by='local' and triggers the broadcast.
 */
export function createTypedEphemeral<T>(
  store: EphemeralStore,
  myPeerId: string,
  _shape: ValueShape, // For future validation
): TypedEphemeral<T> {
  return {
    set(key: string, value: T): void {
      store.set(key, value as Value)
    },

    get(key: string): T | undefined {
      return store.get(key) as T | undefined
    },

    getAll(): Map<string, T> {
      const states = store.getAllStates()
      const result = new Map<string, T>()
      for (const [key, value] of Object.entries(states)) {
        result.set(key, value as T)
      }
      return result
    },

    delete(key: string): void {
      store.delete(key)
    },

    get self(): T | undefined {
      return store.get(myPeerId) as T | undefined
    },

    setSelf(value: T): void {
      store.set(myPeerId, value as Value)
    },

    get peers(): Map<string, T> {
      const states = store.getAllStates()
      const result = new Map<string, T>()
      for (const [key, value] of Object.entries(states)) {
        if (key !== myPeerId) {
          result.set(key, value as T)
        }
      }
      return result
    },

    subscribe(
      cb: (event: {
        key: string
        value: T | undefined
        source: "local" | "remote" | "initial"
      }) => void,
    ): () => void {
      // Track previous state to detect actual changes
      let previousStates: Record<string, unknown> = {}

      // Call immediately with current state for each key
      const initialStates = store.getAllStates()
      for (const [key, value] of Object.entries(initialStates)) {
        cb({ key, value: value as T, source: "initial" })
      }
      previousStates = { ...initialStates }

      // Subscribe to future changes
      return store.subscribe(event => {
        const source = event.by === "local" ? "local" : "remote"
        const currentStates = store.getAllStates()

        // Find keys that were added or changed
        for (const [key, value] of Object.entries(currentStates)) {
          const prevValue = previousStates[key]
          if (!equal(value, prevValue)) {
            cb({ key, value: value as T, source })
          }
        }

        // Find keys that were deleted
        for (const key of Object.keys(previousStates)) {
          if (!(key in currentStates)) {
            cb({ key, value: undefined, source })
          }
        }

        // Update previous state
        previousStates = { ...currentStates }
      })
    },

    get raw(): EphemeralStore {
      return store
    },
  }
}
