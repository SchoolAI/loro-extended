import { getLogger } from "@logtape/logtape"
import { LoroDoc, type PeerID } from "loro-crdt"
import { describe, expect, it, vi } from "vitest"
import type {
  BatchableMsg,
  Channel,
  ChannelMsg,
  EstablishedChannel,
} from "../channel.js"
import type { Middleware, MiddlewareResult } from "../middleware.js"
import type { ChannelId, DocId, DocState, PeerState } from "../types.js"
import {
  MiddlewareProcessor,
  type ModelAccessor,
} from "./middleware-processor.js"

const logger = getLogger(["test"])

// Helper to create a mock model accessor
// Use `null` to explicitly indicate "no channel/peer/doc" (empty map)
// Use `undefined` or omit to use defaults
function createMockModelAccessor(
  overrides: {
    channel?: Channel | null
    peerState?: PeerState | null
    docState?: DocState | null
  } = {},
): ModelAccessor {
  const defaultPeerState: PeerState = {
    identity: {
      peerId: "1" as PeerID,
      name: "test-peer",
      type: "user",
    },
    documentAwareness: new Map(),
    subscriptions: new Set(),
    lastSeen: new Date(),
    channels: new Set([1 as ChannelId]),
  }

  const defaultChannel: EstablishedChannel = {
    type: "established",
    channelId: 1 as ChannelId,
    kind: "network",
    adapterType: "test",
    peerId: "1" as PeerID,
    send: vi.fn(),
    stop: vi.fn(),
    onReceive: vi.fn(),
  }

  const defaultDoc: DocState = {
    doc: new LoroDoc(),
    docId: "doc-1" as DocId,
  }

  // Use null to explicitly indicate "no channel" (empty map)
  // Use undefined or omit to use defaults
  const channel = "channel" in overrides ? overrides.channel : defaultChannel
  const peerState =
    "peerState" in overrides ? overrides.peerState : defaultPeerState
  const docState = "docState" in overrides ? overrides.docState : defaultDoc

  const channels = new Map<ChannelId, Channel>()
  if (channel) {
    channels.set(channel.channelId, channel)
  }

  const peers = new Map<PeerID, PeerState>()
  if (peerState) {
    peers.set(peerState.identity.peerId, peerState)
  }

  const documents = new Map<DocId, DocState>()
  if (docState) {
    documents.set(docState.docId, docState)
  }

  return { channels, peers, documents }
}

// Helper to create a simple middleware
function createMiddleware(
  name: string,
  check: (ctx: unknown) => MiddlewareResult | Promise<MiddlewareResult>,
): Middleware {
  return {
    name,
    check: check as Middleware["check"],
  }
}

describe("MiddlewareProcessor", () => {
  describe("hasMiddleware", () => {
    it("should return false when no middleware configured", () => {
      const model = createMockModelAccessor()
      const processor = new MiddlewareProcessor([], () => model, logger)
      expect(processor.hasMiddleware).toBe(false)
    })

    it("should return true when middleware is configured", () => {
      const middleware = [createMiddleware("test", () => ({ allow: true }))]
      const model = createMockModelAccessor()
      const processor = new MiddlewareProcessor(middleware, () => model, logger)
      expect(processor.hasMiddleware).toBe(true)
    })
  })

  describe("count", () => {
    it("should return the number of middleware", () => {
      const middleware = [
        createMiddleware("test1", () => ({ allow: true })),
        createMiddleware("test2", () => ({ allow: true })),
      ]
      const model = createMockModelAccessor()
      const processor = new MiddlewareProcessor(middleware, () => model, logger)
      expect(processor.count).toBe(2)
    })
  })

  describe("processMessage", () => {
    it("should return no-middleware when no middleware configured", async () => {
      const model = createMockModelAccessor()
      const processor = new MiddlewareProcessor([], () => model, logger)
      const message: ChannelMsg = { type: "channel/directory-request" }

      const result = await processor.processMessage(1 as ChannelId, message)

      expect(result.type).toBe("no-middleware")
    })

    it("should return no-middleware when channel not found", async () => {
      const middleware = [createMiddleware("test", () => ({ allow: true }))]
      // Create model with no channel (null means empty channels map)
      const model = createMockModelAccessor({ channel: null })
      const processor = new MiddlewareProcessor(middleware, () => model, logger)
      const message: ChannelMsg = { type: "channel/directory-request" }

      const result = await processor.processMessage(1 as ChannelId, message)

      expect(result.type).toBe("no-middleware")
    })

    it("should return no-middleware when channel not established", async () => {
      const middleware = [createMiddleware("test", () => ({ allow: true }))]
      const connectedChannel: Channel = {
        type: "connected",
        channelId: 1 as ChannelId,
        kind: "network",
        adapterType: "test",
        send: vi.fn(),
        stop: vi.fn(),
        onReceive: vi.fn(),
      }
      const model = createMockModelAccessor({ channel: connectedChannel })
      const processor = new MiddlewareProcessor(middleware, () => model, logger)
      const message: ChannelMsg = { type: "channel/directory-request" }

      const result = await processor.processMessage(1 as ChannelId, message)

      expect(result.type).toBe("no-middleware")
    })

    it("should return allowed when middleware allows", async () => {
      const middleware = [createMiddleware("test", () => ({ allow: true }))]
      const model = createMockModelAccessor()
      const processor = new MiddlewareProcessor(middleware, () => model, logger)
      const message: ChannelMsg = { type: "channel/directory-request" }

      const result = await processor.processMessage(1 as ChannelId, message)

      expect(result.type).toBe("allowed")
      if (result.type === "allowed") {
        expect(result.message).toBe(message)
      }
    })

    it("should return rejected when middleware rejects", async () => {
      const middleware = [
        createMiddleware("test", () => ({
          allow: false,
          reason: "test rejection",
        })),
      ]
      const model = createMockModelAccessor()
      const processor = new MiddlewareProcessor(middleware, () => model, logger)
      const message: ChannelMsg = { type: "channel/directory-request" }

      const result = await processor.processMessage(1 as ChannelId, message)

      expect(result.type).toBe("rejected")
    })

    it("should handle async middleware", async () => {
      const middleware = [
        createMiddleware("async-test", async () => {
          await new Promise(resolve => setTimeout(resolve, 10))
          return { allow: true }
        }),
      ]
      const model = createMockModelAccessor()
      const processor = new MiddlewareProcessor(middleware, () => model, logger)
      const message: ChannelMsg = { type: "channel/directory-request" }

      const result = await processor.processMessage(1 as ChannelId, message)

      expect(result.type).toBe("allowed")
    })

    it("should short-circuit on first rejection", async () => {
      const secondMiddleware = vi.fn().mockReturnValue({ allow: true })
      const middleware = [
        createMiddleware("rejecter", () => ({ allow: false })),
        createMiddleware("never-called", secondMiddleware),
      ]
      const model = createMockModelAccessor()
      const processor = new MiddlewareProcessor(middleware, () => model, logger)
      const message: ChannelMsg = { type: "channel/directory-request" }

      const result = await processor.processMessage(1 as ChannelId, message)

      expect(result.type).toBe("rejected")
      expect(secondMiddleware).not.toHaveBeenCalled()
    })
  })

  describe("processBatch", () => {
    it("should return no-middleware when no middleware configured", async () => {
      const model = createMockModelAccessor()
      const processor = new MiddlewareProcessor([], () => model, logger)
      const messages: BatchableMsg[] = [
        { type: "channel/directory-request" },
        { type: "channel/directory-request" },
      ]

      const result = await processor.processBatch(1 as ChannelId, messages)

      expect(result.type).toBe("no-middleware")
    })

    it("should return rejected when all messages rejected", async () => {
      const middleware = [
        createMiddleware("rejecter", () => ({ allow: false })),
      ]
      const model = createMockModelAccessor()
      const processor = new MiddlewareProcessor(middleware, () => model, logger)
      const messages: BatchableMsg[] = [
        { type: "channel/directory-request" },
        { type: "channel/directory-request" },
      ]

      const result = await processor.processBatch(1 as ChannelId, messages)

      expect(result.type).toBe("rejected")
    })

    it("should return allowed with single message when only one passes", async () => {
      let callCount = 0
      const middleware = [
        createMiddleware("selective", () => {
          callCount++
          return { allow: callCount === 1 } // Only allow first message
        }),
      ]
      const model = createMockModelAccessor()
      const processor = new MiddlewareProcessor(middleware, () => model, logger)
      const messages: BatchableMsg[] = [
        { type: "channel/directory-request" },
        { type: "channel/directory-request" },
      ]

      const result = await processor.processBatch(1 as ChannelId, messages)

      expect(result.type).toBe("allowed")
      if (result.type === "allowed") {
        expect(result.message).toBe(messages[0])
      }
    })

    it("should return allowed-batch when multiple messages pass", async () => {
      const middleware = [createMiddleware("allower", () => ({ allow: true }))]
      const model = createMockModelAccessor()
      const processor = new MiddlewareProcessor(middleware, () => model, logger)
      const messages: BatchableMsg[] = [
        { type: "channel/directory-request" },
        { type: "channel/directory-request" },
      ]

      const result = await processor.processBatch(1 as ChannelId, messages)

      expect(result.type).toBe("allowed-batch")
      if (result.type === "allowed-batch") {
        expect(result.messages).toHaveLength(2)
      }
    })

    it("should filter out rejected messages from batch", async () => {
      let callCount = 0
      const middleware = [
        createMiddleware("selective", () => {
          callCount++
          return { allow: callCount !== 2 } // Reject second message
        }),
      ]
      const model = createMockModelAccessor()
      const processor = new MiddlewareProcessor(middleware, () => model, logger)
      const messages: BatchableMsg[] = [
        { type: "channel/directory-request" },
        { type: "channel/directory-request" },
        { type: "channel/directory-request" },
      ]

      const result = await processor.processBatch(1 as ChannelId, messages)

      expect(result.type).toBe("allowed-batch")
      if (result.type === "allowed-batch") {
        expect(result.messages).toHaveLength(2)
        expect(result.messages).toContain(messages[0])
        expect(result.messages).not.toContain(messages[1])
        expect(result.messages).toContain(messages[2])
      }
    })
  })

  describe("context extraction", () => {
    it("should extract docId from message", async () => {
      let capturedContext: unknown
      const middleware = [
        createMiddleware("capture", ctx => {
          capturedContext = ctx
          return { allow: true }
        }),
      ]
      const model = createMockModelAccessor()
      const processor = new MiddlewareProcessor(middleware, () => model, logger)
      const message: ChannelMsg = {
        type: "channel/ephemeral",
        docId: "doc-1" as DocId,
        hopsRemaining: 0,
        stores: [],
      }

      await processor.processMessage(1 as ChannelId, message)

      expect(capturedContext).toBeDefined()
      expect(
        (capturedContext as { document?: { id: string } }).document?.id,
      ).toBe("doc-1")
    })

    it("should extract transmission info from sync-response", async () => {
      let capturedContext: unknown
      const middleware = [
        createMiddleware("capture", ctx => {
          capturedContext = ctx
          return { allow: true }
        }),
      ]
      const model = createMockModelAccessor()
      const processor = new MiddlewareProcessor(middleware, () => model, logger)
      const message: ChannelMsg = {
        type: "channel/sync-response",
        docId: "doc-1" as DocId,
        transmission: {
          type: "snapshot",
          data: new Uint8Array(100),
          version: {} as never,
        },
      }

      await processor.processMessage(1 as ChannelId, message)

      expect(capturedContext).toBeDefined()
      const ctx = capturedContext as {
        transmission?: { type: string; sizeBytes: number }
      }
      expect(ctx.transmission?.type).toBe("snapshot")
      expect(ctx.transmission?.sizeBytes).toBe(100)
    })

    it("should include peer context", async () => {
      let capturedContext: unknown
      const middleware = [
        createMiddleware("capture", ctx => {
          capturedContext = ctx
          return { allow: true }
        }),
      ]
      const model = createMockModelAccessor()
      const processor = new MiddlewareProcessor(middleware, () => model, logger)
      const message: ChannelMsg = { type: "channel/directory-request" }

      await processor.processMessage(1 as ChannelId, message)

      expect(capturedContext).toBeDefined()
      const ctx = capturedContext as {
        peer: { peerId: string; peerName: string }
      }
      expect(ctx.peer.peerId).toBe("1")
      expect(ctx.peer.peerName).toBe("test-peer")
    })
  })
})
