import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  InProcessNetworkAdapter,
  InProcessNetworkBroker,
} from "./network/in-process-network-adapter.js"
import { Repo } from "./repo.js"

// Integration test suite for the Repo
describe("Repo", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("should synchronize a document between two repos", async () => {
    const broker = new InProcessNetworkBroker()
    const repo1 = new Repo({
      peerId: "repo1",
      network: [new InProcessNetworkAdapter(broker)],
    })
    const repo2 = new Repo({
      peerId: "repo2",
      network: [new InProcessNetworkAdapter(broker)],
    })

    // Repo 1 creates a document
    const handle1 = await repo1.create()
    expect(handle1.state).toBe("ready")

    // Mutate the document
    handle1.change(doc => {
      doc.getMap("root").set("text", "hello")
    })
    expect(handle1.doc().getMap("root").toJSON()).toEqual({ text: "hello" })

    // Repo 2 finds the document
    const handle2 = await repo2.find(handle1.documentId)
    expect(handle2.state).toBe("ready")
    expect(handle2.doc().getMap("root").toJSON()).toEqual({ text: "hello" })

    // Mutate the document from repo 2
    handle2.change(doc => {
      const root = doc.getMap("root")
      root.get("text")
      root.set("text", `${root.get("text")} world`)
    })
    expect(handle2.doc().getMap("root").toJSON()).toEqual({
      text: "hello world",
    })

    // Wait for the change to propagate back to repo 1
    await vi.runAllTimersAsync()
    expect(handle1.doc().getMap("root").toJSON()).toEqual({
      text: "hello world",
    })
  })

  it("should not apply a change if a peer is not allowed to write", async () => {
    const broker = new InProcessNetworkBroker()
    let repo1CanWrite = true

    const repo1 = new Repo({
      peerId: "repo1",
      network: [new InProcessNetworkAdapter(broker)],
      permissions: {
        canWrite: () => repo1CanWrite,
      },
    })
    const repo2 = new Repo({
      peerId: "repo2",
      network: [new InProcessNetworkAdapter(broker)],
    })

    const handle1 = await repo1.create()
    const handle2 = await repo2.find(handle1.documentId)

    // A change from a permitted peer should be applied
    handle2.change(doc => {
      doc.getMap("root").set("text", "hello")
    })

    await vi.runAllTimersAsync()

    expect(handle1.doc().getMap("root").toJSON()).toEqual({ text: "hello" })

    // A change from a non-permitted peer should not be applied
    repo1CanWrite = false
    handle2.change(doc => {
      const root = doc.getMap("root")
      root.set("text", `${root.get("text")} world`)
    })

    await vi.runAllTimersAsync()

    expect(handle1.doc().getMap("root").toJSON()).toEqual({ text: "hello" })
  })

  it("should not delete a document if a peer is not allowed to", async () => {
    const broker = new InProcessNetworkBroker()
    const repo1 = new Repo({
      network: [new InProcessNetworkAdapter(broker)],
      permissions: { canDelete: () => false },
    })
    const repo2 = new Repo({ network: [new InProcessNetworkAdapter(broker)] })

    const handle1 = await repo1.create()
    const handle2 = await repo2.find(handle1.documentId)
    expect(handle2.state).toBe("ready")

    await repo2.delete(handle1.documentId)

    await vi.runAllTimersAsync()

    // The document should still exist in repo1
    expect(repo1.handles.has(handle1.documentId)).toBe(true)
    expect(handle1.state).toBe("ready")
  })

  describe("canList permission", () => {
    let broker: InProcessNetworkBroker
    let repoA: Repo
    let repoB: Repo

    beforeEach(() => {
      broker = new InProcessNetworkBroker()
    })

    it("should reveal all documents when canList is always true", async () => {
      repoA = new Repo({
        peerId: "repoA",
        network: [new InProcessNetworkAdapter(broker)],
        permissions: { canList: () => true },
      })
      const handle1 = await repoA.create()
      const handle2 = await repoA.create()

      repoB = new Repo({
        peerId: "repoB",
        network: [new InProcessNetworkAdapter(broker)],
      })

      // Wait for the repos to connect and exchange messages
      await vi.runAllTimersAsync()

      expect(repoB.handles.has(handle1.documentId)).toBe(true)
      expect(repoB.handles.has(handle2.documentId)).toBe(true)

      const bHandle1 = await repoB.find(handle1.documentId)
      const bHandle2 = await repoB.find(handle2.documentId)

      expect(bHandle1.state).toBe("ready")
      expect(bHandle2.state).toBe("ready")
    })

    it("should not announce documents when canList is false", async () => {
      repoA = new Repo({
        network: [new InProcessNetworkAdapter(broker)],
        permissions: { canList: () => false },
      })
      repoB = new Repo({ network: [new InProcessNetworkAdapter(broker)] })

      await repoA.create() // Create a document that will not be announced
      await vi.runAllTimersAsync()

      // B should not know about the doc, because it was not announced
      expect(repoB.handles.size).toBe(0)
    })

    it("should sync a document on direct request even if not announced", async () => {
      repoA = new Repo({
        network: [new InProcessNetworkAdapter(broker)],
        permissions: { canList: () => false },
      })
      repoB = new Repo({ network: [new InProcessNetworkAdapter(broker)] })

      const handleA = await repoA.create()
      handleA.change(doc => {
        doc.getMap("root").set("text", "hello")
      })

      // B explicitly requests the document. It should succeed.
      const handleB = await repoB.find(handleA.documentId)

      expect(handleB.state).toBe("ready")
      expect(handleB.doc().getMap("root").toJSON()).toEqual({ text: "hello" })
    })

    it("should selectively announce documents based on permissions", async () => {
      repoA = new Repo({
        peerId: "repoA",
        network: [new InProcessNetworkAdapter(broker)],
        permissions: {
          canList: (_, documentId) => documentId.startsWith("allowed"),
        },
      })
      repoB = new Repo({
        peerId: "repoB",
        network: [new InProcessNetworkAdapter(broker)],
      })

      await repoA.create({ documentId: "allowed-doc-1" })
      await repoA.create({ documentId: "denied-doc-1" })
      await repoA.create({ documentId: "allowed-doc-2" })
      await vi.runAllTimersAsync()

      expect(repoB.handles.size).toBe(2)
      expect(repoB.handles.has("allowed-doc-1")).toBe(true)
      expect(repoB.handles.has("allowed-doc-2")).toBe(true)
      expect(repoB.handles.has("denied-doc-1")).toBe(false)
    })
  })
})
