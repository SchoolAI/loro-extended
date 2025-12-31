import type { PeerID } from "loro-crdt"
import { describe, expect, it, vi } from "vitest"
import type { Command } from "../../synchronizer-program.js"
import {
  createMockCommandContext,
  createMockEphemeralStore,
} from "../test-utils.js"
import { handleApplyEphemeral } from "./handle-apply-ephemeral.js"

type ApplyEphemeralCommand = Extract<Command, { type: "cmd/apply-ephemeral" }>

describe("handleApplyEphemeral", () => {
  it("should apply ephemeral data to namespaced store", () => {
    const mockStore = createMockEphemeralStore()
    const ctx = createMockCommandContext({
      getOrCreateNamespacedStore: vi.fn(() => mockStore as any),
    })

    const command: ApplyEphemeralCommand = {
      type: "cmd/apply-ephemeral",
      docId: "doc-1",
      stores: [
        {
          peerId: "peer-1" as PeerID,
          data: new Uint8Array([1, 2, 3]),
          namespace: "presence",
        },
      ],
    }

    handleApplyEphemeral(command, ctx)

    expect(ctx.getOrCreateNamespacedStore).toHaveBeenCalledWith(
      "doc-1",
      "presence",
    )
    expect(mockStore.apply).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]))
  })

  it("should emit ephemeral-change event for each store", async () => {
    const mockStore = createMockEphemeralStore()
    const ctx = createMockCommandContext({
      getOrCreateNamespacedStore: vi.fn(() => mockStore as any),
    })

    const emitSpy = vi.spyOn(ctx.emitter, "emit")

    const command: ApplyEphemeralCommand = {
      type: "cmd/apply-ephemeral",
      docId: "doc-1",
      stores: [
        {
          peerId: "peer-1" as PeerID,
          data: new Uint8Array([1, 2, 3]),
          namespace: "presence",
        },
      ],
    }

    handleApplyEphemeral(command, ctx)

    expect(emitSpy).toHaveBeenCalledWith("ephemeral-change", {
      docId: "doc-1",
      source: "remote",
      peerId: "peer-1",
    })
  })

  it("should skip stores without namespace", () => {
    const mockStore = createMockEphemeralStore()
    const ctx = createMockCommandContext({
      getOrCreateNamespacedStore: vi.fn(() => mockStore as any),
    })

    const command: ApplyEphemeralCommand = {
      type: "cmd/apply-ephemeral",
      docId: "doc-1",
      stores: [
        {
          peerId: "peer-1" as PeerID,
          data: new Uint8Array([1, 2, 3]),
          namespace: "", // Empty namespace
        },
      ],
    }

    handleApplyEphemeral(command, ctx)

    // Should warn and not create store
    expect(ctx.logger.warn).toHaveBeenCalled()
    expect(ctx.getOrCreateNamespacedStore).not.toHaveBeenCalled()
  })

  it("should handle empty data gracefully", async () => {
    const mockStore = createMockEphemeralStore()
    const ctx = createMockCommandContext({
      getOrCreateNamespacedStore: vi.fn(() => mockStore as any),
    })

    const emitSpy = vi.spyOn(ctx.emitter, "emit")

    const command: ApplyEphemeralCommand = {
      type: "cmd/apply-ephemeral",
      docId: "doc-1",
      stores: [
        {
          peerId: "peer-1" as PeerID,
          data: new Uint8Array(0), // Empty data
          namespace: "presence",
        },
      ],
    }

    handleApplyEphemeral(command, ctx)

    // Should log debug and NOT apply to store (empty data signals deletion)
    expect(ctx.logger.debug).toHaveBeenCalled()
    expect(mockStore.apply).not.toHaveBeenCalled()
    // But should still emit change event
    expect(emitSpy).toHaveBeenCalledWith("ephemeral-change", {
      docId: "doc-1",
      source: "remote",
      peerId: "peer-1",
    })
  })

  it("should apply multiple stores from different peers", () => {
    const mockStore = createMockEphemeralStore()
    const ctx = createMockCommandContext({
      getOrCreateNamespacedStore: vi.fn(() => mockStore as any),
    })

    const command: ApplyEphemeralCommand = {
      type: "cmd/apply-ephemeral",
      docId: "doc-1",
      stores: [
        {
          peerId: "peer-1" as PeerID,
          data: new Uint8Array([1, 2, 3]),
          namespace: "presence",
        },
        {
          peerId: "peer-2" as PeerID,
          data: new Uint8Array([4, 5, 6]),
          namespace: "cursors",
        },
      ],
    }

    handleApplyEphemeral(command, ctx)

    expect(ctx.getOrCreateNamespacedStore).toHaveBeenCalledTimes(2)
    expect(ctx.getOrCreateNamespacedStore).toHaveBeenCalledWith(
      "doc-1",
      "presence",
    )
    expect(ctx.getOrCreateNamespacedStore).toHaveBeenCalledWith(
      "doc-1",
      "cursors",
    )
    expect(mockStore.apply).toHaveBeenCalledTimes(2)
  })

  it("should handle mixed valid and invalid stores", async () => {
    const mockStore = createMockEphemeralStore()
    const ctx = createMockCommandContext({
      getOrCreateNamespacedStore: vi.fn(() => mockStore as any),
    })

    const emitSpy = vi.spyOn(ctx.emitter, "emit")

    const command: ApplyEphemeralCommand = {
      type: "cmd/apply-ephemeral",
      docId: "doc-1",
      stores: [
        {
          peerId: "peer-1" as PeerID,
          data: new Uint8Array([1, 2, 3]),
          namespace: "presence",
        },
        {
          peerId: "peer-2" as PeerID,
          data: new Uint8Array([4, 5, 6]),
          namespace: "", // Invalid - no namespace
        },
      ],
    }

    handleApplyEphemeral(command, ctx)

    // First store should be applied
    expect(ctx.getOrCreateNamespacedStore).toHaveBeenCalledTimes(1)
    expect(mockStore.apply).toHaveBeenCalledTimes(1)

    // Only valid stores emit events (invalid ones are skipped with warning)
    expect(emitSpy).toHaveBeenCalledTimes(1)
  })
})
