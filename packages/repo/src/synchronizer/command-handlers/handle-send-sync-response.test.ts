import { describe, expect, it, vi } from "vitest"
import type { ChannelMsgSyncResponse } from "../../channel.js"
import type { Command } from "../../synchronizer-program.js"
import { createMockCommandContext, createVersionVector } from "../test-utils.js"
import { handleSendSyncResponse } from "./handle-send-sync-response.js"

type SendSyncResponseCommand = Extract<
  Command,
  { type: "cmd/send-sync-response" }
>

describe("handleSendSyncResponse", () => {
  it("should build and queue sync-response message", () => {
    const mockMessage: ChannelMsgSyncResponse = {
      type: "channel/sync-response",
      docId: "doc-1",
      transmission: {
        type: "snapshot",
        data: new Uint8Array([1, 2, 3]),
        version: createVersionVector(),
      },
    }

    const ctx = createMockCommandContext({
      buildSyncResponseMessage: vi.fn(() => mockMessage),
    })

    const requesterDocVersion = createVersionVector()
    const command: SendSyncResponseCommand = {
      type: "cmd/send-sync-response",
      docId: "doc-1",
      requesterDocVersion,
      toChannelId: 42,
      includeEphemeral: true,
    }

    handleSendSyncResponse(command, ctx)

    expect(ctx.buildSyncResponseMessage).toHaveBeenCalledWith(
      "doc-1",
      requesterDocVersion,
      42,
      true,
    )
    expect(ctx.queueSend).toHaveBeenCalledWith(42, mockMessage)
  })

  it("should not queue if buildSyncResponseMessage returns undefined", () => {
    const ctx = createMockCommandContext({
      buildSyncResponseMessage: vi.fn(() => undefined),
    })

    const command: SendSyncResponseCommand = {
      type: "cmd/send-sync-response",
      docId: "doc-1",
      requesterDocVersion: createVersionVector(),
      toChannelId: 42,
    }

    handleSendSyncResponse(command, ctx)

    expect(ctx.buildSyncResponseMessage).toHaveBeenCalled()
    expect(ctx.queueSend).not.toHaveBeenCalled()
  })

  it("should pass includeEphemeral=false when not specified", () => {
    const mockMessage: ChannelMsgSyncResponse = {
      type: "channel/sync-response",
      docId: "doc-1",
      transmission: { type: "up-to-date", version: createVersionVector() },
    }

    const ctx = createMockCommandContext({
      buildSyncResponseMessage: vi.fn(() => mockMessage),
    })

    const command: SendSyncResponseCommand = {
      type: "cmd/send-sync-response",
      docId: "doc-1",
      requesterDocVersion: createVersionVector(),
      toChannelId: 42,
      // includeEphemeral not specified
    }

    handleSendSyncResponse(command, ctx)

    expect(ctx.buildSyncResponseMessage).toHaveBeenCalledWith(
      "doc-1",
      expect.anything(),
      42,
      undefined,
    )
  })

  it("should handle up-to-date transmission", () => {
    const mockMessage: ChannelMsgSyncResponse = {
      type: "channel/sync-response",
      docId: "doc-1",
      transmission: { type: "up-to-date", version: createVersionVector() },
    }

    const ctx = createMockCommandContext({
      buildSyncResponseMessage: vi.fn(() => mockMessage),
    })

    const command: SendSyncResponseCommand = {
      type: "cmd/send-sync-response",
      docId: "doc-1",
      requesterDocVersion: createVersionVector(),
      toChannelId: 42,
    }

    handleSendSyncResponse(command, ctx)

    expect(ctx.queueSend).toHaveBeenCalledWith(42, mockMessage)
  })

  it("should handle update transmission", () => {
    const mockMessage: ChannelMsgSyncResponse = {
      type: "channel/sync-response",
      docId: "doc-1",
      transmission: {
        type: "update",
        data: new Uint8Array([4, 5, 6]),
        version: createVersionVector(),
      },
    }

    const ctx = createMockCommandContext({
      buildSyncResponseMessage: vi.fn(() => mockMessage),
    })

    const command: SendSyncResponseCommand = {
      type: "cmd/send-sync-response",
      docId: "doc-1",
      requesterDocVersion: createVersionVector(),
      toChannelId: 42,
    }

    handleSendSyncResponse(command, ctx)

    expect(ctx.queueSend).toHaveBeenCalledWith(42, mockMessage)
  })

  it("should handle unavailable transmission", () => {
    const mockMessage: ChannelMsgSyncResponse = {
      type: "channel/sync-response",
      docId: "doc-1",
      transmission: { type: "unavailable" },
    }

    const ctx = createMockCommandContext({
      buildSyncResponseMessage: vi.fn(() => mockMessage),
    })

    const command: SendSyncResponseCommand = {
      type: "cmd/send-sync-response",
      docId: "doc-1",
      requesterDocVersion: createVersionVector(),
      toChannelId: 42,
    }

    handleSendSyncResponse(command, ctx)

    expect(ctx.queueSend).toHaveBeenCalledWith(42, mockMessage)
  })
})
