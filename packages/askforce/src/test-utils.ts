/**
 * Test utilities for Askforce.
 * This file is not exported from the package - it's for internal testing only.
 */
import type { TypedEphemeral } from "@loro-extended/repo"
import type { WorkerPresence } from "./types.js"

/**
 * Creates a mock TypedEphemeral for testing.
 * Provides an in-memory implementation of the ephemeral store interface.
 *
 * @param myPeerId - The peer ID for this mock instance
 * @returns A mock ephemeral with an exposed presenceStore for test assertions
 */
export function createMockEphemeral(
  myPeerId: string,
): TypedEphemeral<WorkerPresence> & {
  presenceStore: Map<string, WorkerPresence>
} {
  const presenceStore = new Map<string, WorkerPresence>()

  const ephemeral: TypedEphemeral<WorkerPresence> & {
    presenceStore: Map<string, WorkerPresence>
  } = {
    presenceStore,

    set(key: string, value: WorkerPresence) {
      presenceStore.set(key, value)
    },

    get self() {
      return presenceStore.get(myPeerId)
    },

    setSelf(presence: WorkerPresence) {
      presenceStore.set(myPeerId, presence)
    },

    get(peerId: string) {
      return presenceStore.get(peerId)
    },

    getAll() {
      return new Map(presenceStore)
    },

    get peers() {
      const result = new Map<string, WorkerPresence>()
      for (const [key, value] of presenceStore) {
        if (key !== myPeerId) {
          result.set(key, value)
        }
      }
      return result
    },

    delete(peerId: string) {
      presenceStore.delete(peerId)
    },

    subscribe(
      _callback: (event: {
        key: string
        value: WorkerPresence | undefined
        source: "local" | "remote" | "initial"
      }) => void,
    ) {
      return () => {}
    },

    get raw(): any {
      return {
        getAllStates: () => Object.fromEntries(presenceStore),
      }
    },
  }

  return ephemeral
}
