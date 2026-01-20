/**
 * Integration tests for Asks.
 *
 * These tests verify the complete workflow of Asks in realistic scenarios,
 * including RPC mode, Pool mode, and failure recovery.
 */
import { createTypedDoc, Shape } from "@loro-extended/change"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Asks } from "./asks.js"
import { createAskSchema } from "./schema.js"
import { createMockEphemeral } from "./test-utils.js"

describe("Asks Integration", () => {
  // Create a typed schema for testing
  const questionSchema = Shape.plain.struct({ query: Shape.plain.string() })
  const answerSchema = Shape.plain.struct({ result: Shape.plain.string() })
  const asksSchema = createAskSchema(questionSchema, answerSchema)

  const docSchema = Shape.doc({
    asks: asksSchema,
  })

  let doc: ReturnType<typeof createTypedDoc<typeof docSchema>>

  beforeEach(() => {
    doc = createTypedDoc(docSchema)
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe("RPC mode request/response pattern", () => {
    it("completes a full request/response cycle", async () => {
      vi.useRealTimers()

      // Create client
      const clientEphemeral = createMockEphemeral("client-1")
      const client = new Asks(doc.asks, clientEphemeral, {
        peerId: "client-1",
        mode: "rpc",
      })

      // Create server
      const serverEphemeral = createMockEphemeral("server-1")
      const server = new Asks(doc.asks, serverEphemeral, {
        peerId: "server-1",
        mode: "rpc",
      })

      // Server starts listening
      const handler = vi.fn().mockImplementation(async (_askId, question) => {
        // Simulate some processing
        await new Promise(resolve => setTimeout(resolve, 10))
        const num = Number.parseInt(question.query.match(/\d+/)?.[0] ?? "0", 10)
        return { result: String(num * 2) }
      })
      const unsub = server.onAsk(handler)

      // Client asks a question
      const askId = client.ask({ query: "What is 5 * 2?" })

      // Client waits for answer
      const answer = await client.waitFor(askId, 5000)

      expect(answer).toEqual({ result: "10" })
      expect(handler).toHaveBeenCalledTimes(1)

      unsub()
      client.dispose()
      server.dispose()
    })

    it("handles multiple sequential requests", async () => {
      vi.useRealTimers()

      const clientEphemeral = createMockEphemeral("client-1")
      const client = new Asks(doc.asks, clientEphemeral, {
        peerId: "client-1",
        mode: "rpc",
      })

      const serverEphemeral = createMockEphemeral("server-1")
      const server = new Asks(doc.asks, serverEphemeral, {
        peerId: "server-1",
        mode: "rpc",
      })

      const handler = vi.fn().mockImplementation(async (_askId, question) => {
        return { result: `Answer to: ${question.query}` }
      })
      const unsub = server.onAsk(handler)

      // Send multiple requests
      const askId1 = client.ask({ query: "Question 1" })
      const askId2 = client.ask({ query: "Question 2" })
      const askId3 = client.ask({ query: "Question 3" })

      // Wait for all answers
      const [answer1, answer2, answer3] = await Promise.all([
        client.waitFor(askId1, 5000),
        client.waitFor(askId2, 5000),
        client.waitFor(askId3, 5000),
      ])

      expect(answer1).toEqual({ result: "Answer to: Question 1" })
      expect(answer2).toEqual({ result: "Answer to: Question 2" })
      expect(answer3).toEqual({ result: "Answer to: Question 3" })
      expect(handler).toHaveBeenCalledTimes(3)

      unsub()
      client.dispose()
      server.dispose()
    })

    it("handler errors result in failed status", async () => {
      vi.useRealTimers()

      const clientEphemeral = createMockEphemeral("client-1")
      const client = new Asks(doc.asks, clientEphemeral, {
        peerId: "client-1",
        mode: "rpc",
      })

      const serverEphemeral = createMockEphemeral("server-1")
      const server = new Asks(doc.asks, serverEphemeral, {
        peerId: "server-1",
        mode: "rpc",
      })

      const handler = vi.fn().mockRejectedValue(new Error("Processing failed"))
      const unsub = server.onAsk(handler)

      const askId = client.ask({ query: "Will fail" })

      await expect(client.waitFor(askId, 5000)).rejects.toThrow(
        /All workers failed.*Processing failed/,
      )

      unsub()
      client.dispose()
      server.dispose()
    })
  })

  describe("Pool mode with multiple workers", () => {
    it("distributes work across multiple workers", async () => {
      vi.useRealTimers()

      const clientEphemeral = createMockEphemeral("client-1")
      const client = new Asks(doc.asks, clientEphemeral, {
        peerId: "client-1",
        mode: "pool",
      })

      // Create multiple workers
      const worker1Ephemeral = createMockEphemeral("worker-1")
      const worker1 = new Asks(doc.asks, worker1Ephemeral, {
        peerId: "worker-1",
        mode: "pool",
      })

      const worker2Ephemeral = createMockEphemeral("worker-2")
      const worker2 = new Asks(doc.asks, worker2Ephemeral, {
        peerId: "worker-2",
        mode: "pool",
      })

      const worker3Ephemeral = createMockEphemeral("worker-3")
      const worker3 = new Asks(doc.asks, worker3Ephemeral, {
        peerId: "worker-3",
        mode: "pool",
      })

      const handler1 = vi.fn().mockResolvedValue({ result: "from worker 1" })
      const handler2 = vi.fn().mockResolvedValue({ result: "from worker 2" })
      const handler3 = vi.fn().mockResolvedValue({ result: "from worker 3" })

      const unsub1 = worker1.onAsk(handler1)
      const unsub2 = worker2.onAsk(handler2)
      const unsub3 = worker3.onAsk(handler3)

      // Client asks a question
      const askId = client.ask({ query: "Process this" })

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 100))

      // All workers should have processed the ask
      expect(handler1).toHaveBeenCalled()
      expect(handler2).toHaveBeenCalled()
      expect(handler3).toHaveBeenCalled()

      // All answers should be available
      const answers = client.allAnswers(askId)
      expect(answers).toHaveLength(3)

      // waitFor should return one answer (deterministically selected)
      const answer = (await client.waitFor(askId)) as { result: string }
      expect(answer.result).toMatch(/from worker/)

      unsub1()
      unsub2()
      unsub3()
      client.dispose()
      worker1.dispose()
      worker2.dispose()
      worker3.dispose()
    })

    it("handles partial failures gracefully", async () => {
      vi.useRealTimers()

      const clientEphemeral = createMockEphemeral("client-1")
      const client = new Asks(doc.asks, clientEphemeral, {
        peerId: "client-1",
        mode: "pool",
      })

      const worker1Ephemeral = createMockEphemeral("worker-1")
      const worker1 = new Asks(doc.asks, worker1Ephemeral, {
        peerId: "worker-1",
        mode: "pool",
      })

      const worker2Ephemeral = createMockEphemeral("worker-2")
      const worker2 = new Asks(doc.asks, worker2Ephemeral, {
        peerId: "worker-2",
        mode: "pool",
      })

      // Worker 1 fails, Worker 2 succeeds
      const handler1 = vi.fn().mockRejectedValue(new Error("Worker 1 failed"))
      const handler2 = vi.fn().mockResolvedValue({ result: "success" })

      const unsub1 = worker1.onAsk(handler1)
      const unsub2 = worker2.onAsk(handler2)

      const askId = client.ask({ query: "Process this" })

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 100))

      // Status should be answered (at least one success)
      expect(client.getStatus(askId)).toBe("answered")

      // waitFor should return the successful answer
      const answer = await client.waitFor(askId)
      expect(answer).toEqual({ result: "success" })

      unsub1()
      unsub2()
      client.dispose()
      worker1.dispose()
      worker2.dispose()
    })
  })

  describe("Multiple queues in same document", () => {
    it("supports multiple independent queues", async () => {
      vi.useRealTimers()

      // Create a document with two queues
      const multiQueueSchema = Shape.doc({
        mathQueue: asksSchema,
        textQueue: asksSchema,
      })
      const multiDoc = createTypedDoc(multiQueueSchema)

      // Create clients for each queue
      const mathClientEphemeral = createMockEphemeral("math-client")
      const mathClient = new Asks(multiDoc.mathQueue, mathClientEphemeral, {
        peerId: "math-client",
        mode: "rpc",
      })

      const textClientEphemeral = createMockEphemeral("text-client")
      const textClient = new Asks(multiDoc.textQueue, textClientEphemeral, {
        peerId: "text-client",
        mode: "rpc",
      })

      // Create workers for each queue
      const mathWorkerEphemeral = createMockEphemeral("math-worker")
      const mathWorker = new Asks(multiDoc.mathQueue, mathWorkerEphemeral, {
        peerId: "math-worker",
        mode: "rpc",
      })

      const textWorkerEphemeral = createMockEphemeral("text-worker")
      const textWorker = new Asks(multiDoc.textQueue, textWorkerEphemeral, {
        peerId: "text-worker",
        mode: "rpc",
      })

      const mathHandler = vi.fn().mockResolvedValue({ result: "42" })
      const textHandler = vi.fn().mockResolvedValue({ result: "hello world" })

      const unsubMath = mathWorker.onAsk(mathHandler)
      const unsubText = textWorker.onAsk(textHandler)

      // Ask questions on both queues
      const mathAskId = mathClient.ask({ query: "What is 6 * 7?" })
      const textAskId = textClient.ask({ query: "Say hello" })

      // Wait for answers
      const [mathAnswer, textAnswer] = await Promise.all([
        mathClient.waitFor(mathAskId, 5000),
        textClient.waitFor(textAskId, 5000),
      ])

      expect(mathAnswer).toEqual({ result: "42" })
      expect(textAnswer).toEqual({ result: "hello world" })

      // Each handler should only be called once
      expect(mathHandler).toHaveBeenCalledTimes(1)
      expect(textHandler).toHaveBeenCalledTimes(1)

      // Math handler should not see text questions and vice versa
      expect(mathHandler).toHaveBeenCalledWith(
        mathAskId,
        expect.objectContaining({ query: "What is 6 * 7?" }),
      )
      expect(textHandler).toHaveBeenCalledWith(
        textAskId,
        expect.objectContaining({ query: "Say hello" }),
      )

      unsubMath()
      unsubText()
      mathClient.dispose()
      textClient.dispose()
      mathWorker.dispose()
      textWorker.dispose()
    })
  })

  describe("Checkpoint resumption", () => {
    it("resumes from checkpoint after worker restart", async () => {
      vi.useRealTimers()

      const clientEphemeral = createMockEphemeral("client-1")
      const client = new Asks(doc.asks, clientEphemeral, {
        peerId: "client-1",
        mode: "rpc",
      })

      // Create some asks before the worker starts
      const oldAskId = client.ask({ query: "Old question" })

      // Get the timestamp for checkpoint
      const oldEntry = doc.asks.get(oldAskId)
      const checkpoint = (oldEntry?.toJSON()?.askedAt ?? 0) + 1

      // Wait a bit to ensure new asks have later timestamps
      await new Promise(resolve => setTimeout(resolve, 10))

      // Create a new ask after checkpoint
      const newAskId = client.ask({ query: "New question" })

      // Worker starts with checkpoint (simulating restart)
      const workerEphemeral = createMockEphemeral("worker-1")
      const worker = new Asks(doc.asks, workerEphemeral, {
        peerId: "worker-1",
        mode: "rpc",
      })

      const handler = vi.fn().mockResolvedValue({ result: "answer" })
      const unsub = worker.onAsk(handler, { since: checkpoint })

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 50))

      // Handler should only be called for the new ask
      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith(newAskId, { query: "New question" })

      // Old ask should still be pending
      expect(client.getStatus(oldAskId)).toBe("pending")

      // New ask should be answered
      expect(client.getStatus(newAskId)).toBe("answered")

      unsub()
      client.dispose()
      worker.dispose()
    })
  })
})
