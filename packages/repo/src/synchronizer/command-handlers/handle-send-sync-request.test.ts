import { describe, expect, it, vi } from "vitest"
import type { ChannelMsgSyncRequest } from "../../channel.js"
import type { Command } from "../../synchronizer-program.js"
import {
  createMockChannel,
  createMockCommandContext,
  createVersionVector,
} from "../test-utils.js"
import { handleSendSyncRequest } from "./handle-send-sync-request.js"

type SendSyncRequestCommand = Extract<
  Command,
  { type: "cmd/send-sync-request" }
>

describe("handleSendSyncRequest", () => {
  it("should build and queue sync-request messages for each doc", () => {
    const mockMessage: ChannelMsgSyncRequest = {
      type: "channel/sync-request",
      docId: "doc-1",
      requesterDocVersion: createVersionVector(),
      bidirectional: true,
    }

    const channel = createMockChannel({ channelId: 42 })
    const ctx = createMockCommandContext({
      buildSyncRequestMessage: vi.fn(() => mockMessage),
    })
    ctx.model.channels.set(42, channel)

    const command: SendSyncRequestCommand = {
      type: "cmd/send-sync-request",
      toChannelId: 42,
      docs: [
        { docId: "doc-1", requesterDocVersion: createVersionVector() },
        { docId: "doc-2", requesterDocVersion: createVersionVector() },
      ],
      bidirectional: true,
    }

    handleSendSyncRequest(command, ctx)

    expect(ctx.buildSyncRequestMessage).toHaveBeenCalledTimes(2)
    expect(ctx.queueSend).toHaveBeenCalledTimes(2)
    expect(ctx.queueSend).toHaveBeenCalledWith(42, mockMessage)
  })

  it("should warn and return if channel does not exist", () => {
    const ctx = createMockCommandContext()
    // Channel 99 does not exist in model

    const command: SendSyncRequestCommand = {
      type: "cmd/send-sync-request",
      toChannelId: 99,
      docs: [{ docId: "doc-1", requesterDocVersion: createVersionVector() }],
      bidirectional: true,
    }

    handleSendSyncRequest(command, ctx)

    expect(ctx.logger.warn).toHaveBeenCalled()
    expect(ctx.buildSyncRequestMessage).not.toHaveBeenCalled()
    expect(ctx.queueSend).not.toHaveBeenCalled()
  })

  it("should pass bidirectional flag to buildSyncRequestMessage", () => {
    const channel = createMockChannel({ channelId: 42 })
    const ctx = createMockCommandContext({
      buildSyncRequestMessage: vi.fn(() => ({
        type: "channel/sync-request" as const,
        docId: "doc-1",
        requesterDocVersion: createVersionVector(),
        bidirectional: false,
      })),
    })
    ctx.model.channels.set(42, channel)

    const command: SendSyncRequestCommand = {
      type: "cmd/send-sync-request",
      toChannelId: 42,
      docs: [{ docId: "doc-1", requesterDocVersion: createVersionVector() }],
      bidirectional: false,
    }

    handleSendSyncRequest(command, ctx)

    expect(ctx.buildSyncRequestMessage).toHaveBeenCalledWith(
      expect.objectContaining({ docId: "doc-1" }),
      false,
      undefined,
    )
  })

  it("should pass includeEphemeral flag to buildSyncRequestMessage", () => {
    const channel = createMockChannel({ channelId: 42 })
    const ctx = createMockCommandContext({
      buildSyncRequestMessage: vi.fn(() => ({
        type: "channel/sync-request" as const,
        docId: "doc-1",
        requesterDocVersion: createVersionVector(),
        bidirectional: true,
      })),
    })
    ctx.model.channels.set(42, channel)

    const command: SendSyncRequestCommand = {
      type: "cmd/send-sync-request",
      toChannelId: 42,
      docs: [{ docId: "doc-1", requesterDocVersion: createVersionVector() }],
      bidirectional: true,
      includeEphemeral: true,
    }

    handleSendSyncRequest(command, ctx)

    expect(ctx.buildSyncRequestMessage).toHaveBeenCalledWith(
      expect.objectContaining({ docId: "doc-1" }),
      true,
      true,
    )
  })

  it("should handle empty docs array", () => {
    const channel = createMockChannel({ channelId: 42 })
    const ctx = createMockCommandContext()
    ctx.model.channels.set(42, channel)

    const command: SendSyncRequestCommand = {
      type: "cmd/send-sync-request",
      toChannelId: 42,
      docs: [],
      bidirectional: true,
    }

    handleSendSyncRequest(command, ctx)

    expect(ctx.buildSyncRequestMessage).not.toHaveBeenCalled()
    expect(ctx.queueSend).not.toHaveBeenCalled()
  })

  it("should queue each doc request individually for batching", () => {
    const channel = createMockChannel({ channelId: 42 })
    let callCount = 0
    const ctx = createMockCommandContext({
      buildSyncRequestMessage: vi.fn(() => {
        callCount++
        return {
          type: "channel/sync-request" as const,
          docId: `doc-${callCount}`,
          requesterDocVersion: createVersionVector(),
          bidirectional: true,
        }
      }),
    })
    ctx.model.channels.set(42, channel)

    const command: SendSyncRequestCommand = {
      type: "cmd/send-sync-request",
      toChannelId: 42,
      docs: [
        { docId: "doc-1", requesterDocVersion: createVersionVector() },
        { docId: "doc-2", requesterDocVersion: createVersionVector() },
        { docId: "doc-3", requesterDocVersion: createVersionVector() },
      ],
      bidirectional: true,
    }

    handleSendSyncRequest(command, ctx)

    // Each doc should result in a separate queueSend call
    // The deferred send layer will aggregate them at flush time
    expect(ctx.queueSend).toHaveBeenCalledTimes(3)
  })
})
