/**
 * Integration tests for Askforce with Repo.
 *
 * These tests verify that Askforce works correctly when used with
 * a Repo and network adapters (the real-world use case).
 */
import { Shape } from "@loro-extended/change"
import { Bridge, BridgeAdapter, Repo } from "@loro-extended/repo"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Askforce } from "./askforce.js"
import { createAskforceSchema } from "./schema.js"

describe("Askforce with Repo Integration", () => {
  // Create a typed schema for testing
  const questionSchema = Shape.plain.struct({ query: Shape.plain.string() })
  const answerSchema = Shape.plain.struct({ result: Shape.plain.string() })
  const askforceSchema = createAskforceSchema(questionSchema, answerSchema)

  const docSchema = Shape.doc({
    rpc: askforceSchema,
  })

  const ephemeralDeclarations = {
    presence: Shape.plain.struct({
      workerId: Shape.plain.string(),
      activeAsks: Shape.plain.array(Shape.plain.string()),
      lastHeartbeat: Shape.plain.number(),
    }),
  }

  let clientRepo: Repo
  let serverRepo: Repo

  afterEach(() => {
    // Clean up repos if they exist
  })

  it("should sync asks from client to server", async () => {
    const bridge = new Bridge()
    const docId = "test-rpc"

    // Create client and server repos
    clientRepo = new Repo({
      identity: { name: "client", type: "user", peerId: "1" as `${number}` },
      adapters: [new BridgeAdapter({ bridge, adapterType: "client-adapter" })],
    })

    serverRepo = new Repo({
      identity: { name: "server", type: "service", peerId: "2" as `${number}` },
      adapters: [new BridgeAdapter({ bridge, adapterType: "server-adapter" })],
    })

    // Get handles
    const clientHandle = clientRepo.get(docId, docSchema, ephemeralDeclarations)
    const serverHandle = serverRepo.get(docId, docSchema, ephemeralDeclarations)

    // Create Askforce instances
    const clientAskforce = new Askforce(
      clientHandle.doc.rpc,
      clientHandle.presence,
      { peerId: clientHandle.peerId, mode: "rpc" },
    )

    const serverAskforce = new Askforce(
      serverHandle.doc.rpc,
      serverHandle.presence,
      { peerId: serverHandle.peerId, mode: "rpc" },
    )

    // Server starts listening
    const handler = vi.fn().mockResolvedValue({ result: "answer" })
    const unsub = serverAskforce.onAsk(handler)

    // Client asks a question
    const askId = clientAskforce.ask({ query: "test question" })

    // Wait for sync and processing
    await new Promise(resolve => setTimeout(resolve, 500))

    // Server should have received and processed the ask
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(askId, { query: "test question" })

    unsub()
    clientAskforce.dispose()
    serverAskforce.dispose()
  })

  it("should sync answers from server back to client", async () => {
    const bridge = new Bridge()
    const docId = "test-rpc-answer"

    // Create client and server repos
    clientRepo = new Repo({
      identity: { name: "client", type: "user", peerId: "1" as `${number}` },
      adapters: [new BridgeAdapter({ bridge, adapterType: "client-adapter" })],
    })

    serverRepo = new Repo({
      identity: { name: "server", type: "service", peerId: "2" as `${number}` },
      adapters: [new BridgeAdapter({ bridge, adapterType: "server-adapter" })],
    })

    // Get handles
    const clientHandle = clientRepo.get(docId, docSchema, ephemeralDeclarations)
    const serverHandle = serverRepo.get(docId, docSchema, ephemeralDeclarations)

    // Create Askforce instances
    const clientAskforce = new Askforce(
      clientHandle.doc.rpc,
      clientHandle.presence,
      { peerId: clientHandle.peerId, mode: "rpc" },
    )

    const serverAskforce = new Askforce(
      serverHandle.doc.rpc,
      serverHandle.presence,
      { peerId: serverHandle.peerId, mode: "rpc" },
    )

    // Server starts listening
    const unsub = serverAskforce.onAsk(async () => {
      return { result: "server response" }
    })

    // Client asks a question
    const askId = clientAskforce.ask({ query: "test question" })

    // Client waits for answer - THIS IS THE KEY TEST
    // If answers don't sync back, this will timeout
    const answer = await clientAskforce.waitFor(askId, 5000)

    expect(answer).toEqual({ result: "server response" })

    unsub()
    clientAskforce.dispose()
    serverAskforce.dispose()
  })
})
