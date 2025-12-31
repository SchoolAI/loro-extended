import type { EphemeralStore } from "loro-crdt"
import { describe, expect, it, vi } from "vitest"
import type { Command } from "../../synchronizer-program.js"
import type { DocId } from "../../types.js"
import { TimerlessEphemeralStore } from "../../utils/timerless-ephemeral-store.js"
import { createMockCommandContext } from "../test-utils.js"
import { handleBroadcastEphemeralBatch } from "./handle-broadcast-ephemeral-batch.js"

type BroadcastEphemeralBatchCommand = Extract<
  Command,
  { type: "cmd/broadcast-ephemeral-batch" }
>

describe("handleBroadcastEphemeralBatch", () => {
  it("should expand into multiple broadcast-ephemeral-namespace commands", () => {
    const mockStore = {
      encodeAll: vi.fn(() => new Uint8Array([1, 2, 3])),
      getAllStates: vi.fn(() => ({})),
    }

    const docNamespacedStores = new Map<DocId, Map<string, EphemeralStore>>()
    const namespaceMap = new Map<string, EphemeralStore>()
    namespaceMap.set("presence", mockStore as any)
    namespaceMap.set("cursors", mockStore as any)
    docNamespacedStores.set("doc-1", namespaceMap)

    const ctx = createMockCommandContext({
      docNamespacedStores,
    })

    const command: BroadcastEphemeralBatchCommand = {
      type: "cmd/broadcast-ephemeral-batch",
      docIds: ["doc-1"],
      hopsRemaining: 1,
      toChannelId: 42,
    }

    handleBroadcastEphemeralBatch(command, ctx)

    // Should execute 2 sub-commands (one per namespace)
    expect(ctx.executeCommand).toHaveBeenCalledTimes(2)

    // Verify the sub-commands are broadcast-ephemeral-namespace
    const calls = (ctx.executeCommand as any).mock.calls
    expect(calls[0][0].type).toBe("cmd/broadcast-ephemeral-namespace")
    expect(calls[1][0].type).toBe("cmd/broadcast-ephemeral-namespace")
  })

  it("should touch TimerlessEphemeralStore before encoding", () => {
    const mockTimerlessStore = new TimerlessEphemeralStore()
    const touchSpy = vi.spyOn(mockTimerlessStore, "touch")

    const docNamespacedStores = new Map<DocId, Map<string, EphemeralStore>>()
    const namespaceMap = new Map<string, EphemeralStore>()
    namespaceMap.set("presence", mockTimerlessStore as any)
    docNamespacedStores.set("doc-1", namespaceMap)

    const ctx = createMockCommandContext({
      docNamespacedStores,
    })

    const command: BroadcastEphemeralBatchCommand = {
      type: "cmd/broadcast-ephemeral-batch",
      docIds: ["doc-1"],
      hopsRemaining: 1,
      toChannelId: 42,
    }

    handleBroadcastEphemeralBatch(command, ctx)

    expect(touchSpy).toHaveBeenCalled()
  })

  it("should skip documents with no namespace stores", () => {
    const docNamespacedStores = new Map<DocId, Map<string, EphemeralStore>>()
    // doc-1 has no stores
    docNamespacedStores.set("doc-1", new Map())

    const ctx = createMockCommandContext({
      docNamespacedStores,
    })

    const command: BroadcastEphemeralBatchCommand = {
      type: "cmd/broadcast-ephemeral-batch",
      docIds: ["doc-1"],
      hopsRemaining: 1,
      toChannelId: 42,
    }

    handleBroadcastEphemeralBatch(command, ctx)

    // Should not execute any sub-commands
    expect(ctx.executeCommand).not.toHaveBeenCalled()
    // Should log debug message
    expect(ctx.logger.debug).toHaveBeenCalled()
  })

  it("should skip documents not in docNamespacedStores", () => {
    const docNamespacedStores = new Map<DocId, Map<string, EphemeralStore>>()
    // No entries at all

    const ctx = createMockCommandContext({
      docNamespacedStores,
    })

    const command: BroadcastEphemeralBatchCommand = {
      type: "cmd/broadcast-ephemeral-batch",
      docIds: ["doc-1", "doc-2"],
      hopsRemaining: 1,
      toChannelId: 42,
    }

    handleBroadcastEphemeralBatch(command, ctx)

    // Should not execute any sub-commands
    expect(ctx.executeCommand).not.toHaveBeenCalled()
  })

  it("should handle multiple documents", () => {
    const mockStore = {
      encodeAll: vi.fn(() => new Uint8Array([1, 2, 3])),
      getAllStates: vi.fn(() => ({})),
    }

    const docNamespacedStores = new Map<DocId, Map<string, EphemeralStore>>()

    const namespaceMap1 = new Map<string, EphemeralStore>()
    namespaceMap1.set("presence", mockStore as any)
    docNamespacedStores.set("doc-1", namespaceMap1)

    const namespaceMap2 = new Map<string, EphemeralStore>()
    namespaceMap2.set("cursors", mockStore as any)
    docNamespacedStores.set("doc-2", namespaceMap2)

    const ctx = createMockCommandContext({
      docNamespacedStores,
    })

    const command: BroadcastEphemeralBatchCommand = {
      type: "cmd/broadcast-ephemeral-batch",
      docIds: ["doc-1", "doc-2"],
      hopsRemaining: 1,
      toChannelId: 42,
    }

    handleBroadcastEphemeralBatch(command, ctx)

    // Should execute 2 sub-commands (one per doc/namespace)
    expect(ctx.executeCommand).toHaveBeenCalledTimes(2)

    const calls = (ctx.executeCommand as any).mock.calls
    // First call for doc-1/presence
    expect(calls[0][0]).toMatchObject({
      type: "cmd/broadcast-ephemeral-namespace",
      docId: "doc-1",
      namespace: "presence",
      hopsRemaining: 1,
      toChannelIds: [42],
    })
    // Second call for doc-2/cursors
    expect(calls[1][0]).toMatchObject({
      type: "cmd/broadcast-ephemeral-namespace",
      docId: "doc-2",
      namespace: "cursors",
      hopsRemaining: 1,
      toChannelIds: [42],
    })
  })

  it("should pass hopsRemaining to sub-commands", () => {
    const mockStore = {
      encodeAll: vi.fn(() => new Uint8Array([1, 2, 3])),
      getAllStates: vi.fn(() => ({})),
    }

    const docNamespacedStores = new Map<DocId, Map<string, EphemeralStore>>()
    const namespaceMap = new Map<string, EphemeralStore>()
    namespaceMap.set("presence", mockStore as any)
    docNamespacedStores.set("doc-1", namespaceMap)

    const ctx = createMockCommandContext({
      docNamespacedStores,
    })

    const command: BroadcastEphemeralBatchCommand = {
      type: "cmd/broadcast-ephemeral-batch",
      docIds: ["doc-1"],
      hopsRemaining: 5,
      toChannelId: 42,
    }

    handleBroadcastEphemeralBatch(command, ctx)

    const calls = (ctx.executeCommand as any).mock.calls
    expect(calls[0][0].hopsRemaining).toBe(5)
  })

  it("should wrap toChannelId in array for sub-commands", () => {
    const mockStore = {
      encodeAll: vi.fn(() => new Uint8Array([1, 2, 3])),
      getAllStates: vi.fn(() => ({})),
    }

    const docNamespacedStores = new Map<DocId, Map<string, EphemeralStore>>()
    const namespaceMap = new Map<string, EphemeralStore>()
    namespaceMap.set("presence", mockStore as any)
    docNamespacedStores.set("doc-1", namespaceMap)

    const ctx = createMockCommandContext({
      docNamespacedStores,
    })

    const command: BroadcastEphemeralBatchCommand = {
      type: "cmd/broadcast-ephemeral-batch",
      docIds: ["doc-1"],
      hopsRemaining: 1,
      toChannelId: 99,
    }

    handleBroadcastEphemeralBatch(command, ctx)

    const calls = (ctx.executeCommand as any).mock.calls
    expect(calls[0][0].toChannelIds).toEqual([99])
  })
})
