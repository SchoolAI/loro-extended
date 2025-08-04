import { describe, expect, it } from "vitest"

import { Repo } from "./repo.js"
import {
  InProcessNetworkAdapter,
  InProcessNetworkBroker,
} from "./network/in-process-network-adapter.js"

describe("End-to-end synchronization", () => {
  it("should synchronize a document between two repos", async () => {
    const broker = new InProcessNetworkBroker()

    // Create two repos with a shared network
    const repo1 = new Repo({ network: [new InProcessNetworkAdapter(broker)] })
    const repo2 = new Repo({ network: [new InProcessNetworkAdapter(broker)] })

    // Create a document in repo1
    const handle1 = repo1.create<{ text: string }>()
    const { status: status1 } = await handle1.whenReady()
    expect(status1).toBe("ready")
    handle1.change(doc => {
      doc.text = "hello"
    })
    expect(handle1.doc().toJSON()).toEqual({ root: { text: "hello" } })

    // Find the same document in repo2
    // This should trigger a request-sync/sync flow
    const handle2 = repo2.find<{ text: string }>(handle1.documentId)
    const { status: status2 } = await handle2.whenReady()
    expect(status2).toBe("ready")

    // The document should have the content from repo1
    expect(handle2.doc().toJSON()).toEqual({ root: { text: "hello" } })

    // Make a change in repo2
    handle2.change(doc => {
      doc.text += " world"
    })
    expect(handle2.doc().toJSON()).toEqual({ root: { text: "hello world" } })

    // Wait for the sync message to be processed
    await handle1.once("change")

    // The change should be reflected in repo1
    expect(handle1.doc().toJSON()).toEqual({ root: { text: "hello world" } })
  })

  it("should not sync a document if the sender is not allowed to share", async () => {
    const broker = new InProcessNetworkBroker()

    const repo1 = new Repo({
      network: [new InProcessNetworkAdapter(broker)],
      permissions: {
        canShare: () => false,
        canWrite: () => true,
        canDelete: () => true,
      },
    })

    const repo2 = new Repo({
      network: [new InProcessNetworkAdapter(broker)],
    })

    // Try to find a document that doesn't exist yet.
    // This will enter the "searching" state.
    const handle2 = repo2.find<{ text: string }>("non-existent-doc")

    // Let the event loop run so repo2 can connect and start searching
    await new Promise(resolve => setTimeout(resolve, 0))

    // Now, repo1 creates a document. Because its `canShare` returns false,
    // it will not announce this document to repo2.
    const handle1 = repo1.create<{ text: string }>()
    await handle1.whenReady()
    handle1.change(doc => {
      doc.text = "hello"
    })

    // The find operation in repo2 should eventually time out.
    const { status } = await handle2.whenReady()
    expect(status).toBe("unavailable")

    // Just to be sure, check that the original handle is still fine
    expect(handle1.state).toBe("ready")
  }, 6000)

  it("should not apply a change if the sender is not allowed to write", async () => {
    const broker = new InProcessNetworkBroker()

    let repo1CanWrite = true

    // Create two repos with a shared network
    const repo1 = new Repo({
      network: [new InProcessNetworkAdapter(broker)],
      permissions: {
        canShare: () => true,
        canWrite: () => repo1CanWrite,
        canDelete: () => true,
      },
    })
    const repo2 = new Repo({ network: [new InProcessNetworkAdapter(broker)] })

    // Create a document in repo1
    const handle1 = repo1.create<{ text: string }>()
    await handle1.whenReady()

    // Find the same document in repo2
    const handle2 = repo2.find<{ text: string }>(handle1.documentId)
    await handle2.whenReady()

    // Make a change in repo2
    handle2.change(doc => {
      doc.text = "hello"
    })

    // Wait for the sync message to be processed
    await handle1.once("change")
    expect(handle1.doc().toJSON()).toEqual({ root: { text: "hello" } })

    // Now, deny write permission on repo1
    repo1CanWrite = false

    // Make another change in repo2
    handle2.change(doc => {
      doc.text += " world"
    })

    // This time, handle1 should not receive a "change" event.
    // We'll wait a bit to ensure no message is processed.
    const changePromise = handle1.once("change")
    const timeout = new Promise(resolve => setTimeout(resolve, 100))
    await Promise.race([changePromise, timeout])

    // The document in repo1 should not have changed
    expect(handle1.doc().toJSON()).toEqual({ root: { text: "hello" } })
  })

  it("should not delete a document if the sender is not allowed to delete", async () => {
    const broker = new InProcessNetworkBroker()

    // Create two repos with a shared network
    const repo1 = new Repo({
      network: [new InProcessNetworkAdapter(broker)],
      permissions: {
        canShare: () => true,
        canWrite: () => true,
        canDelete: () => false, // repo1 will not accept delete requests
      },
    })
    const repo2 = new Repo({ network: [new InProcessNetworkAdapter(broker)] })

    // Create a document in repo1
    const handle1 = repo1.create<{ text: string }>()
    await handle1.whenReady()

    // Find the same document in repo2
    const handle2 = repo2.find<{ text: string }>(handle1.documentId)
    await handle2.whenReady()

    // repo2 deletes the document
    repo2.delete(handle1.documentId)

    // This should send a delete-document message to repo1, but it will be ignored.
    // We'll wait a bit to ensure no "delete" event is emitted.
    const deletePromise = handle1.once("state-change").then(
      ({ newState }) =>
        new Promise((resolve, reject) => {
          if (newState === "deleted") {
            resolve(void 0)
          } else {
            reject(
              new Error(
                `Expected state to be 'deleted' but got '${newState}'`,
              ),
            )
          }
        }),
    )

    const timeout = new Promise(resolve => setTimeout(resolve, 100))
    await Promise.race([deletePromise, timeout])

    // The handle in repo1 should still exist and be ready
    expect(repo1.handles.has(handle1.documentId)).toBe(true)
    expect(handle1.state).toBe("ready")
  })
})
