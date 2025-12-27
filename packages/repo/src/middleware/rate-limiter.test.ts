import { LoroDoc, VersionVector } from "loro-crdt"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type {
  ChannelMsgDirectoryRequest,
  ChannelMsgSyncRequest,
  ChannelMsgSyncResponse,
} from "../channel.js"
import type { MiddlewareContext } from "../middleware.js"
import type { ChannelId, PeerID } from "../types.js"
import {
  createMessageTypeRateLimiter,
  createRateLimiter,
} from "./rate-limiter.js"

// Helper to create valid mock messages
function createSyncRequest(): ChannelMsgSyncRequest {
  return {
    type: "channel/sync-request",
    docId: "test-doc",
    requesterDocVersion: new VersionVector(null),
    bidirectional: true,
  }
}

function createDirectoryRequest(): ChannelMsgDirectoryRequest {
  return {
    type: "channel/directory-request",
  }
}

function createSyncResponse(): ChannelMsgSyncResponse {
  return {
    type: "channel/sync-response",
    docId: "test-doc",
    transmission: {
      type: "snapshot",
      data: new Uint8Array(),
      version: new VersionVector(null),
    },
  }
}

// Helper to create a mock context
function createMockContext(
  overrides: Partial<MiddlewareContext> = {},
): MiddlewareContext {
  return {
    message: createSyncRequest(),
    peer: {
      peerId: "peer-1" as PeerID,
      peerName: "Test Peer",
      peerType: "user",
      channelId: 1 as ChannelId,
      channelKind: "network",
    },
    ...overrides,
  }
}

describe("Rate Limiter Middleware", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe("createRateLimiter", () => {
    it("should allow requests under the limit", async () => {
      const limiter = createRateLimiter({
        maxRequests: 5,
        windowMs: 1000,
        cleanupIntervalMs: 0, // Disable cleanup for tests
      })

      const ctx = createMockContext()

      // First 5 requests should be allowed
      for (let i = 0; i < 5; i++) {
        const result = await limiter.check(ctx)
        expect(result.allow).toBe(true)
      }
    })

    it("should reject requests over the limit", async () => {
      const limiter = createRateLimiter({
        maxRequests: 3,
        windowMs: 1000,
        cleanupIntervalMs: 0,
      })

      const ctx = createMockContext()

      // First 3 requests should be allowed
      for (let i = 0; i < 3; i++) {
        const result = await limiter.check(ctx)
        expect(result.allow).toBe(true)
      }

      // 4th request should be rejected
      const result = await limiter.check(ctx)
      expect(result.allow).toBe(false)
      if (!result.allow) {
        expect(result.reason).toContain("Rate limit exceeded")
      }
    })

    it("should reset after the window expires", async () => {
      const limiter = createRateLimiter({
        maxRequests: 2,
        windowMs: 1000,
        cleanupIntervalMs: 0,
      })

      const ctx = createMockContext()

      // Use up the limit
      await limiter.check(ctx)
      await limiter.check(ctx)
      const rejectedResult = await limiter.check(ctx)
      expect(rejectedResult.allow).toBe(false)

      // Advance time past the window
      vi.advanceTimersByTime(1001)

      // Should be allowed again
      const allowedResult = await limiter.check(ctx)
      expect(allowedResult.allow).toBe(true)
    })

    it("should track different peers separately", async () => {
      const limiter = createRateLimiter({
        maxRequests: 2,
        windowMs: 1000,
        cleanupIntervalMs: 0,
      })

      const ctx1 = createMockContext({
        peer: {
          peerId: "peer-1" as PeerID,
          peerType: "user",
          channelId: 1 as ChannelId,
          channelKind: "network",
        },
      })

      const ctx2 = createMockContext({
        peer: {
          peerId: "peer-2" as PeerID,
          peerType: "user",
          channelId: 2 as ChannelId,
          channelKind: "network",
        },
      })

      // Use up peer-1's limit
      await limiter.check(ctx1)
      await limiter.check(ctx1)
      const peer1Rejected = await limiter.check(ctx1)
      expect(peer1Rejected.allow).toBe(false)

      // peer-2 should still have their full limit
      const peer2First = await limiter.check(ctx2)
      expect(peer2First.allow).toBe(true)
      const peer2Second = await limiter.check(ctx2)
      expect(peer2Second.allow).toBe(true)
      const peer2Third = await limiter.check(ctx2)
      expect(peer2Third.allow).toBe(false)
    })

    it("should allow burst traffic with burstAllowance", async () => {
      const limiter = createRateLimiter({
        maxRequests: 3,
        windowMs: 1000,
        burstAllowance: 2,
        cleanupIntervalMs: 0,
      })

      const ctx = createMockContext()

      // Should allow 5 requests (3 + 2 burst)
      for (let i = 0; i < 5; i++) {
        const result = await limiter.check(ctx)
        expect(result.allow).toBe(true)
      }

      // 6th request should be rejected
      const result = await limiter.check(ctx)
      expect(result.allow).toBe(false)
    })

    it("should use sliding window (not fixed window)", async () => {
      const limiter = createRateLimiter({
        maxRequests: 2,
        windowMs: 1000,
        cleanupIntervalMs: 0,
      })

      const ctx = createMockContext()

      // Make 2 requests at t=0
      await limiter.check(ctx)
      await limiter.check(ctx)

      // Advance 500ms (half the window)
      vi.advanceTimersByTime(500)

      // Should still be at limit
      const stillLimited = await limiter.check(ctx)
      expect(stillLimited.allow).toBe(false)

      // Advance another 501ms (past the first request's window)
      vi.advanceTimersByTime(501)

      // Now one slot should be free
      const nowAllowed = await limiter.check(ctx)
      expect(nowAllowed.allow).toBe(true)
    })

    it("should call onRateLimited callback when rejecting", async () => {
      const onRateLimited = vi.fn()

      const limiter = createRateLimiter({
        maxRequests: 1,
        windowMs: 1000,
        cleanupIntervalMs: 0,
        onRateLimited,
      })

      const ctx = createMockContext()

      // First request allowed
      await limiter.check(ctx)
      expect(onRateLimited).not.toHaveBeenCalled()

      // Second request rejected
      await limiter.check(ctx)
      expect(onRateLimited).toHaveBeenCalledTimes(1)
      expect(onRateLimited).toHaveBeenCalledWith(
        ctx,
        expect.objectContaining({
          current: 1,
          limit: 1,
          allowed: false,
        }),
      )
    })

    it("should support custom key function", async () => {
      const limiter = createRateLimiter({
        maxRequests: 2,
        windowMs: 1000,
        cleanupIntervalMs: 0,
        // Rate limit by document instead of peer
        keyFn: ctx => ctx.document?.id ?? "unknown",
      })

      const ctx1 = createMockContext({
        document: { id: "doc-1", doc: new LoroDoc() },
      })

      const ctx2 = createMockContext({
        document: { id: "doc-2", doc: new LoroDoc() },
      })

      // Use up doc-1's limit
      await limiter.check(ctx1)
      await limiter.check(ctx1)
      const doc1Rejected = await limiter.check(ctx1)
      expect(doc1Rejected.allow).toBe(false)

      // doc-2 should still have its limit
      const doc2Allowed = await limiter.check(ctx2)
      expect(doc2Allowed.allow).toBe(true)
    })

    it("should allow requests when peer context is missing", async () => {
      const limiter = createRateLimiter({
        maxRequests: 1,
        windowMs: 1000,
        cleanupIntervalMs: 0,
      })

      // Create context without peer
      const ctx: MiddlewareContext = {
        message: createSyncRequest(),
        peer: undefined as never,
      }

      // Should allow when no peer context
      const result = await limiter.check(ctx)
      expect(result.allow).toBe(true)
    })

    it("should clean up stale peer data", async () => {
      vi.useRealTimers() // Need real timers for setInterval

      const limiter = createRateLimiter({
        maxRequests: 2,
        windowMs: 100,
        cleanupIntervalMs: 50, // Fast cleanup for testing
      })

      const ctx = createMockContext()

      // Make a request to create state
      await limiter.check(ctx)
      expect(limiter.getState().size).toBe(1)

      // Wait for cleanup
      await new Promise<void>(resolve => {
        setTimeout(() => {
          // State should be cleaned up after 2 windows of inactivity
          // With windowMs=100 and cleanupIntervalMs=50, after ~250ms it should be gone
          setTimeout(() => {
            expect(limiter.getState().size).toBe(0)
            limiter.cleanup()
            resolve()
          }, 300)
        }, 0)
      })
    }, 1000)
  })

  describe("createMessageTypeRateLimiter", () => {
    it("should only rate limit specified message types", async () => {
      const limiter = createMessageTypeRateLimiter(["channel/sync-request"], {
        maxRequests: 2,
        windowMs: 1000,
        cleanupIntervalMs: 0,
      })

      const syncCtx = createMockContext({
        message: createSyncRequest(),
      })

      const dirCtx = createMockContext({
        message: createDirectoryRequest(),
      })

      // Use up limit on sync-requests
      await limiter.check(syncCtx)
      await limiter.check(syncCtx)
      const syncRejected = await limiter.check(syncCtx)
      expect(syncRejected.allow).toBe(false)

      // directory-request should still be allowed (not rate limited)
      const dir1 = await limiter.check(dirCtx)
      expect(dir1.allow).toBe(true)
      const dir2 = await limiter.check(dirCtx)
      expect(dir2.allow).toBe(true)
      const dir3 = await limiter.check(dirCtx)
      expect(dir3.allow).toBe(true)
    })

    it("should rate limit multiple message types", async () => {
      const limiter = createMessageTypeRateLimiter(
        ["channel/sync-request", "channel/sync-response"],
        {
          maxRequests: 2,
          windowMs: 1000,
          cleanupIntervalMs: 0,
        },
      )

      const reqCtx = createMockContext({
        message: createSyncRequest(),
      })

      const resCtx = createMockContext({
        message: createSyncResponse(),
      })

      // Both types share the same limit
      await limiter.check(reqCtx)
      await limiter.check(resCtx)
      const reqRejected = await limiter.check(reqCtx)
      expect(reqRejected.allow).toBe(false)
      const resRejected = await limiter.check(resCtx)
      expect(resRejected.allow).toBe(false)
    })
  })
})
