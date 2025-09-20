/** biome-ignore-all lint/suspicious/noExplicitAny: simplify tests */

import { LoroDoc, type LoroMap } from "loro-crdt"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { DocHandle } from "./doc-handle.js"

describe("DocHandle Integration Tests", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it("should initialize with an always-available document", () => {
    const handle = new DocHandle("test-doc")
    expect(handle.doc).toBeInstanceOf(LoroDoc)
    expect(handle.documentId).toBe("test-doc")
  })

  it("should allow changing the document immediately", async () => {
    type TestSchema = { doc: LoroMap<{ text: string }> }
    const handle = new DocHandle<TestSchema>("test-doc")

    handle.change(doc => {
      const root = doc.getMap("doc")
      root.set("text", "hello world")
    })

    const jsDoc = handle.doc.getMap("doc").toJSON()
    expect(jsDoc.text).toBe("hello world")
  })

  it("should support flexible readiness API", async () => {
    const handle = new DocHandle("test-doc")

    // Start the readiness check and advance timers
    const readyPromise = handle.waitUntilReady(readyStates =>
      readyStates.some(
        s => s.source.type === "storage" && s.state.type === "found",
      ),
    )

    handle.change(doc => {
      const stored = doc.getText("stored")
      stored.insert(0, "some-value")
    })

    handle.updateReadyState("disk", {
      source: { type: "storage", storageId: "disk" },
      state: { type: "found", containsNewOperations: true },
    })

    await readyPromise

    expect(handle.doc.toJSON()).toEqual({ stored: "some-value" })
  })

  it("should track peer status", () => {
    const handle = new DocHandle("test-doc")

    // Update peer status
    handle.updatePeerStatus("peer1", {
      hasDoc: true,
      isAwareOfDoc: true,
      isSyncingNow: false,
    })
    handle.updatePeerStatus("peer2", {
      hasDoc: false,
      isAwareOfDoc: true,
      isSyncingNow: true,
    })

    // Check peer status
    expect(handle.getPeerStatus("peer1")).toEqual({
      hasDoc: true,
      isAwareOfDoc: true,
      isSyncingNow: false,
    })

    // Get peers with doc
    expect(handle.getPeersWithDoc()).toEqual(["peer1"])
    expect(handle.getPeersAwareOfDoc()).toEqual(["peer1", "peer2"])

    // Remove peer
    handle.removePeer("peer1")
    expect(handle.getPeerStatus("peer1")).toBeUndefined()
    expect(handle.getPeersWithDoc()).toEqual([])
  })
})
