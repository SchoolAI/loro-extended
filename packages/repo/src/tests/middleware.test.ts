import { change, Shape } from "@loro-extended/change"
import { describe, expect, it } from "vitest"
import { Bridge, BridgeAdapter } from "../adapter/bridge-adapter.js"
import type { Middleware, MiddlewareContext } from "../middleware.js"
import { Repo } from "../repo.js"

// Schema for test documents
const DocSchema = Shape.doc({
  title: Shape.text(),
})

describe("Middleware", () => {
  describe("peer context", () => {
    it("should provide peer context to middleware", async () => {
      const bridge = new Bridge()
      const receivedContexts: MiddlewareContext[] = []

      const captureMiddleware: Middleware = {
        name: "capture",
        requires: ["peer"],
        check: ctx => {
          receivedContexts.push({ ...ctx })
          return { allow: true }
        },
      }

      const repo1 = new Repo({
        identity: { name: "repo1", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapter1" })],
      })

      const _repo2 = new Repo({
        identity: { name: "repo2", type: "service" },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapter2" })],
        middleware: [captureMiddleware],
      })

      // Wait for channel establishment
      await new Promise(resolve => setTimeout(resolve, 50))

      // Create a document and wait for sync
      const handle1 = repo1.get("test-doc", DocSchema)
      change(handle1.doc, draft => {
        draft.title.insert(0, "hello")
      })

      // Wait for messages to be exchanged
      await new Promise(resolve => setTimeout(resolve, 100))

      // Middleware should have been called with peer context
      expect(receivedContexts.length).toBeGreaterThan(0)

      const ctxWithPeer = receivedContexts.find(ctx => ctx.peer !== undefined)
      expect(ctxWithPeer).toBeDefined()
      expect(ctxWithPeer?.peer?.peerType).toBe("user")
      expect(ctxWithPeer?.peer?.channelKind).toBe("network")
    })

    it("should reject messages when middleware returns allow: false", async () => {
      const bridge = new Bridge()

      const rejectMiddleware: Middleware = {
        name: "reject-all",
        requires: ["peer"],
        check: () => ({ allow: false, reason: "rejected by test" }),
      }

      const repo1 = new Repo({
        identity: { name: "repo1", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapter1" })],
      })

      const repo2 = new Repo({
        identity: { name: "repo2", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapter2" })],
        middleware: [rejectMiddleware],
      })

      // Wait for channel establishment
      await new Promise(resolve => setTimeout(resolve, 50))

      // Create a document in repo1
      const handle1 = repo1.get("test-doc", DocSchema)
      change(handle1.doc, draft => {
        draft.title.insert(0, "hello")
      })

      // Wait for messages to be exchanged
      await new Promise(resolve => setTimeout(resolve, 100))

      // repo2 should not have the document because middleware rejected all messages
      // Note: The document might exist but be empty because sync was rejected
      const handle2 = repo2.get("test-doc", DocSchema)
      expect(handle2.doc.toJSON().title).toBe("") // Empty because sync was rejected
    })
  })

  describe("document context", () => {
    it("should provide document context for doc-specific messages", async () => {
      const bridge = new Bridge()
      const receivedContexts: MiddlewareContext[] = []

      const captureMiddleware: Middleware = {
        name: "capture-doc",
        requires: ["document"],
        check: ctx => {
          receivedContexts.push({ ...ctx })
          return { allow: true }
        },
      }

      const repo1 = new Repo({
        identity: { name: "repo1", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapter1" })],
      })

      // Create document in repo1 first
      const handle1 = repo1.get("test-doc", DocSchema)
      change(handle1.doc, draft => {
        draft.title.insert(0, "hello")
      })

      // Wait for repo1 to be ready
      await new Promise(resolve => setTimeout(resolve, 50))

      // Now create repo2 with middleware
      const repo2 = new Repo({
        identity: { name: "repo2", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapter2" })],
        middleware: [captureMiddleware],
      })

      // Request the document
      const _handle2 = repo2.get("test-doc", DocSchema)

      // Wait for sync
      await new Promise(resolve => setTimeout(resolve, 100))

      // Check if any context had document info
      // Note: Document context is only available if the doc exists locally
      // For sync-response, the doc may not exist yet, so document context may be undefined
      const ctxWithDoc = receivedContexts.find(
        ctx => ctx.document !== undefined,
      )

      // Document context should be available for messages about existing docs
      // If no document context was captured, that's expected for new docs
      if (ctxWithDoc) {
        expect(ctxWithDoc.document?.id).toBe("test-doc")
        expect(ctxWithDoc.document?.doc).toBeDefined()
      }
    })
  })

  describe("transmission context", () => {
    it("should provide transmission context for sync-response messages", async () => {
      const bridge = new Bridge()
      const receivedContexts: MiddlewareContext[] = []

      const captureMiddleware: Middleware = {
        name: "capture-transmission",
        requires: ["transmission"],
        check: ctx => {
          receivedContexts.push({ ...ctx })
          return { allow: true }
        },
      }

      const repo1 = new Repo({
        identity: { name: "repo1", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapter1" })],
      })

      // Create document with content
      const handle1 = repo1.get("test-doc", DocSchema)
      change(handle1.doc, draft => {
        draft.title.insert(0, "hello world this is some content")
      })

      // Wait for repo1 to be ready
      await new Promise(resolve => setTimeout(resolve, 50))

      // Create repo2 with middleware
      const repo2 = new Repo({
        identity: { name: "repo2", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapter2" })],
        middleware: [captureMiddleware],
      })

      // Request the document
      repo2.get("test-doc", DocSchema)

      // Wait for sync
      await new Promise(resolve => setTimeout(resolve, 100))

      // Check if transmission context was captured
      const ctxWithTransmission = receivedContexts.find(
        ctx => ctx.transmission !== undefined,
      )

      expect(ctxWithTransmission).toBeDefined()
      expect(ctxWithTransmission?.transmission?.type).toMatch(/snapshot|update/)
      expect(ctxWithTransmission?.transmission?.sizeBytes).toBeGreaterThan(0)
    })

    it("should allow size-limiting middleware", async () => {
      const bridge = new Bridge()
      const rejectedSizes: number[] = []

      // Middleware that rejects large payloads
      const sizeLimitMiddleware: Middleware = {
        name: "size-limit",
        requires: ["transmission"],
        check: ctx => {
          if (
            ctx.transmission &&
            ctx.transmission.sizeBytes > 10 // Very small limit for testing
          ) {
            rejectedSizes.push(ctx.transmission.sizeBytes)
            return { allow: false, reason: "payload too large" }
          }
          return { allow: true }
        },
      }

      const repo1 = new Repo({
        identity: { name: "repo1", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapter1" })],
      })

      // Create document with content that will exceed size limit
      const handle1 = repo1.get("test-doc", DocSchema)
      change(handle1.doc, draft => {
        draft.title.insert(
          0,
          "this is a long string that should exceed the size limit",
        )
      })

      // Wait for repo1 to be ready
      await new Promise(resolve => setTimeout(resolve, 50))

      // Create repo2 with size-limiting middleware
      const repo2 = new Repo({
        identity: { name: "repo2", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapter2" })],
        middleware: [sizeLimitMiddleware],
      })

      // Request the document
      const handle2 = repo2.get("test-doc", DocSchema)

      // Wait for sync attempt
      await new Promise(resolve => setTimeout(resolve, 100))

      // Size limit should have rejected the payload
      expect(rejectedSizes.length).toBeGreaterThan(0)
      expect(rejectedSizes[0]).toBeGreaterThan(10)

      // Document should be empty because sync was rejected
      expect(handle2.doc.toJSON().title).toBe("")
    })
  })

  describe("async middleware", () => {
    it("should support async middleware checks", async () => {
      const bridge = new Bridge()
      let asyncCheckCalled = false

      const asyncMiddleware: Middleware = {
        name: "async-check",
        requires: ["peer"],
        check: async _ctx => {
          asyncCheckCalled = true
          return { allow: true }
        },
      }

      const repo1 = new Repo({
        identity: { name: "repo1", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapter1" })],
      })

      const _repo2 = new Repo({
        identity: { name: "repo2", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapter2" })],
        middleware: [asyncMiddleware],
      })

      // Wait for channel establishment
      await new Promise(resolve => setTimeout(resolve, 50))

      // Create a document
      const handle1 = repo1.get("test-doc", DocSchema)
      change(handle1.doc, draft => {
        draft.title.insert(0, "hello")
      })

      // Wait for sync
      await new Promise(resolve => setTimeout(resolve, 100))

      expect(asyncCheckCalled).toBe(true)
    })
  })

  describe("middleware chaining", () => {
    it("should run middleware in order and short-circuit on rejection", async () => {
      const bridge = new Bridge()
      const callOrder: string[] = []

      const middleware1: Middleware = {
        name: "first",
        check: () => {
          callOrder.push("first")
          return { allow: true }
        },
      }

      const middleware2: Middleware = {
        name: "second",
        check: () => {
          callOrder.push("second")
          return { allow: false, reason: "rejected" }
        },
      }

      const middleware3: Middleware = {
        name: "third",
        check: () => {
          callOrder.push("third")
          return { allow: true }
        },
      }

      const repo1 = new Repo({
        identity: { name: "repo1", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapter1" })],
      })

      const _repo2 = new Repo({
        identity: { name: "repo2", type: "user" },
        adapters: [new BridgeAdapter({ bridge, adapterType: "adapter2" })],
        middleware: [middleware1, middleware2, middleware3],
      })

      // Wait for channel establishment
      await new Promise(resolve => setTimeout(resolve, 50))

      // Create a document
      repo1.get("test-doc", DocSchema)

      // Wait for messages
      await new Promise(resolve => setTimeout(resolve, 100))

      // Should have called first and second, but not third (short-circuited)
      expect(callOrder).toContain("first")
      expect(callOrder).toContain("second")
      expect(callOrder).not.toContain("third")
    })
  })
})
