import type { PeerID } from "loro-crdt"
import { describe, expect, it, vi } from "vitest"
import type { Command } from "../../synchronizer-program.js"
import {
  createMockCommandContext,
  createMockEphemeralStore,
} from "../test-utils.js"
import { handleBroadcastEphemeralNamespace } from "./handle-broadcast-ephemeral-namespace.js"

type BroadcastEphemeralNamespaceCommand = Extract<
  Command,
  { type: "cmd/broadcast-ephemeral-namespace" }
>

describe("handleBroadcastEphemeralNamespace", () => {
  it("should queue ephemeral message to specified channels", () => {
    const mockStore = createMockEphemeralStore()
    mockStore.encodeAll = vi.fn(() => new Uint8Array([1, 2, 3]))

    const ctx = createMockCommandContext({
      getNamespacedStore: vi.fn(() => mockStore as any),
      identity: { peerId: "my-peer" as PeerID, name: "test", type: "user" },
    })

    const command: BroadcastEphemeralNamespaceCommand = {
      type: "cmd/broadcast-ephemeral-namespace",
      docId: "doc-1",
      namespace: "presence",
      hopsRemaining: 1,
      toChannelIds: [42, 43],
    }

    handleBroadcastEphemeralNamespace(command, ctx)

    expect(ctx.getNamespacedStore).toHaveBeenCalledWith("doc-1", "presence")
    expect(ctx.queueSend).toHaveBeenCalledTimes(2)

    // Verify the message structure
    const expectedMessage = {
      type: "channel/ephemeral",
      docId: "doc-1",
      hopsRemaining: 1,
      stores: [
        {
          peerId: "my-peer",
          data: new Uint8Array([1, 2, 3]),
          namespace: "presence",
        },
      ],
    }

    expect(ctx.queueSend).toHaveBeenCalledWith(42, expectedMessage)
    expect(ctx.queueSend).toHaveBeenCalledWith(43, expectedMessage)
  })

  it("should skip if store not found", () => {
    const ctx = createMockCommandContext({
      getNamespacedStore: vi.fn(() => undefined),
    })

    const command: BroadcastEphemeralNamespaceCommand = {
      type: "cmd/broadcast-ephemeral-namespace",
      docId: "doc-1",
      namespace: "presence",
      hopsRemaining: 1,
      toChannelIds: [42],
    }

    handleBroadcastEphemeralNamespace(command, ctx)

    expect(ctx.logger.debug).toHaveBeenCalled()
    expect(ctx.queueSend).not.toHaveBeenCalled()
  })

  it("should skip if store has no data", () => {
    const mockStore = createMockEphemeralStore()
    mockStore.encodeAll = vi.fn(() => new Uint8Array(0)) // Empty data

    const ctx = createMockCommandContext({
      getNamespacedStore: vi.fn(() => mockStore as any),
    })

    const command: BroadcastEphemeralNamespaceCommand = {
      type: "cmd/broadcast-ephemeral-namespace",
      docId: "doc-1",
      namespace: "presence",
      hopsRemaining: 1,
      toChannelIds: [42],
    }

    handleBroadcastEphemeralNamespace(command, ctx)

    expect(ctx.logger.debug).toHaveBeenCalled()
    expect(ctx.queueSend).not.toHaveBeenCalled()
  })

  it("should skip if no channels specified", () => {
    const mockStore = createMockEphemeralStore()
    mockStore.encodeAll = vi.fn(() => new Uint8Array([1, 2, 3]))

    const ctx = createMockCommandContext({
      getNamespacedStore: vi.fn(() => mockStore as any),
    })

    const command: BroadcastEphemeralNamespaceCommand = {
      type: "cmd/broadcast-ephemeral-namespace",
      docId: "doc-1",
      namespace: "presence",
      hopsRemaining: 1,
      toChannelIds: [], // Empty channels
    }

    handleBroadcastEphemeralNamespace(command, ctx)

    expect(ctx.logger.debug).toHaveBeenCalled()
    expect(ctx.queueSend).not.toHaveBeenCalled()
  })

  it("should use identity peerId in the message", () => {
    const mockStore = createMockEphemeralStore()
    mockStore.encodeAll = vi.fn(() => new Uint8Array([1, 2, 3]))

    const ctx = createMockCommandContext({
      getNamespacedStore: vi.fn(() => mockStore as any),
      identity: {
        peerId: "custom-peer-id" as PeerID,
        name: "custom",
        type: "bot",
      },
    })

    const command: BroadcastEphemeralNamespaceCommand = {
      type: "cmd/broadcast-ephemeral-namespace",
      docId: "doc-1",
      namespace: "presence",
      hopsRemaining: 1,
      toChannelIds: [42],
    }

    handleBroadcastEphemeralNamespace(command, ctx)

    const call = (ctx.queueSend as any).mock.calls[0]
    expect(call[1].stores[0].peerId).toBe("custom-peer-id")
  })

  it("should pass hopsRemaining in the message", () => {
    const mockStore = createMockEphemeralStore()
    mockStore.encodeAll = vi.fn(() => new Uint8Array([1, 2, 3]))

    const ctx = createMockCommandContext({
      getNamespacedStore: vi.fn(() => mockStore as any),
    })

    const command: BroadcastEphemeralNamespaceCommand = {
      type: "cmd/broadcast-ephemeral-namespace",
      docId: "doc-1",
      namespace: "presence",
      hopsRemaining: 5,
      toChannelIds: [42],
    }

    handleBroadcastEphemeralNamespace(command, ctx)

    const call = (ctx.queueSend as any).mock.calls[0]
    expect(call[1].hopsRemaining).toBe(5)
  })

  it("should include namespace in the store data", () => {
    const mockStore = createMockEphemeralStore()
    mockStore.encodeAll = vi.fn(() => new Uint8Array([1, 2, 3]))

    const ctx = createMockCommandContext({
      getNamespacedStore: vi.fn(() => mockStore as any),
    })

    const command: BroadcastEphemeralNamespaceCommand = {
      type: "cmd/broadcast-ephemeral-namespace",
      docId: "doc-1",
      namespace: "cursors",
      hopsRemaining: 1,
      toChannelIds: [42],
    }

    handleBroadcastEphemeralNamespace(command, ctx)

    const call = (ctx.queueSend as any).mock.calls[0]
    expect(call[1].stores[0].namespace).toBe("cursors")
  })
})
