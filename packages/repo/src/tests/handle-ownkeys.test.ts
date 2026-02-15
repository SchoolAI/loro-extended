import { Shape } from "@loro-extended/change"
import { afterEach, describe, expect, it } from "vitest"
import { Bridge, BridgeAdapter } from "../adapter/bridge-adapter.js"
import { Repo } from "../repo.js"

/**
 * Tests for Handle proxy ownKeys behavior.
 *
 * Issue: The Handle proxy (created by createHandle in handle.ts lines 767-792)
 * is MISSING an ownKeys trap entirely. This means Reflect.ownKeys() falls through
 * to the target Handle class, which may have Symbol properties.
 *
 * Additionally, when ephemeralShapes are provided, the proxy should include
 * those keys in the ownKeys result so they appear in Object.keys().
 *
 * Fix: Add ownKeys and getOwnPropertyDescriptor traps to the Handle proxy.
 * Location: packages/repo/src/handle.ts lines 767-792
 */
describe("Handle proxy ownKeys", () => {
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

  describe("Handle without ephemeral stores", () => {
    it("Reflect.ownKeys() should return only string keys", () => {
      const repo = createRepo()
      const handle = repo.getHandle("test-doc", DocSchema)

      const keys = Reflect.ownKeys(handle)

      // All keys should be strings (no Symbols)
      // This test will FAIL if the proxy doesn't filter Symbols
      for (const key of keys) {
        expect(typeof key).toBe("string")
      }
    })

    it("Object.keys() should return handle properties", () => {
      const repo = createRepo()
      const handle = repo.getHandle("test-doc", DocSchema)

      const keys = Object.keys(handle)

      // Should include standard Handle own properties (not getters)
      // Note: 'doc' is a getter, not an own property, so it won't appear in Object.keys()
      expect(keys).toContain("docId")
      expect(keys).toContain("peerId")

      // All keys should be strings
      for (const key of keys) {
        expect(typeof key).toBe("string")
      }
    })
  })

  describe("Handle with ephemeral stores", () => {
    it("Reflect.ownKeys() should return only string keys", () => {
      const repo = createRepo()
      const handle = repo.getHandle("test-doc", DocSchema, {
        presence: PresenceSchema,
      })

      const keys = Reflect.ownKeys(handle)

      // All keys should be strings (no Symbols)
      for (const key of keys) {
        expect(typeof key).toBe("string")
      }
    })

    it("Object.keys() should include ephemeral store names", () => {
      const repo = createRepo()
      const handle = repo.getHandle("test-doc", DocSchema, {
        presence: PresenceSchema,
      })

      const keys = Object.keys(handle)

      // Should include the ephemeral store name
      // This test will FAIL if ownKeys doesn't include ephemeral stores
      expect(keys).toContain("presence")

      // All keys should be strings
      for (const key of keys) {
        expect(typeof key).toBe("string")
      }
    })

    it("for...in should iterate ephemeral store names", () => {
      const repo = createRepo()
      const handle = repo.getHandle("test-doc", DocSchema, {
        presence: PresenceSchema,
      })

      const keys: string[] = []
      for (const key in handle) {
        keys.push(key)
      }

      // Should include the ephemeral store name
      expect(keys).toContain("presence")
    })

    it("spread operator should include ephemeral stores", () => {
      const repo = createRepo()
      const handle = repo.getHandle("test-doc", DocSchema, {
        presence: PresenceSchema,
      })

      // This should not throw
      const spread = { ...handle }

      // Should have the ephemeral store
      expect("presence" in spread).toBe(true)
    })
  })

  describe("Object.entries()", () => {
    it("should work without errors", () => {
      const repo = createRepo()
      const handle = repo.getHandle("test-doc", DocSchema)

      // This should not throw "Object keys must be strings"
      const entries = Object.entries(handle)

      // All keys should be strings
      for (const [key] of entries) {
        expect(typeof key).toBe("string")
      }
    })
  })
})
