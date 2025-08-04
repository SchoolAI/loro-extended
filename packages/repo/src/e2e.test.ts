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
        canRevealDocumentId: () => true,
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
        canRevealDocumentId: () => true,
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
