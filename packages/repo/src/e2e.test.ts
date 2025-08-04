import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { Repo } from "./repo.js"
import {
  InProcessNetworkAdapter,
  InProcessNetworkBroker,
} from "./network/in-process-network-adapter.js"

describe("End-to-end synchronization", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("should synchronize a document between two repos", async () => {
    const broker = new InProcessNetworkBroker()
    const repo1 = new Repo({ network: [new InProcessNetworkAdapter(broker)] })
    const repo2 = new Repo({ network: [new InProcessNetworkAdapter(broker)] })

    const handle1 = repo1.create<{ text: string }>()
    await vi.runAllTimersAsync()
    expect(handle1.state).toBe("ready")

    handle1.change(doc => {
      doc.text = "hello"
    })
    expect(handle1.doc().toJSON()).toEqual({ root: { text: "hello" } })

    const handle2 = repo2.find<{ text:string }>(handle1.documentId)
    await vi.runAllTimersAsync()
    expect(handle2.state).toBe("ready")

    expect(handle2.doc().toJSON()).toEqual({ root: { text: "hello" } })

    handle2.change(doc => {
      doc.text += " world"
    })
    expect(handle2.doc().toJSON()).toEqual({ root: { text: "hello world" } })

    await vi.runAllTimersAsync()
    expect(handle1.doc().toJSON()).toEqual({ root: { text: "hello world" } })
  })

  it("should not apply a change if the sender is not allowed to write", async () => {
    const broker = new InProcessNetworkBroker()
    let repo1CanWrite = true

    const repo1 = new Repo({
      network: [new InProcessNetworkAdapter(broker)],
      permissions: {
        canList: () => true,
        canWrite: () => repo1CanWrite,
        canDelete: () => true,
      },
    })
    const repo2 = new Repo({ network: [new InProcessNetworkAdapter(broker)] })

    const handle1 = repo1.create<{ text: string }>()
    await vi.runAllTimersAsync()
    const handle2 = repo2.find<{ text: string }>(handle1.documentId)
    await vi.runAllTimersAsync()

    handle2.change(doc => {
      doc.text = "hello"
    })
    await vi.runAllTimersAsync()
    expect(handle1.doc().toJSON()).toEqual({ root: { text: "hello" } })

    repo1CanWrite = false

    handle2.change(doc => {
      doc.text += " world"
    })
    await vi.runAllTimersAsync()

    expect(handle1.doc().toJSON()).toEqual({ root: { text: "hello" } })
  })

  it("should not delete a document if the sender is not allowed to delete", async () => {
    const broker = new InProcessNetworkBroker()
    const repo1 = new Repo({
      network: [new InProcessNetworkAdapter(broker)],
      permissions: {
        canList: () => true,
        canWrite: () => true,
        canDelete: () => false,
      },
    })
    const repo2 = new Repo({ network: [new InProcessNetworkAdapter(broker)] })

    const handle1 = repo1.create<{ text: string }>()
    await vi.runAllTimersAsync()
    const handle2 = repo2.find<{ text: string }>(handle1.documentId)
    await vi.runAllTimersAsync()

    repo2.delete(handle1.documentId)
    await vi.runAllTimersAsync()

    expect(repo1.handles.has(handle1.documentId)).toBe(true)
    expect(handle1.state).toBe("ready")
  })
})

describe("canList permission", () => {
  let broker: InProcessNetworkBroker
  let repoA: Repo
  let repoB: Repo

  beforeEach(() => {
    vi.useFakeTimers()
    broker = new InProcessNetworkBroker()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("should reveal all documents when canList is always true", async () => {
    repoA = new Repo({
      network: [new InProcessNetworkAdapter(broker)],
      permissions: {
        canList: () => true,
        canWrite: () => true,
        canDelete: () => true,
      },
    })
    const handle1 = repoA.create()
    const handle2 = repoA.create()
    await vi.runAllTimersAsync()
    await Promise.all([handle1.whenReady(), handle2.whenReady()])

    // Repo B connects after Repo A has documents
    repoB = new Repo({ network: [new InProcessNetworkAdapter(broker)] })
    await vi.runAllTimersAsync()

    // Repo B should have been told about both documents
    const bHandle1 = repoB.find(handle1.documentId)
    const bHandle2 = repoB.find(handle2.documentId)
    await vi.runAllTimersAsync()

    await Promise.all([bHandle1.whenReady(), bHandle2.whenReady()])

    // Run timers one last time to make sure handles have a chance to update their state
    await vi.runAllTimersAsync()

    expect(bHandle1.state).toBe("ready")
    expect(bHandle2.state).toBe("ready")
  })

  it("should not announce documents when canList is false", async () => {
    repoA = new Repo({
      network: [new InProcessNetworkAdapter(broker)],
      permissions: { canList: () => false },
    })
    repoB = new Repo({ network: [new InProcessNetworkAdapter(broker)] })

    repoA.create() // Create a document that will not be announced
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

    const handleA = repoA.create<{ text: string }>()
    await handleA.whenReady()
    handleA.change(d => {
      d.text = "hello"
    })
    await vi.runAllTimersAsync()

    // B explicitly requests the document. It should succeed.
    const handleB = repoB.find<{ text: string }>(handleA.documentId)
    await handleB.whenReady()
    await vi.runAllTimersAsync()

    expect(handleB.state).toBe("ready")
    expect(handleB.doc().toJSON()).toEqual({ root: { text: "hello" } })
  })

  it("should selectively announce documents based on permissions", async () => {
    repoA = new Repo({
      network: [new InProcessNetworkAdapter(broker)],
      permissions: {
        canList: (peerId, documentId) =>
          documentId.startsWith("allowed"),
      },
    })
    repoB = new Repo({ network: [new InProcessNetworkAdapter(broker)] })

    repoA.create({ documentId: "allowed-doc-1" })
    repoA.create({ documentId: "denied-doc-1" })
    repoA.create({ documentId: "allowed-doc-2" })
    await vi.runAllTimersAsync()

    // B should only have been told about the allowed docs
    expect(repoB.handles.size).toBe(2)
    expect(repoB.handles.has("allowed-doc-1")).toBe(true)
    expect(repoB.handles.has("allowed-doc-2")).toBe(true)
    expect(repoB.handles.has("denied-doc-1")).toBe(false)
  })

  it("should sync a non-announced document on direct request", async () => {
    repoA = new Repo({
      network: [new InProcessNetworkAdapter(broker)],
      permissions: {
        canList: (peerId, documentId) =>
          documentId.startsWith("allowed"),
      },
    })
    repoB = new Repo({ network: [new InProcessNetworkAdapter(broker)] })

    const handleDenied = repoA.create<{ text: string }>({
      documentId: "denied-doc",
    })
    await handleDenied.whenReady()
    handleDenied.change(d => {
      d.text = "denied"
    })
    await vi.runAllTimersAsync()

    // B should not have been told about the denied doc
    expect(repoB.handles.has(handleDenied.documentId)).toBe(false)

    // Now, B explicitly requests the denied document. It should still succeed.
    const bHandleDenied = repoB.find<{ text: string }>(handleDenied.documentId)
    await bHandleDenied.whenReady()
    expect(bHandleDenied.state).toBe("ready")
    expect(bHandleDenied.doc().toJSON()).toEqual({ root: { text: "denied" } })
  })
})
