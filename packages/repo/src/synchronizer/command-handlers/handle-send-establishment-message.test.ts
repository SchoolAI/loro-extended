import type { PeerID } from "loro-crdt"
import { describe, expect, it, vi } from "vitest"
import type { Command } from "../../synchronizer-program.js"
import {
  createMockAdapterManager,
  createMockCommandContext,
} from "../test-utils.js"
import { handleSendEstablishmentMessage } from "./handle-send-establishment-message.js"

type SendEstablishmentMessageCommand = Extract<
  Command,
  { type: "cmd/send-establishment-message" }
>

describe("handleSendEstablishmentMessage", () => {
  it("should send establishment message via adapter manager", () => {
    const mockAdapters = createMockAdapterManager()
    mockAdapters.sendEstablishmentMessage = vi.fn(() => 1)

    const ctx = createMockCommandContext({
      adapters: mockAdapters as any,
    })

    const command: SendEstablishmentMessageCommand = {
      type: "cmd/send-establishment-message",
      envelope: {
        toChannelIds: [42],
        message: {
          type: "channel/establish-request",
          identity: {
            peerId: "test-peer" as PeerID,
            name: "test",
            type: "user",
          },
        },
      },
    }

    handleSendEstablishmentMessage(command, ctx)

    expect(mockAdapters.sendEstablishmentMessage).toHaveBeenCalledWith(
      command.envelope,
    )
  })

  it("should log debug info about the message", () => {
    const mockAdapters = createMockAdapterManager()
    mockAdapters.sendEstablishmentMessage = vi.fn(() => 1)

    const ctx = createMockCommandContext({
      adapters: mockAdapters as any,
    })

    const command: SendEstablishmentMessageCommand = {
      type: "cmd/send-establishment-message",
      envelope: {
        toChannelIds: [42],
        message: {
          type: "channel/establish-request",
          identity: {
            peerId: "test-peer" as PeerID,
            name: "test",
            type: "user",
          },
        },
      },
    }

    handleSendEstablishmentMessage(command, ctx)

    expect(ctx.logger.debug).toHaveBeenCalled()
  })

  it("should warn when not all channels received the message", () => {
    const mockAdapters = createMockAdapterManager()
    mockAdapters.sendEstablishmentMessage = vi.fn(() => 1) // Only 1 sent

    const ctx = createMockCommandContext({
      adapters: mockAdapters as any,
    })

    const command: SendEstablishmentMessageCommand = {
      type: "cmd/send-establishment-message",
      envelope: {
        toChannelIds: [42, 43, 44], // 3 channels expected
        message: {
          type: "channel/establish-request",
          identity: {
            peerId: "test-peer" as PeerID,
            name: "test",
            type: "user",
          },
        },
      },
    }

    handleSendEstablishmentMessage(command, ctx)

    expect(ctx.logger.warn).toHaveBeenCalled()
  })

  it("should not warn when all channels received the message", () => {
    const mockAdapters = createMockAdapterManager()
    mockAdapters.sendEstablishmentMessage = vi.fn(() => 2) // All 2 sent

    const ctx = createMockCommandContext({
      adapters: mockAdapters as any,
    })

    const command: SendEstablishmentMessageCommand = {
      type: "cmd/send-establishment-message",
      envelope: {
        toChannelIds: [42, 43], // 2 channels expected
        message: {
          type: "channel/establish-response",
          identity: {
            peerId: "test-peer" as PeerID,
            name: "test",
            type: "user",
          },
        },
      },
    }

    handleSendEstablishmentMessage(command, ctx)

    expect(ctx.logger.warn).not.toHaveBeenCalled()
  })

  it("should handle establish-response message type", () => {
    const mockAdapters = createMockAdapterManager()
    mockAdapters.sendEstablishmentMessage = vi.fn(() => 1)

    const ctx = createMockCommandContext({
      adapters: mockAdapters as any,
    })

    const command: SendEstablishmentMessageCommand = {
      type: "cmd/send-establishment-message",
      envelope: {
        toChannelIds: [42],
        message: {
          type: "channel/establish-response",
          identity: {
            peerId: "test-peer" as PeerID,
            name: "test",
            type: "user",
          },
        },
      },
    }

    handleSendEstablishmentMessage(command, ctx)

    expect(mockAdapters.sendEstablishmentMessage).toHaveBeenCalledWith(
      command.envelope,
    )
  })

  it("should handle zero channels sent", () => {
    const mockAdapters = createMockAdapterManager()
    mockAdapters.sendEstablishmentMessage = vi.fn(() => 0) // None sent

    const ctx = createMockCommandContext({
      adapters: mockAdapters as any,
    })

    const command: SendEstablishmentMessageCommand = {
      type: "cmd/send-establishment-message",
      envelope: {
        toChannelIds: [42],
        message: {
          type: "channel/establish-request",
          identity: {
            peerId: "test-peer" as PeerID,
            name: "test",
            type: "user",
          },
        },
      },
    }

    handleSendEstablishmentMessage(command, ctx)

    expect(ctx.logger.warn).toHaveBeenCalled()
  })
})
