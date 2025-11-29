import { describe, expect, it, vi } from "vitest"
import { Bridge, BridgeAdapter } from "./adapter/bridge-adapter.js"
import { Repo } from "./repo.js"
import { InMemoryStorageAdapter } from "./storage/in-memory-storage-adapter.js"

describe("Ephemeral Store Integration", () => {
  it("should allow setting and getting local ephemeral state", () => {
    const repo = new Repo({
      identity: { name: "repo1", type: "user" },
      adapters: [new InMemoryStorageAdapter()],
    })
    const handle = repo.get("test-doc")

    // Set local state
    handle.untypedPresence.set({ cursor: { x: 10, y: 20 } })

    // Get local state
    expect(handle.untypedPresence.get("cursor")).toEqual({ x: 10, y: 20 })
    expect(handle.untypedPresence.self).toEqual({ cursor: { x: 10, y: 20 } })
  })

  it("should sync ephemeral state between peers", async () => {
    const bridge = new Bridge()

    const repo1 = new Repo({
      adapters: [
        new BridgeAdapter({
          bridge,
          adapterId: "bridge-adapter-repo1",
        }),
      ],
      identity: { name: "repo1", type: "user" },
    })

    const repo2 = new Repo({
      adapters: [
        new BridgeAdapter({
          bridge,
          adapterId: "bridge-adapter-repo2",
        }),
      ],
      identity: { name: "repo2", type: "user" },
    })

    const docId = "ephemeral-sync-doc"
    const handle1 = repo1.get(docId)
    const handle2 = repo2.get(docId)

    // Wait for connection
    await new Promise(resolve => setTimeout(resolve, 100))

    // Subscribe to changes on repo2
    const onChange = vi.fn()
    handle2.untypedPresence.subscribe(onChange)

    // Set state on repo1
    handle1.untypedPresence.set({ selection: "start" })

    // Wait for sync
    await new Promise(resolve => setTimeout(resolve, 100))

    // Verify repo2 received the update
    expect(onChange).toHaveBeenCalled()

    // Check repo2's view of repo1's state
    // We need repo1's peerId
    const peerId1 = repo1.identity.peerId
    const peerState = handle2.untypedPresence.all[peerId1]
    expect(peerState).toEqual({ selection: "start" })
  })

  it("should support the escape hatch setRaw", async () => {
    const repo = new Repo({
      identity: { name: "repo1", type: "user" },
      adapters: [new InMemoryStorageAdapter()],
    })
    const handle = repo.get("test-doc")

    handle.untypedPresence.setRaw("global-key", "global-value")

    expect(handle.untypedPresence.all["global-key"]).toBe("global-value")
  })

  it("should sync ephemeral state on initial sync", async () => {
    const bridge = new Bridge()

    const repo1 = new Repo({
      adapters: [
        new BridgeAdapter({
          bridge,
          adapterId: "bridge-adapter-repo1",
        }),
      ],
      identity: { name: "repo1", type: "user" },
    })

    const docId = "initial-sync-doc"
    const handle1 = repo1.get(docId)
    handle1.untypedPresence.set({ status: "online" })

    // Create repo2 AFTER repo1 has set state
    const repo2 = new Repo({
      adapters: [
        new BridgeAdapter({
          bridge,
          adapterId: "bridge-adapter-repo2",
        }),
      ],
      identity: { name: "repo2", type: "user" },
    })

    const handle2 = repo2.get(docId)

    // Wait for sync
    await new Promise(resolve => setTimeout(resolve, 200))

    const peerId1 = repo1.identity.peerId
    const peerState = handle2.untypedPresence.all[peerId1]
    expect(peerState).toEqual({ status: "online" })
  })

  it("should remove ephemeral state when peer disconnects", async () => {
    const bridge = new Bridge()

    const repo1 = new Repo({
      adapters: [
        new BridgeAdapter({
          bridge,
          adapterId: "bridge-adapter-repo1",
        }),
      ],
      identity: { name: "repo1", type: "user" },
    })

    const repo2 = new Repo({
      adapters: [
        new BridgeAdapter({
          bridge,
          adapterId: "bridge-adapter-repo2",
        }),
      ],
      identity: { name: "repo2", type: "user" },
    })

    const docId = "disconnect-sync-doc"
    const handle1 = repo1.get(docId)
    const handle2 = repo2.get(docId)

    // Wait for connection
    await new Promise(resolve => setTimeout(resolve, 100))

    // Set state on repo1
    handle1.untypedPresence.set({ status: "online" })

    // Wait for sync
    await new Promise(resolve => setTimeout(resolve, 100))

    // Verify repo2 has repo1's state
    const peerId1 = repo1.identity.peerId
    expect(handle2.untypedPresence.all[peerId1]).toEqual({ status: "online" })

    // Disconnect repo1
    // We can simulate this by stopping the adapter
    repo1.synchronizer.adapters.adapters[0]._stop()

    // Wait for disconnect processing
    await new Promise(resolve => setTimeout(resolve, 100))

    // Verify repo2 has REMOVED repo1's state
    // It should be undefined or empty
    expect(handle2.untypedPresence.all[peerId1]).toBeUndefined()
  })
})
