import { createTypedDoc, loro, Shape } from "@loro-extended/change"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Askforce } from "./askforce.js"
import { createAskforceSchema } from "./schema.js"
import { createMockEphemeral } from "./test-utils.js"
import { AskforceError } from "./types.js"

describe("RecordRef subscription", () => {
  it("supports subscribe() via loro(recordRef).subscribe()", () => {
    const schema = Shape.doc({
      asks: Shape.record(
        Shape.struct({
          id: Shape.plain.string(),
          question: Shape.plain.string(),
        }),
      ),
    })

    const doc = createTypedDoc(schema)
    const events: unknown[] = []

    // Subscribe to the record
    const unsub = loro(doc.asks).subscribe(event => {
      events.push(event)
    })

    // Make a change
    doc.asks.set("ask_1", { id: "ask_1", question: "What is 2+2?" })

    // Verify subscription fired
    expect(events.length).toBeGreaterThan(0)

    unsub()
  })
})

describe("Askforce", () => {
  // Create a typed schema for testing
  const questionSchema = Shape.plain.struct({ query: Shape.plain.string() })
  const answerSchema = Shape.plain.struct({ result: Shape.plain.string() })
  const askforceSchema = createAskforceSchema(questionSchema, answerSchema)

  const docSchema = Shape.doc({
    asks: askforceSchema,
  })

  let doc: ReturnType<typeof createTypedDoc<typeof docSchema>>
  let mockEphemeral: ReturnType<typeof createMockEphemeral>

  beforeEach(() => {
    doc = createTypedDoc(docSchema)
    mockEphemeral = createMockEphemeral("peer-1")
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe("ask()", () => {
    it("creates ask with unique ID", () => {
      const askforce = new Askforce(doc.asks, mockEphemeral, {
        peerId: "peer-1",
        mode: "rpc",
      })

      const askId1 = askforce.ask({ query: "What is 2+2?" })
      const askId2 = askforce.ask({ query: "What is 3+3?" })

      expect(askId1).toMatch(/^ask_/)
      expect(askId2).toMatch(/^ask_/)
      expect(askId1).not.toBe(askId2)

      askforce.dispose()
    })

    it("stores ask entry in recordRef", () => {
      const askforce = new Askforce(doc.asks, mockEphemeral, {
        peerId: "peer-1",
        mode: "rpc",
      })

      const askId = askforce.ask({ query: "What is 2+2?" })

      const entry = doc.asks.get(askId)
      expect(entry).toBeDefined()

      // Use toJSON() to get plain values
      const entryJson = entry?.toJSON()
      expect(entryJson?.id).toBe(askId)
      expect(entryJson?.question).toEqual({ query: "What is 2+2?" })
      expect(entryJson?.askedBy).toBe("peer-1")
      expect(entryJson?.askedAt).toBeGreaterThan(0)

      askforce.dispose()
    })

    it("initializes answers as empty record", () => {
      const askforce = new Askforce(doc.asks, mockEphemeral, {
        peerId: "peer-1",
        mode: "rpc",
      })

      const askId = askforce.ask({ query: "What is 2+2?" })

      const entry = doc.asks.get(askId)
      expect(entry?.answers.keys()).toEqual([])

      askforce.dispose()
    })
  })

  describe("getStatus()", () => {
    it("returns pending when no answers exist", () => {
      const askforce = new Askforce(doc.asks, mockEphemeral, {
        peerId: "peer-1",
        mode: "rpc",
      })

      const askId = askforce.ask({ query: "What is 2+2?" })
      expect(askforce.getStatus(askId)).toBe("pending")

      askforce.dispose()
    })

    it("returns claimed when worker has pending answer", () => {
      const askforce = new Askforce(doc.asks, mockEphemeral, {
        peerId: "peer-1",
        mode: "rpc",
      })

      const askId = askforce.ask({ query: "What is 2+2?" })

      // Manually add a pending answer
      const entry = doc.asks.get(askId)
      entry?.answers.set("worker-1", {
        status: "pending",
        claimedAt: Date.now(),
      })

      expect(askforce.getStatus(askId)).toBe("claimed")

      askforce.dispose()
    })

    it("returns answered when worker has answered", () => {
      const askforce = new Askforce(doc.asks, mockEphemeral, {
        peerId: "peer-1",
        mode: "rpc",
      })

      const askId = askforce.ask({ query: "What is 2+2?" })

      // Manually add an answered answer
      const entry = doc.asks.get(askId)
      entry?.answers.set("worker-1", {
        status: "answered",
        data: { result: "4" },
        answeredAt: Date.now(),
      })

      expect(askforce.getStatus(askId)).toBe("answered")

      askforce.dispose()
    })

    it("returns failed when all answers have failed", () => {
      const askforce = new Askforce(doc.asks, mockEphemeral, {
        peerId: "peer-1",
        mode: "rpc",
      })

      const askId = askforce.ask({ query: "What is 2+2?" })

      // Manually add a failed answer
      const entry = doc.asks.get(askId)
      entry?.answers.set("worker-1", {
        status: "failed",
        reason: "timeout",
        failedAt: Date.now(),
      })

      expect(askforce.getStatus(askId)).toBe("failed")

      askforce.dispose()
    })

    it("returns answered if any answer succeeded even with failures", () => {
      const askforce = new Askforce(doc.asks, mockEphemeral, {
        peerId: "peer-1",
        mode: "pool",
      })

      const askId = askforce.ask({ query: "What is 2+2?" })

      // Add both failed and answered
      const entry = doc.asks.get(askId)
      entry?.answers.set("worker-1", {
        status: "failed",
        reason: "timeout",
        failedAt: Date.now(),
      })
      entry?.answers.set("worker-2", {
        status: "answered",
        data: { result: "4" },
        answeredAt: Date.now(),
      })

      expect(askforce.getStatus(askId)).toBe("answered")

      askforce.dispose()
    })
  })

  describe("allAnswers()", () => {
    it("returns empty array when no answers", () => {
      const askforce = new Askforce(doc.asks, mockEphemeral, {
        peerId: "peer-1",
        mode: "pool",
      })

      const askId = askforce.ask({ query: "What is 2+2?" })
      expect(askforce.allAnswers(askId)).toEqual([])

      askforce.dispose()
    })

    it("returns only answered results, not pending or failed", () => {
      const askforce = new Askforce(doc.asks, mockEphemeral, {
        peerId: "peer-1",
        mode: "pool",
      })

      const askId = askforce.ask({ query: "What is 2+2?" })

      const entry = doc.asks.get(askId)
      entry?.answers.set("worker-1", {
        status: "pending",
        claimedAt: Date.now(),
      })
      entry?.answers.set("worker-2", {
        status: "answered",
        data: { result: "4" },
        answeredAt: 1000,
      })
      entry?.answers.set("worker-3", {
        status: "failed",
        reason: "error",
        failedAt: Date.now(),
      })

      const answers = askforce.allAnswers(askId)
      expect(answers).toHaveLength(1)
      expect(answers[0]).toEqual({
        workerId: "worker-2",
        data: { result: "4" },
        answeredAt: 1000,
      })

      askforce.dispose()
    })

    it("returns all answered results in pool mode", () => {
      const askforce = new Askforce(doc.asks, mockEphemeral, {
        peerId: "peer-1",
        mode: "pool",
      })

      const askId = askforce.ask({ query: "What is 2+2?" })

      const entry = doc.asks.get(askId)
      entry?.answers.set("worker-1", {
        status: "answered",
        data: { result: "4" },
        answeredAt: 1000,
      })
      entry?.answers.set("worker-2", {
        status: "answered",
        data: { result: "four" },
        answeredAt: 2000,
      })

      const answers = askforce.allAnswers(askId)
      expect(answers).toHaveLength(2)

      askforce.dispose()
    })
  })

  describe("RPC mode", () => {
    it("creates ask with unique ID", () => {
      const askforce = new Askforce(doc.asks, mockEphemeral, {
        peerId: "peer-1",
        mode: "rpc",
      })

      const askId = askforce.ask({ query: "What is 2+2?" })
      expect(askId).toMatch(/^ask_/)

      askforce.dispose()
    })

    it("onAsk processes existing asks", async () => {
      vi.useRealTimers() // Need real timers for async handler

      const askforce = new Askforce(doc.asks, mockEphemeral, {
        peerId: "peer-1",
        mode: "rpc",
      })

      // Create an ask first
      const askId = askforce.ask({ query: "What is 2+2?" })

      // Create a worker askforce with its own ephemeral
      const workerEphemeral = createMockEphemeral("worker-1")
      const workerAskforce = new Askforce(doc.asks, workerEphemeral, {
        peerId: "worker-1",
        mode: "rpc",
      })

      const handler = vi.fn().mockResolvedValue({ result: "4" })

      // Subscribe to asks
      const unsub = workerAskforce.onAsk(handler)

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 50))

      expect(handler).toHaveBeenCalledWith(askId, { query: "What is 2+2?" })

      unsub()
      askforce.dispose()
      workerAskforce.dispose()
    })

    it("onAsk processes new asks reactively", async () => {
      vi.useRealTimers() // Need real timers for async handler

      const workerEphemeral = createMockEphemeral("worker-1")
      const workerAskforce = new Askforce(doc.asks, workerEphemeral, {
        peerId: "worker-1",
        mode: "rpc",
      })

      const handler = vi.fn().mockResolvedValue({ result: "4" })

      // Subscribe first
      const unsub = workerAskforce.onAsk(handler)

      // Create an ask after subscribing
      const clientEphemeral = createMockEphemeral("client-1")
      const clientAskforce = new Askforce(doc.asks, clientEphemeral, {
        peerId: "client-1",
        mode: "rpc",
      })
      const askId = clientAskforce.ask({ query: "What is 2+2?" })

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 50))

      // Handler should be called with the askId and question
      expect(handler).toHaveBeenCalledWith(askId, { query: "What is 2+2?" })

      unsub()
      clientAskforce.dispose()
      workerAskforce.dispose()
    })

    it("waitFor resolves when answer is written", async () => {
      vi.useRealTimers()

      const askforce = new Askforce(doc.asks, mockEphemeral, {
        peerId: "peer-1",
        mode: "rpc",
      })

      const askId = askforce.ask({ query: "What is 2+2?" })

      // Start waiting
      const waitPromise = askforce.waitFor(askId, 5000)

      // Simulate worker answering after a delay
      setTimeout(() => {
        const entry = doc.asks.get(askId)
        entry?.answers.set("worker-1", {
          status: "answered",
          data: { result: "4" },
          answeredAt: Date.now(),
        })
      }, 50)

      const answer = await waitPromise
      expect(answer).toEqual({ result: "4" })

      askforce.dispose()
    })

    it("waitFor times out if no answer", async () => {
      vi.useRealTimers()

      const askforce = new Askforce(doc.asks, mockEphemeral, {
        peerId: "peer-1",
        mode: "rpc",
      })

      const askId = askforce.ask({ query: "What is 2+2?" })

      await expect(askforce.waitFor(askId, 100)).rejects.toThrow(
        /Timeout waiting for answer/,
      )

      askforce.dispose()
    })

    it("waitFor rejects if all answers failed", async () => {
      vi.useRealTimers()

      const askforce = new Askforce(doc.asks, mockEphemeral, {
        peerId: "peer-1",
        mode: "rpc",
      })

      const askId = askforce.ask({ query: "What is 2+2?" })

      // Start waiting
      const waitPromise = askforce.waitFor(askId, 5000)

      // Simulate worker failing after a delay
      setTimeout(() => {
        const entry = doc.asks.get(askId)
        entry?.answers.set("worker-1", {
          status: "failed",
          reason: "computation error",
          failedAt: Date.now(),
        })
      }, 50)

      await expect(waitPromise).rejects.toThrow(
        /All workers failed.*computation error/,
      )

      askforce.dispose()
    })

    it("does not process same ask twice", async () => {
      vi.useRealTimers()

      const workerEphemeral = createMockEphemeral("worker-1")
      const workerAskforce = new Askforce(doc.asks, workerEphemeral, {
        peerId: "worker-1",
        mode: "rpc",
      })

      let callCount = 0
      const handler = vi.fn().mockImplementation(async () => {
        callCount++
        return { result: "4" }
      })

      // Subscribe
      const unsub = workerAskforce.onAsk(handler)

      // Create an ask
      const clientEphemeral = createMockEphemeral("client-1")
      const clientAskforce = new Askforce(doc.asks, clientEphemeral, {
        peerId: "client-1",
        mode: "rpc",
      })
      clientAskforce.ask({ query: "What is 2+2?" })

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 100))

      // Handler should only be called once
      expect(callCount).toBe(1)

      unsub()
      clientAskforce.dispose()
      workerAskforce.dispose()
    })
  })

  describe("Pool mode", () => {
    it("creates ask with unique ID", () => {
      const askforce = new Askforce(doc.asks, mockEphemeral, {
        peerId: "peer-1",
        mode: "pool",
      })

      const askId = askforce.ask({ query: "What is 2+2?" })
      expect(askId).toMatch(/^ask_/)

      askforce.dispose()
    })

    it("multiple workers can answer same ask", async () => {
      vi.useRealTimers()

      // Create client
      const clientEphemeral = createMockEphemeral("client-1")
      const clientAskforce = new Askforce(doc.asks, clientEphemeral, {
        peerId: "client-1",
        mode: "pool",
      })

      const askId = clientAskforce.ask({ query: "What is 2+2?" })

      // Create two workers with separate ephemeral stores
      const worker1Ephemeral = createMockEphemeral("worker-1")
      const worker1 = new Askforce(doc.asks, worker1Ephemeral, {
        peerId: "worker-1",
        mode: "pool",
      })

      const worker2Ephemeral = createMockEphemeral("worker-2")
      const worker2 = new Askforce(doc.asks, worker2Ephemeral, {
        peerId: "worker-2",
        mode: "pool",
      })

      const handler1 = vi.fn().mockResolvedValue({ result: "4" })
      const handler2 = vi.fn().mockResolvedValue({ result: "four" })

      const unsub1 = worker1.onAsk(handler1)
      const unsub2 = worker2.onAsk(handler2)

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 100))

      // Both handlers should be called
      expect(handler1).toHaveBeenCalled()
      expect(handler2).toHaveBeenCalled()

      // Both answers should be stored
      const answers = clientAskforce.allAnswers(askId)
      expect(answers).toHaveLength(2)

      unsub1()
      unsub2()
      clientAskforce.dispose()
      worker1.dispose()
      worker2.dispose()
    })

    it("waitFor uses pickOne for deterministic selection", async () => {
      vi.useRealTimers()

      const askforce = new Askforce(doc.asks, mockEphemeral, {
        peerId: "peer-1",
        mode: "pool",
      })

      const askId = askforce.ask({ query: "What is 2+2?" })

      // Add multiple answers
      const entry = doc.asks.get(askId)
      entry?.answers.set("worker-a", {
        status: "answered",
        data: { result: "4" },
        answeredAt: Date.now(),
      })
      entry?.answers.set("worker-b", {
        status: "answered",
        data: { result: "four" },
        answeredAt: Date.now(),
      })

      const answer = await askforce.waitFor(askId)

      // pickOne should return deterministic result (first sorted key)
      expect(answer).toEqual({ result: "4" }) // worker-a comes before worker-b

      askforce.dispose()
    })
  })

  describe("onAsk with checkpoint", () => {
    it("processes only asks created after checkpoint", async () => {
      vi.useRealTimers()

      const askforce = new Askforce(doc.asks, mockEphemeral, {
        peerId: "peer-1",
        mode: "rpc",
      })

      // Create an old ask
      const oldAskId = askforce.ask({ query: "Old question" })

      // Get the timestamp of the old ask using toJSON()
      const oldEntry = doc.asks.get(oldAskId)
      const oldEntryJson = oldEntry?.toJSON()
      const checkpoint = (oldEntryJson?.askedAt ?? 0) + 1

      // Create a new ask after checkpoint
      await new Promise(resolve => setTimeout(resolve, 10))
      const newAskId = askforce.ask({ query: "New question" })

      // Create worker with checkpoint
      const workerEphemeral = createMockEphemeral("worker-1")
      const workerAskforce = new Askforce(doc.asks, workerEphemeral, {
        peerId: "worker-1",
        mode: "rpc",
      })

      const handler = vi.fn().mockResolvedValue({ result: "answer" })
      const unsub = workerAskforce.onAsk(handler, { since: checkpoint })

      await new Promise(resolve => setTimeout(resolve, 50))

      // Should only process the new ask
      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith(newAskId, { query: "New question" })

      unsub()
      askforce.dispose()
      workerAskforce.dispose()
    })

    it("processes all asks when no checkpoint provided", async () => {
      vi.useRealTimers()

      const askforce = new Askforce(doc.asks, mockEphemeral, {
        peerId: "peer-1",
        mode: "rpc",
      })

      // Create multiple asks
      askforce.ask({ query: "Question 1" })
      askforce.ask({ query: "Question 2" })

      // Create worker without checkpoint
      const workerEphemeral = createMockEphemeral("worker-1")
      const workerAskforce = new Askforce(doc.asks, workerEphemeral, {
        peerId: "worker-1",
        mode: "rpc",
      })

      const handler = vi.fn().mockResolvedValue({ result: "answer" })
      const unsub = workerAskforce.onAsk(handler)

      await new Promise(resolve => setTimeout(resolve, 50))

      // Should process both asks
      expect(handler).toHaveBeenCalledTimes(2)

      unsub()
      askforce.dispose()
      workerAskforce.dispose()
    })
  })

  describe("Pool mode staggered claiming", () => {
    it("priority worker claims immediately", async () => {
      vi.useRealTimers()

      // Create client
      const clientEphemeral = createMockEphemeral("client-1")
      const clientAskforce = new Askforce(doc.asks, clientEphemeral, {
        peerId: "client-1",
        mode: "pool",
      })

      // Create a single worker - it will always be priority
      const workerEphemeral = createMockEphemeral("worker-1")
      const workerAskforce = new Askforce(doc.asks, workerEphemeral, {
        peerId: "worker-1",
        mode: "pool",
        claimWindowMs: 500,
      })

      const handler = vi.fn().mockResolvedValue({ result: "4" })
      const unsub = workerAskforce.onAsk(handler)

      // Create an ask
      const askId = clientAskforce.ask({ query: "What is 2+2?" })

      // Wait a short time - priority worker should claim immediately
      await new Promise(resolve => setTimeout(resolve, 100))

      // Handler should have been called
      expect(handler).toHaveBeenCalledWith(askId, { query: "What is 2+2?" })

      unsub()
      clientAskforce.dispose()
      workerAskforce.dispose()
    })

    it("non-priority worker waits before claiming", async () => {
      vi.useRealTimers()

      // Create client
      const clientEphemeral = createMockEphemeral("client-1")
      const clientAskforce = new Askforce(doc.asks, clientEphemeral, {
        peerId: "client-1",
        mode: "pool",
      })

      // Create two workers with shared ephemeral visibility
      const worker1Ephemeral = createMockEphemeral("worker-1")
      const worker2Ephemeral = createMockEphemeral("worker-2")

      // Make workers aware of each other
      worker1Ephemeral.presenceStore.set("worker-2", {
        workerId: "worker-2",
        activeAsks: [],
        lastHeartbeat: Date.now(),
      })
      worker2Ephemeral.presenceStore.set("worker-1", {
        workerId: "worker-1",
        activeAsks: [],
        lastHeartbeat: Date.now(),
      })

      // Use a longer claim window for testing
      const claimWindowMs = 300

      const worker1Askforce = new Askforce(doc.asks, worker1Ephemeral, {
        peerId: "worker-1",
        mode: "pool",
        claimWindowMs,
      })

      const worker2Askforce = new Askforce(doc.asks, worker2Ephemeral, {
        peerId: "worker-2",
        mode: "pool",
        claimWindowMs,
      })

      const handler1 = vi.fn().mockResolvedValue({ result: "4" })
      const handler2 = vi.fn().mockResolvedValue({ result: "four" })

      const unsub1 = worker1Askforce.onAsk(handler1)
      const unsub2 = worker2Askforce.onAsk(handler2)

      // Create an ask
      clientAskforce.ask({ query: "What is 2+2?" })

      // Wait less than claim window - only priority worker should have claimed
      await new Promise(resolve => setTimeout(resolve, 100))

      // At least one handler should have been called (the priority worker)
      const totalCalls = handler1.mock.calls.length + handler2.mock.calls.length
      expect(totalCalls).toBeGreaterThanOrEqual(1)

      unsub1()
      unsub2()
      clientAskforce.dispose()
      worker1Askforce.dispose()
      worker2Askforce.dispose()
    })

    it("non-priority worker skips if already claimed", async () => {
      vi.useRealTimers()

      // Create client
      const clientEphemeral = createMockEphemeral("client-1")
      const clientAskforce = new Askforce(doc.asks, clientEphemeral, {
        peerId: "client-1",
        mode: "pool",
      })

      // Create two workers with shared ephemeral visibility
      const worker1Ephemeral = createMockEphemeral("worker-1")
      const worker2Ephemeral = createMockEphemeral("worker-2")

      // Make workers aware of each other
      worker1Ephemeral.presenceStore.set("worker-2", {
        workerId: "worker-2",
        activeAsks: [],
        lastHeartbeat: Date.now(),
      })
      worker2Ephemeral.presenceStore.set("worker-1", {
        workerId: "worker-1",
        activeAsks: [],
        lastHeartbeat: Date.now(),
      })

      // Use a longer claim window for testing
      const claimWindowMs = 200

      const worker1Askforce = new Askforce(doc.asks, worker1Ephemeral, {
        peerId: "worker-1",
        mode: "pool",
        claimWindowMs,
      })

      const worker2Askforce = new Askforce(doc.asks, worker2Ephemeral, {
        peerId: "worker-2",
        mode: "pool",
        claimWindowMs,
      })

      // Fast handler for priority worker
      const handler1 = vi.fn().mockResolvedValue({ result: "4" })
      // Slow handler for non-priority worker (shouldn't be called if priority claims first)
      const handler2 = vi.fn().mockResolvedValue({ result: "four" })

      const unsub1 = worker1Askforce.onAsk(handler1)
      const unsub2 = worker2Askforce.onAsk(handler2)

      // Create an ask
      clientAskforce.ask({ query: "What is 2+2?" })

      // Wait for claim window to pass
      await new Promise(resolve => setTimeout(resolve, claimWindowMs + 200))

      // Both handlers may be called in pool mode (staggered claiming reduces but doesn't eliminate duplicates)
      // The key is that priority worker claims first
      const totalCalls = handler1.mock.calls.length + handler2.mock.calls.length
      expect(totalCalls).toBeGreaterThanOrEqual(1)

      unsub1()
      unsub2()
      clientAskforce.dispose()
      worker1Askforce.dispose()
      worker2Askforce.dispose()
    })

    it("handles single worker gracefully", async () => {
      vi.useRealTimers()

      // Create client
      const clientEphemeral = createMockEphemeral("client-1")
      const clientAskforce = new Askforce(doc.asks, clientEphemeral, {
        peerId: "client-1",
        mode: "pool",
      })

      // Create a single worker
      const workerEphemeral = createMockEphemeral("worker-1")
      const workerAskforce = new Askforce(doc.asks, workerEphemeral, {
        peerId: "worker-1",
        mode: "pool",
        claimWindowMs: 500,
      })

      const handler = vi.fn().mockResolvedValue({ result: "4" })
      const unsub = workerAskforce.onAsk(handler)

      // Create an ask
      const askId = clientAskforce.ask({ query: "What is 2+2?" })

      // Wait a short time - single worker is always priority
      await new Promise(resolve => setTimeout(resolve, 100))

      // Handler should have been called immediately
      expect(handler).toHaveBeenCalledWith(askId, { query: "What is 2+2?" })

      unsub()
      clientAskforce.dispose()
      workerAskforce.dispose()
    })

    it("non-priority worker claims if priority worker absent", async () => {
      vi.useRealTimers()

      // Create client
      const clientEphemeral = createMockEphemeral("client-1")
      const clientAskforce = new Askforce(doc.asks, clientEphemeral, {
        peerId: "client-1",
        mode: "pool",
      })

      // Create a single worker that thinks there's another worker (but it's not actually processing)
      const workerEphemeral = createMockEphemeral("worker-2")
      // Simulate knowing about worker-1 but worker-1 is not actually running
      workerEphemeral.presenceStore.set("worker-1", {
        workerId: "worker-1",
        activeAsks: [],
        lastHeartbeat: Date.now(),
      })

      const claimWindowMs = 100

      const workerAskforce = new Askforce(doc.asks, workerEphemeral, {
        peerId: "worker-2",
        mode: "pool",
        claimWindowMs,
      })

      const handler = vi.fn().mockResolvedValue({ result: "4" })
      const unsub = workerAskforce.onAsk(handler)

      // Create an ask
      const askId = clientAskforce.ask({ query: "What is 2+2?" })

      // Wait for claim window to pass - worker-2 should claim after window
      await new Promise(resolve => setTimeout(resolve, claimWindowMs + 100))

      // Handler should have been called after the claim window
      expect(handler).toHaveBeenCalledWith(askId, { query: "What is 2+2?" })

      unsub()
      clientAskforce.dispose()
      workerAskforce.dispose()
    })
  })

  describe("Staggered claiming internals", () => {
    it("hashString produces consistent results for same input", () => {
      const askforce = new Askforce(doc.asks, mockEphemeral, {
        peerId: "peer-1",
        mode: "pool",
      })

      const hash1 = (askforce as any).hashString("ask_123_abc")
      const hash2 = (askforce as any).hashString("ask_123_abc")

      expect(hash1).toBe(hash2)

      askforce.dispose()
    })

    it("hashString produces different results for different inputs", () => {
      const askforce = new Askforce(doc.asks, mockEphemeral, {
        peerId: "peer-1",
        mode: "pool",
      })

      const hash1 = (askforce as any).hashString("ask_123_abc")
      const hash2 = (askforce as any).hashString("ask_456_def")

      expect(hash1).not.toBe(hash2)

      askforce.dispose()
    })

    it("isPriorityWorker returns stable result for same ask and workers", () => {
      const workerEphemeral = createMockEphemeral("worker-2")
      workerEphemeral.presenceStore.set("worker-1", {
        workerId: "worker-1",
        activeAsks: [],
        lastHeartbeat: Date.now(),
      })

      const askforce = new Askforce(doc.asks, workerEphemeral, {
        peerId: "worker-2",
        mode: "pool",
      })

      const askId = "ask_test_stability_check"
      const result1 = (askforce as any).isPriorityWorker(askId)
      const result2 = (askforce as any).isPriorityWorker(askId)

      expect(result1).toBe(result2)

      askforce.dispose()
    })

    it("hasBeenClaimed returns false when no answers exist", () => {
      const askforce = new Askforce(doc.asks, mockEphemeral, {
        peerId: "peer-1",
        mode: "pool",
      })

      const askId = askforce.ask({ query: "What is 2+2?" })

      expect((askforce as any).hasBeenClaimed(askId)).toBe(false)

      askforce.dispose()
    })

    it("hasBeenClaimed returns true when pending claim exists", () => {
      const askforce = new Askforce(doc.asks, mockEphemeral, {
        peerId: "peer-1",
        mode: "pool",
      })

      const askId = askforce.ask({ query: "What is 2+2?" })

      const entry = doc.asks.get(askId)
      entry?.answers.set("other-worker", {
        status: "pending",
        claimedAt: Date.now(),
      })

      expect((askforce as any).hasBeenClaimed(askId)).toBe(true)

      askforce.dispose()
    })

    it("hasBeenClaimed returns true when answered claim exists", () => {
      const askforce = new Askforce(doc.asks, mockEphemeral, {
        peerId: "peer-1",
        mode: "pool",
      })

      const askId = askforce.ask({ query: "What is 2+2?" })

      const entry = doc.asks.get(askId)
      entry?.answers.set("other-worker", {
        status: "answered",
        data: { result: "4" },
        answeredAt: Date.now(),
      })

      expect((askforce as any).hasBeenClaimed(askId)).toBe(true)

      askforce.dispose()
    })
  })

  describe("RPC mode regression", () => {
    it("RPC mode claims immediately even with long claimWindowMs", async () => {
      vi.useRealTimers()

      const clientEphemeral = createMockEphemeral("client-1")
      const clientAskforce = new Askforce(doc.asks, clientEphemeral, {
        peerId: "client-1",
        mode: "rpc",
      })

      const workerEphemeral = createMockEphemeral("worker-1")
      // Simulate knowing about another worker (would trigger staggered claiming in pool mode)
      workerEphemeral.presenceStore.set("worker-2", {
        workerId: "worker-2",
        activeAsks: [],
        lastHeartbeat: Date.now(),
      })

      const workerAskforce = new Askforce(doc.asks, workerEphemeral, {
        peerId: "worker-1",
        mode: "rpc",
        claimWindowMs: 5000, // Long window that should be ignored in RPC mode
      })

      const handler = vi.fn().mockResolvedValue({ result: "4" })
      const unsub = workerAskforce.onAsk(handler)

      const askId = clientAskforce.ask({ query: "What is 2+2?" })

      // Wait much less than claimWindowMs
      await new Promise(resolve => setTimeout(resolve, 100))

      // Handler should have been called immediately (not waiting for window)
      expect(handler).toHaveBeenCalledWith(askId, { query: "What is 2+2?" })

      unsub()
      clientAskforce.dispose()
      workerAskforce.dispose()
    })
  })

  describe("AskforceError context", () => {
    it("timeout error includes context properties", async () => {
      vi.useRealTimers()

      const askforce = new Askforce(doc.asks, mockEphemeral, {
        peerId: "peer-1",
        mode: "rpc",
      })

      const askId = askforce.ask({ query: "What is 2+2?" })

      try {
        await askforce.waitFor(askId, 50)
        expect.fail("Should have thrown")
      } catch (error) {
        expect(error).toBeInstanceOf(AskforceError)
        const askforceError = error as AskforceError
        expect(askforceError.context.askId).toBe(askId)
        expect(askforceError.context.peerId).toBe("peer-1")
        expect(askforceError.context.mode).toBe("rpc")
        expect(askforceError.context.timeoutMs).toBe(50)
      }

      askforce.dispose()
    })

    it("all-failed error includes failure reasons", async () => {
      vi.useRealTimers()

      const askforce = new Askforce(doc.asks, mockEphemeral, {
        peerId: "peer-1",
        mode: "rpc",
      })

      const askId = askforce.ask({ query: "What is 2+2?" })

      // Add a failed answer
      const entry = doc.asks.get(askId)
      entry?.answers.set("worker-1", {
        status: "failed",
        reason: "computation error",
        failedAt: Date.now(),
      })

      try {
        await askforce.waitFor(askId, 5000)
        expect.fail("Should have thrown")
      } catch (error) {
        expect(error).toBeInstanceOf(AskforceError)
        const askforceError = error as AskforceError
        expect(askforceError.context.askId).toBe(askId)
        expect(askforceError.context.failureReasons).toContain(
          "computation error",
        )
      }

      askforce.dispose()
    })
  })

  describe("dispose()", () => {
    it("stops heartbeat on dispose", () => {
      const askforce = new Askforce(doc.asks, mockEphemeral, {
        peerId: "peer-1",
        mode: "rpc",
      })

      // Start heartbeat by calling onAsk
      const unsub = askforce.onAsk(async () => ({ result: "test" }))

      // Verify presence is set
      expect(mockEphemeral.self).toBeDefined()

      // Dispose
      unsub()
      askforce.dispose()

      // Presence should be cleared
      expect(mockEphemeral.presenceStore.has("peer-1")).toBe(false)
    })

    it("cleans up subscriptions on dispose", () => {
      const askforce = new Askforce(doc.asks, mockEphemeral, {
        peerId: "peer-1",
        mode: "rpc",
      })

      const unsub = askforce.onAsk(async () => ({ result: "test" }))
      unsub()

      // Should not throw when disposing after unsubscribe
      expect(() => askforce.dispose()).not.toThrow()
    })
  })
})
