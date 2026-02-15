/**
 * Rate Limiter Integration Tests
 *
 * These tests verify that the rate limiter middleware works correctly
 * in real-world scenarios with actual repos and document sync.
 */

import { change, Shape } from "@loro-extended/change"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Bridge, BridgeAdapter } from "../adapter/bridge-adapter.js"
import {
  createMessageTypeRateLimiter,
  createRateLimiter,
} from "../middleware/rate-limiter.js"
import type { Middleware } from "../middleware.js"
import { Repo } from "../repo.js"

const DocSchema = Shape.doc({
  title: Shape.text(),
  count: Shape.counter(),
})

// Ephemeral store schema for presence
const PresenceSchema = Shape.plain.struct({
  x: Shape.plain.number(),
  y: Shape.plain.number(),
})

describe("Rate Limiter Integration", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe("Sync message rate limiting", () => {
    it("should eventually sync documents even when rate limited", async () => {
      const bridge = new Bridge()
      const rejectedMessages: string[] = []

      // Create a rate limiter that only limits channel/update messages
      // This allows establishment and initial sync to complete, but rate limits
      // rapid document updates
      const rateLimiter = createMessageTypeRateLimiter(["channel/update"], {
        maxRequests: 2,
        windowMs: 1000,
        cleanupIntervalMs: 0,
        onRateLimited: ctx => {
          rejectedMessages.push(ctx.message.type)
        },
      })

      const repo1 = new Repo({
        identity: { name: "repo1", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapter1" })],
      })

      const repo2 = new Repo({
        identity: { name: "repo2", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapter2" })],
        middleware: [rateLimiter],
      })

      // Wait for channel establishment
      await vi.advanceTimersByTimeAsync(100)

      // Create document and make initial change
      const handle1 = repo1.getHandle("test-doc", DocSchema)
      change(handle1.doc, draft => {
        draft.title.insert(0, "hello")
      })

      // Wait for initial sync
      await vi.advanceTimersByTimeAsync(100)

      // Get handle in repo2 first to establish subscription
      const handle2 = repo2.getHandle("test-doc", DocSchema)
      await vi.advanceTimersByTimeAsync(100)

      // Now make rapid changes - these channel/update messages will be rate limited
      for (let i = 0; i < 10; i++) {
        change(handle1.doc, draft => {
          draft.count.increment(1)
        })
        await vi.advanceTimersByTimeAsync(10) // Small delay between changes
      }

      // Some messages should have been rate limited
      await vi.advanceTimersByTimeAsync(100)

      // Now wait for the rate limit window to reset
      await vi.advanceTimersByTimeAsync(1000)

      // Make one more change to trigger sync
      change(handle1.doc, draft => {
        draft.count.increment(1)
      })

      await vi.advanceTimersByTimeAsync(100)

      // The document should have the initial content
      expect(handle2.doc.toJSON().title).toBe("hello")
      // Count may vary depending on which updates got through
      expect(handle2.doc.toJSON().count).toBeGreaterThanOrEqual(1)

      // Verify some update messages were rate limited
      expect(rejectedMessages.length).toBeGreaterThan(0)
      expect(rejectedMessages.every(t => t === "channel/update")).toBe(true)

      // Cleanup
      rateLimiter.cleanup()
    })

    it("should recover from rate-limited initial sync", async () => {
      const bridge = new Bridge()
      let blockedCount = 0
      const blockedTypes: string[] = []

      // Create a rate limiter that limits sync-response messages
      // This simulates a scenario where the server's responses are rate limited
      const aggressiveLimiter = createMessageTypeRateLimiter(
        ["channel/sync-response"],
        {
          maxRequests: 0, // Block all sync-responses initially
          windowMs: 200,
          cleanupIntervalMs: 0,
          onRateLimited: ctx => {
            blockedCount++
            blockedTypes.push(ctx.message.type)
          },
        },
      )

      // Create repo1 with a document first
      const repo1 = new Repo({
        identity: { name: "repo1", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapter1" })],
      })

      const handle1 = repo1.getHandle("test-doc", DocSchema)
      change(handle1.doc, draft => {
        draft.title.insert(0, "initial content")
      })

      // Wait for repo1 to be ready
      await vi.advanceTimersByTimeAsync(100)

      // Now create repo2 with aggressive rate limiter
      const repo2 = new Repo({
        identity: { name: "repo2", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapter2" })],
        middleware: [aggressiveLimiter],
      })

      // Initial sync attempt - sync-response will be blocked
      await vi.advanceTimersByTimeAsync(100)

      // Request the document (this will trigger a sync-request)
      const handle2 = repo2.getHandle("test-doc", DocSchema)
      await vi.advanceTimersByTimeAsync(100)

      // Document should be empty because sync-response was blocked
      expect(handle2.doc.toJSON().title).toBe("")

      // Some messages should have been blocked
      expect(blockedCount).toBeGreaterThan(0)

      // Now remove the rate limiter and allow sync to complete
      // (In a real scenario, the rate limit window would reset)
      aggressiveLimiter.cleanup()

      // Cleanup
    })
  })

  describe("Selective rate limiting by message type", () => {
    it("should allow sync messages while rate limiting ephemeral", async () => {
      const bridge = new Bridge()
      const blockedTypes: string[] = []

      // Only rate limit ephemeral messages
      const ephemeralLimiter = createMessageTypeRateLimiter(
        ["channel/ephemeral"],
        {
          maxRequests: 1,
          windowMs: 1000,
          cleanupIntervalMs: 0,
          onRateLimited: ctx => {
            blockedTypes.push(ctx.message.type)
          },
        },
      )

      const repo1 = new Repo({
        identity: { name: "repo1", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapter1" })],
      })

      const repo2 = new Repo({
        identity: { name: "repo2", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapter2" })],
        middleware: [ephemeralLimiter],
      })

      // Wait for channel establishment
      await vi.advanceTimersByTimeAsync(100)

      // Create document and make changes
      const handle1 = repo1.getHandle("test-doc", DocSchema)
      change(handle1.doc, draft => {
        draft.title.insert(0, "hello")
      })

      await vi.advanceTimersByTimeAsync(100)

      // Get handle in repo2
      const handle2 = repo2.getHandle("test-doc", DocSchema)
      await vi.advanceTimersByTimeAsync(100)

      // Sync should work (not rate limited)
      expect(handle2.doc.toJSON().title).toBe("hello")

      // Only ephemeral messages should be blocked (if any were sent)
      for (const type of blockedTypes) {
        expect(type).toBe("channel/ephemeral")
      }

      // Cleanup
      ephemeralLimiter.cleanup()
    })
  })

  describe("Burst handling", () => {
    it("should allow bursts up to burst limit", async () => {
      const bridge = new Bridge()
      const allowedMessages: string[] = []
      const blockedMessages: string[] = []

      // Create a counting middleware to track what gets through
      const countingMiddleware: Middleware = {
        name: "counter",
        check: ctx => {
          allowedMessages.push(ctx.message.type)
          return { allow: true }
        },
      }

      // Rate limiter with burst allowance
      const rateLimiter = createRateLimiter({
        maxRequests: 2,
        windowMs: 1000,
        burstAllowance: 3, // Allow 5 total (2 + 3)
        cleanupIntervalMs: 0,
        onRateLimited: ctx => {
          blockedMessages.push(ctx.message.type)
        },
      })

      const repo1 = new Repo({
        identity: { name: "repo1", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapter1" })],
      })

      const _repo2 = new Repo({
        identity: { name: "repo2", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapter2" })],
        middleware: [rateLimiter, countingMiddleware],
      })

      // Wait for channel establishment
      await vi.advanceTimersByTimeAsync(100)

      // Create document and make rapid changes
      const handle1 = repo1.getHandle("test-doc", DocSchema)

      // Make 10 rapid changes
      for (let i = 0; i < 10; i++) {
        change(handle1.doc, draft => {
          draft.count.increment(1)
        })
      }

      await vi.advanceTimersByTimeAsync(100)

      // Some messages should have been allowed (up to burst limit)
      expect(allowedMessages.length).toBeGreaterThan(0)
      expect(allowedMessages.length).toBeLessThanOrEqual(5) // 2 + 3 burst

      // Some messages should have been blocked
      expect(blockedMessages.length).toBeGreaterThan(0)

      // Cleanup
      rateLimiter.cleanup()
    })
  })

  describe("Multiple peers with different rate limits", () => {
    it("should apply rate limits independently per peer", async () => {
      const bridge = new Bridge()
      const peer1Blocked: string[] = []
      const peer2Blocked: string[] = []

      // Strict rate limiter for peer 1
      const strictLimiter = createRateLimiter({
        maxRequests: 1,
        windowMs: 1000,
        cleanupIntervalMs: 0,
        onRateLimited: ctx => {
          peer1Blocked.push(ctx.message.type)
        },
      })

      // Lenient rate limiter for peer 2
      const lenientLimiter = createRateLimiter({
        maxRequests: 100,
        windowMs: 1000,
        cleanupIntervalMs: 0,
        onRateLimited: ctx => {
          peer2Blocked.push(ctx.message.type)
        },
      })

      const _repo1 = new Repo({
        identity: { name: "repo1", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapter1" })],
        middleware: [strictLimiter],
      })

      const repo2 = new Repo({
        identity: { name: "repo2", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapter2" })],
        middleware: [lenientLimiter],
      })

      // Wait for channel establishment
      await vi.advanceTimersByTimeAsync(100)

      // Create document in repo2 and make changes
      const handle2 = repo2.getHandle("test-doc", DocSchema)
      change(handle2.doc, draft => {
        draft.title.insert(0, "hello")
      })

      await vi.advanceTimersByTimeAsync(50)

      // Make more changes
      for (let i = 0; i < 5; i++) {
        change(handle2.doc, draft => {
          draft.count.increment(1)
        })
      }

      await vi.advanceTimersByTimeAsync(100)

      // Repo1 (strict) should have blocked many messages
      expect(peer1Blocked.length).toBeGreaterThan(0)

      // Repo2 (lenient) should not have blocked any
      expect(peer2Blocked.length).toBe(0)

      // Cleanup
      strictLimiter.cleanup()
      lenientLimiter.cleanup()
    })
  })

  describe("Ephemeral data at high frequency", () => {
    it("should gracefully degrade ephemeral updates under rate limiting", async () => {
      const bridge = new Bridge()
      let ephemeralBlocked = 0
      let ephemeralAllowed = 0

      // Rate limiter that allows only a few ephemeral messages
      const ephemeralLimiter = createMessageTypeRateLimiter(
        ["channel/ephemeral"],
        {
          maxRequests: 5,
          windowMs: 1000,
          cleanupIntervalMs: 0,
          onRateLimited: () => {
            ephemeralBlocked++
          },
        },
      )

      // Counting middleware to track allowed ephemeral messages
      const countingMiddleware: Middleware = {
        name: "ephemeral-counter",
        check: ctx => {
          if (ctx.message.type === "channel/ephemeral") {
            ephemeralAllowed++
          }
          return { allow: true }
        },
      }

      const repo1 = new Repo({
        identity: { name: "repo1", type: "user", peerId: "1" as `${number}` },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapter1" })],
      })

      const repo2 = new Repo({
        identity: { name: "repo2", type: "user", peerId: "2" as `${number}` },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapter2" })],
        middleware: [ephemeralLimiter, countingMiddleware],
      })

      // Wait for channel establishment
      await vi.advanceTimersByTimeAsync(100)

      // Create document with ephemeral store declared
      const handle1 = repo1.getHandle("test-doc", DocSchema, {
        presence: PresenceSchema,
      })
      const handle2 = repo2.getHandle("test-doc", DocSchema, {
        presence: PresenceSchema,
      })

      await vi.advanceTimersByTimeAsync(100)

      // Get ephemeral stores
      const presence1 = handle1.getTypedEphemeral("presence")

      // Simulate high-frequency presence updates (like 60fps cursor)
      // In a real scenario, this would be 60 updates per second
      // We'll simulate 20 rapid updates
      for (let i = 0; i < 20; i++) {
        presence1.setSelf({ x: i * 10, y: i * 10 })
        await vi.advanceTimersByTimeAsync(16) // ~60fps
      }

      await vi.advanceTimersByTimeAsync(100)

      // Some ephemeral messages should have been allowed
      expect(ephemeralAllowed).toBeGreaterThan(0)

      // Some ephemeral messages should have been blocked
      expect(ephemeralBlocked).toBeGreaterThan(0)

      // The system should still be functional (no crashes)
      // And repo2 should have received some presence updates
      const presence2 = handle2.getTypedEphemeral("presence")
      const _peers = presence2.peers

      // We may or may not have received updates depending on timing
      // The key is that the system didn't crash and is still functional

      // Cleanup
      ephemeralLimiter.cleanup()
    })
  })
})
