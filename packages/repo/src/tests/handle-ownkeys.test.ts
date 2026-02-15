import { Shape } from "@loro-extended/change"
import { afterEach, describe, expect, it } from "vitest"
import { Bridge, BridgeAdapter } from "../adapter/bridge-adapter.js"
import { Repo } from "../repo.js"
import { sync } from "../sync.js"

/**
 * Tests for SyncRef proxy ownKeys behavior.
 *
 * When ephemeralShapes are provided, the SyncRef proxy should include
 * those keys in the ownKeys result so they appear in Object.keys().
 */
describe("SyncRef proxy ownKeys", () => {
  const DocSchema = Shape.doc({
    title: Shape.text(),
    count: Shape.counter(),
  })

  const PresenceSchema = Shape.plain.struct({
    cursor: Shape.plain.number(),
    name: Shape.plain.string(),
  })

  // Track repos for cleanup
  const repos: Repo[] = []

  afterEach(() => {
    // Clean up to prevent test from hanging due to heartbeat interval
    for (const repo of repos) {
      repo.synchronizer.stopHeartbeat()
    }
    repos.length = 0
  })

  function createRepo() {
    const bridge = new Bridge()
    const repo = new Repo({
      adapters: [new BridgeAdapter({ adapterType: "test", bridge })],
    })
    repos.push(repo)
    return repo
  }

  describe("SyncRef without ephemeral stores", () => {
    it("Reflect.ownKeys() should return only string keys", () => {
      const repo = createRepo()
      const doc = repo.get("test-doc", DocSchema)
      const syncRef = sync(doc)

      const keys = Reflect.ownKeys(syncRef)

      // All keys should be strings (no Symbols)
      for (const key of keys) {
        expect(typeof key).toBe("string")
      }
    })

    it("Object.keys() should return SyncRef properties", () => {
      const repo = createRepo()
      const doc = repo.get("test-doc", DocSchema)
      const syncRef = sync(doc)

      const keys = Object.keys(syncRef)

      // Should include standard SyncRef own properties
      expect(keys).toContain("peerId")
      expect(keys).toContain("docId")

      // All keys should be strings
      for (const key of keys) {
        expect(typeof key).toBe("string")
      }
    })
  })

  describe("SyncRef with ephemeral stores", () => {
    it("Reflect.ownKeys() should return only string keys", () => {
      const repo = createRepo()
      const doc = repo.get("test-doc", DocSchema, {
        presence: PresenceSchema,
      })
      const syncRef = sync(doc)

      const keys = Reflect.ownKeys(syncRef)

      // All keys should be strings (no Symbols)
      for (const key of keys) {
        expect(typeof key).toBe("string")
      }
    })

    it("Object.keys() should include ephemeral store names", () => {
      const repo = createRepo()
      const doc = repo.get("test-doc", DocSchema, {
        presence: PresenceSchema,
      })
      const syncRef = sync(doc)

      const keys = Object.keys(syncRef)

      // Should include the ephemeral store name
      expect(keys).toContain("presence")

      // All keys should be strings
      for (const key of keys) {
        expect(typeof key).toBe("string")
      }
    })

    it("for...in should iterate ephemeral store names", () => {
      const repo = createRepo()
      const doc = repo.get("test-doc", DocSchema, {
        presence: PresenceSchema,
      })
      const syncRef = sync(doc)

      const keys: string[] = []
      for (const key in syncRef) {
        keys.push(key)
      }

      // Should include the ephemeral store name
      expect(keys).toContain("presence")
    })

    it("spread operator should include ephemeral stores", () => {
      const repo = createRepo()
      const doc = repo.get("test-doc", DocSchema, {
        presence: PresenceSchema,
      })
      const syncRef = sync(doc)

      // This should not throw
      const spread = { ...syncRef }

      // Should have the ephemeral store
      expect("presence" in spread).toBe(true)
    })
  })

  describe("Object.entries()", () => {
    it("should work without errors", () => {
      const repo = createRepo()
      const doc = repo.get("test-doc", DocSchema)
      const syncRef = sync(doc)

      // This should not throw "Object keys must be strings"
      const entries = Object.entries(syncRef)

      // All keys should be strings
      for (const [key] of entries) {
        expect(typeof key).toBe("string")
      }
    })
  })
})
