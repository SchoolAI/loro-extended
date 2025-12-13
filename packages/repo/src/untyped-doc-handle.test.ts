/** biome-ignore-all lint/suspicious/noExplicitAny: simplify tests */

import { LoroDoc } from "loro-crdt"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { InMemoryStorageAdapter } from "./storage/in-memory-storage-adapter.js"
import { Synchronizer } from "./synchronizer.js"
import { UntypedDocHandle } from "./untyped-doc-handle.js"

describe("UntypedDocHandle Integration Tests", () => {
  let synchronizer: Synchronizer

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    const storage = new InMemoryStorageAdapter()
    synchronizer = new Synchronizer({
      identity: { peerId: "1", name: "test-peer", type: "user" },
      adapters: [storage],
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it("should initialize with an always-available document", () => {
    const handle = new UntypedDocHandle({ docId: "test-doc", synchronizer })
    expect(handle.doc).toBeInstanceOf(LoroDoc)
    expect(handle.docId).toBe("test-doc")
  })

  it("should allow changing the document immediately", async () => {
    const handle = new UntypedDocHandle({
      docId: "test-doc",
      synchronizer,
    })

    handle.batch(doc => {
      const root = doc.getMap("doc")
      root.set("text", "hello world")
    })

    const jsDoc = handle.doc.getMap("doc").toJSON()
    expect(jsDoc.text).toBe("hello world")
  })

  it("should support flexible readiness API", async () => {
    const handle = new UntypedDocHandle({
      docId: "test-doc",
      synchronizer,
    })

    handle.batch(doc => {
      const stored = doc.getText("stored")
      stored.insert(0, "some-value")
    })

    // The waitUntilReady method exists but is not fully implemented yet
    // For now, just test that the document is available
    expect(handle.doc.toJSON()).toEqual({ stored: "some-value" })
  })

  it("should provide presence interface", () => {
    const handle = new UntypedDocHandle({
      docId: "test-doc",
      synchronizer,
    })

    // Presence interface should be available
    expect(handle.presence).toBeDefined()
    expect(typeof handle.presence.set).toBe("function")
    expect(typeof handle.presence.get).toBe("function")
    expect(typeof handle.presence.subscribe).toBe("function")
    expect(handle.presence.self).toBeDefined()
    expect(handle.presence.peers).toBeDefined()
    expect(handle.presence.all).toBeDefined()
  })

  it("should provide peers as a Map that excludes self", () => {
    const handle = new UntypedDocHandle({
      docId: "test-doc",
      synchronizer,
    })

    // Set some presence for self
    handle.presence.set({ name: "test-user" })

    // peers should be a Map
    expect(handle.presence.peers).toBeInstanceOf(Map)

    // peers should NOT include self
    const myPeerId = synchronizer.identity.peerId
    expect(handle.presence.peers.has(myPeerId)).toBe(false)

    // all should include self (for backward compatibility)
    expect(handle.presence.all[myPeerId]).toBeDefined()
    expect(handle.presence.all[myPeerId]).toEqual({ name: "test-user" })
  })
})
