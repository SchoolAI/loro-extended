import { describe, expect, it, vi } from "vitest"
import type { ChannelMsgBatch, ChannelMsgSyncRequest } from "../../channel.js"
import type { Command } from "../../synchronizer-program.js"
import { createMockCommandContext, createVersionVector } from "../test-utils.js"
import { handleSendMessage } from "./handle-send-message.js"

type SendMessageCommand = Extract<Command, { type: "cmd/send-message" }>

describe("handleSendMessage", () => {
  it("should queue message to all specified channels", () => {
    const ctx = createMockCommandContext({
      validateChannelForSend: vi.fn(() => true),
    })

    const message: ChannelMsgSyncRequest = {
      type: "channel/sync-request",
      docId: "doc-1",
      requesterDocVersion: createVersionVector(),
      bidirectional: true,
    }

    const command: SendMessageCommand = {
      type: "cmd/send-message",
      envelope: {
        toChannelIds: [42, 43, 44],
        message,
      },
    }

    handleSendMessage(command, ctx)

    expect(ctx.validateChannelForSend).toHaveBeenCalledTimes(3)
    expect(ctx.queueSend).toHaveBeenCalledTimes(3)
    expect(ctx.queueSend).toHaveBeenCalledWith(42, message)
    expect(ctx.queueSend).toHaveBeenCalledWith(43, message)
    expect(ctx.queueSend).toHaveBeenCalledWith(44, message)
  })

  it("should skip channels that fail validation", () => {
    const ctx = createMockCommandContext({
      validateChannelForSend: vi.fn(channelId => channelId !== 43),
    })

    const message: ChannelMsgSyncRequest = {
      type: "channel/sync-request",
      docId: "doc-1",
      requesterDocVersion: createVersionVector(),
      bidirectional: true,
    }

    const command: SendMessageCommand = {
      type: "cmd/send-message",
      envelope: {
        toChannelIds: [42, 43, 44],
        message,
      },
    }

    handleSendMessage(command, ctx)

    expect(ctx.queueSend).toHaveBeenCalledTimes(2)
    expect(ctx.queueSend).toHaveBeenCalledWith(42, message)
    expect(ctx.queueSend).not.toHaveBeenCalledWith(43, expect.anything())
    expect(ctx.queueSend).toHaveBeenCalledWith(44, message)
  })

  it("should flatten nested batch messages", () => {
    const ctx = createMockCommandContext({
      validateChannelForSend: vi.fn(() => true),
    })

    const innerMessage1: ChannelMsgSyncRequest = {
      type: "channel/sync-request",
      docId: "doc-1",
      requesterDocVersion: createVersionVector(),
      bidirectional: true,
    }

    const innerMessage2: ChannelMsgSyncRequest = {
      type: "channel/sync-request",
      docId: "doc-2",
      requesterDocVersion: createVersionVector(),
      bidirectional: true,
    }

    const batchMessage: ChannelMsgBatch = {
      type: "channel/batch",
      messages: [innerMessage1, innerMessage2],
    }

    const command: SendMessageCommand = {
      type: "cmd/send-message",
      envelope: {
        toChannelIds: [42],
        message: batchMessage,
      },
    }

    handleSendMessage(command, ctx)

    // Should flatten the batch and queue each inner message separately
    expect(ctx.queueSend).toHaveBeenCalledTimes(2)
    expect(ctx.queueSend).toHaveBeenCalledWith(42, innerMessage1)
    expect(ctx.queueSend).toHaveBeenCalledWith(42, innerMessage2)
  })

  it("should flatten batch to multiple channels", () => {
    const ctx = createMockCommandContext({
      validateChannelForSend: vi.fn(() => true),
    })

    const innerMessage1: ChannelMsgSyncRequest = {
      type: "channel/sync-request",
      docId: "doc-1",
      requesterDocVersion: createVersionVector(),
      bidirectional: true,
    }

    const innerMessage2: ChannelMsgSyncRequest = {
      type: "channel/sync-request",
      docId: "doc-2",
      requesterDocVersion: createVersionVector(),
      bidirectional: true,
    }

    const batchMessage: ChannelMsgBatch = {
      type: "channel/batch",
      messages: [innerMessage1, innerMessage2],
    }

    const command: SendMessageCommand = {
      type: "cmd/send-message",
      envelope: {
        toChannelIds: [42, 43],
        message: batchMessage,
      },
    }

    handleSendMessage(command, ctx)

    // 2 channels × 2 messages = 4 queueSend calls
    expect(ctx.queueSend).toHaveBeenCalledTimes(4)
    expect(ctx.queueSend).toHaveBeenCalledWith(42, innerMessage1)
    expect(ctx.queueSend).toHaveBeenCalledWith(42, innerMessage2)
    expect(ctx.queueSend).toHaveBeenCalledWith(43, innerMessage1)
    expect(ctx.queueSend).toHaveBeenCalledWith(43, innerMessage2)
  })

  it("should handle empty channel list", () => {
    const ctx = createMockCommandContext({
      validateChannelForSend: vi.fn(() => true),
    })

    const message: ChannelMsgSyncRequest = {
      type: "channel/sync-request",
      docId: "doc-1",
      requesterDocVersion: createVersionVector(),
      bidirectional: true,
    }

    const command: SendMessageCommand = {
      type: "cmd/send-message",
      envelope: {
        toChannelIds: [],
        message,
      },
    }

    handleSendMessage(command, ctx)

    expect(ctx.validateChannelForSend).not.toHaveBeenCalled()
    expect(ctx.queueSend).not.toHaveBeenCalled()
  })

  it("should handle all channels failing validation", () => {
    const ctx = createMockCommandContext({
      validateChannelForSend: vi.fn(() => false),
    })

    const message: ChannelMsgSyncRequest = {
      type: "channel/sync-request",
      docId: "doc-1",
      requesterDocVersion: createVersionVector(),
      bidirectional: true,
    }

    const command: SendMessageCommand = {
      type: "cmd/send-message",
      envelope: {
        toChannelIds: [42, 43],
        message,
      },
    }

    handleSendMessage(command, ctx)

    expect(ctx.validateChannelForSend).toHaveBeenCalledTimes(2)
    expect(ctx.queueSend).not.toHaveBeenCalled()
  })
})
