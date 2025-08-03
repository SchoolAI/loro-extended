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
    await handle1.whenReady()
    handle1.change(doc => {
      doc.text = "hello"
    })
    expect(handle1.doc().toJSON()).toEqual({ root: { text: "hello" } })

    // Find the same document in repo2
    // This should trigger a request-sync/sync flow
    const handle2 = repo2.find<{ text: string }>(handle1.documentId)
    await handle2.whenReady()

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
})
