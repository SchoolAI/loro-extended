/**
 * Test for the bug where presence set before channel establishment is lost.
 *
 * Scenario (from real-world logs):
 * 1. Client creates Repo with adapter (adapter starts connecting)
 * 2. Client creates document handle and sets presence immediately
 * 3. At this point, channel is not yet established (0 channels)
 * 4. Channel establishment completes shortly after
 * 5. Server should receive client's presence, but doesn't until heartbeat
 *
 * The bug: When presence is set before the channel is established,
 * the broadcast goes to 0 channels and the presence is never sent to the server.
 * The fix: When channel establishment completes, broadcast ephemeral data.
 */

import { afterEach, describe, expect, it } from "vitest"
import { Bridge, BridgeAdapter } from "../adapter/bridge-adapter.js"
import { Repo } from "../repo.js"

describe("Ephemeral Store - Presence Set Before Connection", () => {
  const repos: Repo[] = []

  afterEach(() => {
    for (const repo of repos) {
      repo.synchronizer.stopHeartbeat()
    }
    repos.length = 0
  })

  it("should propagate presence set immediately after repo creation", async () => {
    // This test simulates the exact scenario from the logs:
    // 1. Repo is created with adapter
    // 2. Presence is set immediately (before channel establishment)
    // 3. Channel establishment happens async

    const bridgeToA = new Bridge()
    const bridgeToB = new Bridge()

    // Server is already running
    const server = new Repo({
      identity: { name: "server", type: "service" },
      adapters: [
        new BridgeAdapter({ bridge: bridgeToA, adapterId: "server-to-a" }),
        new BridgeAdapter({ bridge: bridgeToB, adapterId: "server-to-b" }),
      ],
    })
    repos.push(server)

    // ClientA connects and sets presence (already established)
    const clientA = new Repo({
      identity: { name: "clientA", type: "user" },
      adapters: [
        new BridgeAdapter({ bridge: bridgeToA, adapterId: "clientA-adapter" }),
      ],
    })
    repos.push(clientA)

    const docId = "test-doc"
    const handleA = clientA.get(docId)
    server.get(docId)

    await new Promise(r => setTimeout(r, 100))
    handleA.presence.set({ name: "Alice", status: "online" })
    await new Promise(r => setTimeout(r, 50))

    // Now simulate the problematic scenario:
    // ClientB is created with adapter, but sets presence IMMEDIATELY
    // before the channel has time to establish

    // Create clientB - the adapter will start connecting but channel won't be established yet
    const clientB = new Repo({
      identity: { name: "clientB", type: "user" },
      adapters: [
        new BridgeAdapter({ bridge: bridgeToB, adapterId: "clientB-adapter" }),
      ],
    })
    repos.push(clientB)

    // IMMEDIATELY get handle and set presence
    // This happens before the channel is established (simulating React useEffect)
    const handleB = clientB.get(docId)
    handleB.presence.set({ name: "Bob", status: "online" })

    // Now wait for everything to sync (increased timeout for reliability)
    await new Promise(r => setTimeout(r, 300))

    // Verify server has clientB's presence
    const serverHandle = server.get(docId)
    const serverPresence = serverHandle.presence.all
    const peerIdB = clientB.identity.peerId

    // Server should have clientB's presence (this was the bug)
    expect(serverPresence).toHaveProperty(peerIdB)
    expect(serverPresence[peerIdB]).toMatchObject({
      name: "Bob",
      status: "online",
    })

    // Verify clientA also receives clientB's presence (via server relay)
    const clientAPresence = handleA.presence.all
    expect(clientAPresence).toHaveProperty(peerIdB)
    expect(clientAPresence[peerIdB]).toMatchObject({
      name: "Bob",
      status: "online",
    })
  })

  it("should propagate presence from late joiner to existing clients", async () => {
    const bridgeToA = new Bridge()
    const bridgeToB = new Bridge()

    const server = new Repo({
      identity: { name: "server", type: "service" },
      adapters: [
        new BridgeAdapter({ bridge: bridgeToA, adapterId: "server-to-a" }),
        new BridgeAdapter({ bridge: bridgeToB, adapterId: "server-to-b" }),
      ],
    })
    repos.push(server)

    // ClientA connects first
    const clientA = new Repo({
      identity: { name: "clientA", type: "user" },
      adapters: [
        new BridgeAdapter({ bridge: bridgeToA, adapterId: "clientA-adapter" }),
      ],
    })
    repos.push(clientA)

    const docId = "test-doc-2"
    const handleA = clientA.get(docId)
    server.get(docId)

    await new Promise(r => setTimeout(r, 100))
    handleA.presence.set({ name: "Alice" })
    await new Promise(r => setTimeout(r, 50))

    // ClientB joins and immediately sets presence
    const clientB = new Repo({
      identity: { name: "clientB", type: "user" },
      adapters: [
        new BridgeAdapter({ bridge: bridgeToB, adapterId: "clientB-adapter" }),
      ],
    })
    repos.push(clientB)

    const handleB = clientB.get(docId)
    handleB.presence.set({ name: "Bob" })

    await new Promise(r => setTimeout(r, 300))

    const peerIdA = clientA.identity.peerId
    const peerIdB = clientB.identity.peerId

    // ClientA should see both Alice and Bob
    const clientAPresence = handleA.presence.all
    expect(Object.keys(clientAPresence).length).toBeGreaterThanOrEqual(2)
    expect(clientAPresence).toHaveProperty(peerIdA)
    expect(clientAPresence).toHaveProperty(peerIdB)

    // ClientB should see both Alice and Bob
    const clientBPresence = handleB.presence.all
    expect(Object.keys(clientBPresence).length).toBeGreaterThanOrEqual(2)
    expect(clientBPresence).toHaveProperty(peerIdA)
    expect(clientBPresence).toHaveProperty(peerIdB)
  })

  it("should handle presence set in same tick as repo creation", async () => {
    // This simulates the React pattern where everything happens synchronously:
    // const repo = new Repo({ adapters: [...] })
    // const handle = repo.get(docId)
    // handle.presence.set({ ... }) // All in same tick!

    const bridge = new Bridge()

    const server = new Repo({
      identity: { name: "server", type: "service" },
      adapters: [new BridgeAdapter({ bridge, adapterId: "server-adapter" })],
    })
    repos.push(server)

    // All in one synchronous block - no awaits
    const client = new Repo({
      identity: { name: "client", type: "user" },
      adapters: [new BridgeAdapter({ bridge, adapterId: "client-adapter" })],
    })
    repos.push(client)

    const docId = "test-doc-3"
    const handle = client.get(docId)
    handle.presence.set({ type: "user", lastSeen: Date.now() })

    // Now wait for async operations to complete (increased timeout for reliability)
    await new Promise(r => setTimeout(r, 300))

    // Server should have client's presence
    const serverHandle = server.get(docId)
    const serverPresence = serverHandle.presence.all
    const clientPeerId = client.identity.peerId

    expect(serverPresence).toHaveProperty(clientPeerId)
    expect(serverPresence[clientPeerId]).toHaveProperty("type", "user")
  })
})
