import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  InProcessBridge,
  InProcessNetworkAdapter,
} from "./network/in-process-network-adapter.js"
import { Repo } from "./repo.js"
import { InMemoryStorageAdapter } from "./storage/in-memory-storage-adapter.js"

describe("Storage-Network Synchronization", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("should respond to network requests for documents in storage but not in memory", async () => {
    // This test simulates a server restart scenario:
    // 1. Server creates a document and saves it to storage
    // 2. Server shuts down (disconnects)
    // 3. New server starts with storage that has the document data
    // 4. Client requests the document from the new server
    // 5. Server should check storage and respond with the document

    const bridge = new InProcessBridge()

    // Step 1: Create server repo with storage and create a document
    const serverStorage = new InMemoryStorageAdapter()
    const server1Adapter = new InProcessNetworkAdapter(bridge)
    const server1 = new Repo({
      peerId: "server1",
      network: [server1Adapter],
      storage: serverStorage,
    })

    const documentId = "test-doc-1"
    const handle1 = await server1.create({ documentId })

    // Add some content to the document
    handle1.change(doc => {
      const root = doc.getMap("root")
      root.set("title", "Important Document")
      root.set("content", "This document exists in storage")
      root.set("version", 1)
    })

    // Wait for storage operations to complete
    await vi.runAllTimersAsync()

    // Verify the document was saved to storage
    const savedData = await serverStorage.loadRange([documentId])
    expect(savedData.length).toBeGreaterThan(0)

    // Step 2: Simulate server shutdown by stopping the network
    // This simulates the server going offline
    server1.networks.stopAll()

    // Create the new server instance
    const server2Adapter = new InProcessNetworkAdapter(bridge)
    const server2 = new Repo({
      peerId: "server2",
      network: [server2Adapter],
      storage: serverStorage,
    })

    // At this point, server2 has the document in its storage
    // but has NOT loaded it into memory (handles map is empty)
    expect(server2.handles.has(documentId)).toBe(false)

    // Step 4: Create client repo that will request the document
    const clientAdapter = new InProcessNetworkAdapter(bridge)
    const client = new Repo({
      peerId: "client",
      network: [clientAdapter],
      // Client has no storage, must get document from network
    })

    // The network adapters are already started by the Repo constructor
    // No need to start them manually

    // Wait for network connections to establish
    await vi.runAllTimersAsync()

    // Step 5: Client requests the document from the network
    // EXPECTED: server2 should check its storage and respond with the document
    // CURRENT STATUS: This currently times out and fails

    try {
      // Client requests the document from the network
      const clientHandle = await client.findAndWait(documentId, {
        waitForNetwork: true,
        timeout: 2000,
      })

      // If we get here, the test passes (after implementing the fix)
      const docClient = clientHandle.doc
      const rootClient = docClient.getMap("root")
      expect(rootClient.get("title")).toBe("Important Document")
      expect(rootClient.get("content")).toBe("This document exists in storage")
      expect(rootClient.get("version")).toBe(1)

      // Verify that server2 now has the document in memory
      // (it should have loaded it from storage when client requested it)
      const server2Handle = server2.handles.get(documentId)
      expect(server2Handle).toBeDefined()
      expect(server2Handle?.doc).toBeDefined()
    } catch (error) {
      // This is what currently happens - the find times out
      // because server2 doesn't check its storage
      throw new Error(
        "Client failed to get document from server. " +
          "Server should have checked storage when receiving the request. " +
          `Error: ${error}`,
      )
    }
  })
})
