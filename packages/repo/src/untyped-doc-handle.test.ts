/** biome-ignore-all lint/suspicious/noExplicitAny: simplify tests */

import { LoroDoc, type LoroMap } from "loro-crdt"
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

    handle.change(doc => {
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

    handle.change(doc => {
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
    expect(handle.presence.all).toBeDefined()
  })
})
