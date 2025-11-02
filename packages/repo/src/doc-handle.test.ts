/** biome-ignore-all lint/suspicious/noExplicitAny: simplify tests */

import { LoroDoc, type LoroMap } from "loro-crdt"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DocHandle } from "./doc-handle.js"
import { InMemoryStorageAdapter } from "./storage/in-memory-storage-adapter.js"
import { Synchronizer } from "./synchronizer.js"

describe("DocHandle Integration Tests", () => {
  let synchronizer: Synchronizer

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    const storage = new InMemoryStorageAdapter()
    synchronizer = new Synchronizer({
      identity: { name: "test-peer" },
      adapters: [storage],
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it("should initialize with an always-available document", () => {
    const handle = new DocHandle({ docId: "test-doc", synchronizer })
    expect(handle.doc).toBeInstanceOf(LoroDoc)
    expect(handle.docId).toBe("test-doc")
  })

  it("should allow changing the document immediately", async () => {
    type TestSchema = { doc: LoroMap<{ text: string }> }
    const handle = new DocHandle<TestSchema>({
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
    const handle = new DocHandle({
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
})
