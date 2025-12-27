import { Shape } from "@loro-extended/change"
import { EphemeralStore } from "loro-crdt"
import { afterEach, describe, expect, it } from "vitest"
import { Bridge, BridgeAdapter } from "../adapter/bridge-adapter.js"
import { Repo } from "../repo.js"

/**
 * Investigation tests to identify the root cause of the subscription hang issue.
 *
 * Key finding: The issue is NOT an infinite loop in the traditional sense.
 * The issue is that when we have:
 * 1. store.set() → subscription fires → broadcast
 * 2. BridgeAdapter delivers synchronously
 * 3. Receiving side calls store.apply() → subscription fires (with by='import')
 * 4. But the synchronous call chain blocks the event loop
 *
 * The solution is to make BridgeAdapter delivery asynchronous.
 */

const DocSchema = Shape.doc({
  title: Shape.text(),
})

describe("Subscription Hang Investigation", () => {
  let repo1: Repo
  let repo2: Repo

  afterEach(() => {
    repo1?.synchronizer.stopHeartbeat()
    repo2?.synchronizer.stopHeartbeat()
  })

  describe("Isolating the problem", () => {
    it("Test 1: Basic EphemeralStore subscription without network", async () => {
      // This should NOT hang - no network involved
      const store = new EphemeralStore(10000)
      let callCount = 0

      const unsub = store.subscribe(event => {
        callCount++
        console.log(`Subscription fired: ${event.by}, count: ${callCount}`)
      })

      store.set("key1", { value: 1 })
      store.set("key2", { value: 2 })

      await new Promise(resolve => setTimeout(resolve, 10))

      unsub()
      expect(callCount).toBe(2)
    })

    it("Test 2: Subscription with synchronous callback work", async () => {
      // This should NOT hang - callback does work but no network
      const store = new EphemeralStore(10000)
      let callCount = 0
      const encodedData: Uint8Array[] = []

      const unsub = store.subscribe(event => {
        callCount++
        if (event.by === "local") {
          // Simulate what broadcast does - encode the store
          const data = store.encodeAll()
          encodedData.push(data)
          console.log(`Encoded ${data.length} bytes`)
        }
      })

      store.set("key1", { value: 1 })
      store.set("key2", { value: 2 })

      await new Promise(resolve => setTimeout(resolve, 10))

      unsub()
      expect(callCount).toBe(2)
      expect(encodedData.length).toBe(2)
    })

    it("Test 3: Two stores with manual sync (no subscription)", async () => {
      // This should NOT hang - manual sync without subscription
      const store1 = new EphemeralStore(10000)
      const store2 = new EphemeralStore(10000)

      store1.set("key1", { value: 1 })
      const data = store1.encodeAll()
      store2.apply(data)

      expect(store2.get("key1")).toEqual({ value: 1 })
    })

    it("Test 4: Subscription triggers apply on another store", async () => {
      // This might hang - subscription triggers apply
      const store1 = new EphemeralStore(10000)
      const store2 = new EphemeralStore(10000)
      let callCount = 0

      const unsub = store1.subscribe(event => {
        callCount++
        if (event.by === "local") {
          const data = store1.encodeAll()
          store2.apply(data)
          console.log(
            `Applied to store2, store2 has: ${JSON.stringify(store2.getAllStates())}`,
          )
        }
      })

      store1.set("key1", { value: 1 })

      await new Promise(resolve => setTimeout(resolve, 10))

      unsub()
      expect(callCount).toBe(1)
      expect(store2.get("key1")).toEqual({ value: 1 })
    })

    it("Test 5: Bidirectional subscription (potential infinite loop)", async () => {
      // This MIGHT hang - bidirectional subscriptions
      const store1 = new EphemeralStore(10000)
      const store2 = new EphemeralStore(10000)
      let call1Count = 0
      let call2Count = 0

      const unsub1 = store1.subscribe(event => {
        call1Count++
        console.log(`Store1 subscription: ${event.by}, count: ${call1Count}`)
        if (event.by === "local" && call1Count < 5) {
          const data = store1.encodeAll()
          store2.apply(data)
        }
      })

      const unsub2 = store2.subscribe(event => {
        call2Count++
        console.log(`Store2 subscription: ${event.by}, count: ${call2Count}`)
        // Note: We don't sync back to store1 to avoid infinite loop
      })

      store1.set("key1", { value: 1 })

      await new Promise(resolve => setTimeout(resolve, 50))

      unsub1()
      unsub2()

      console.log(`Final counts: store1=${call1Count}, store2=${call2Count}`)
      expect(call1Count).toBeGreaterThanOrEqual(1)
    })
  })

  describe("BridgeAdapter specific tests", () => {
    it("Test 6: BridgeAdapter send without subscription", async () => {
      // This should NOT hang - just testing BridgeAdapter
      const bridge = new Bridge()

      repo1 = new Repo({
        identity: { name: "peer1", type: "user", peerId: "1" as `${number}` },
        adapters: [new BridgeAdapter({ adapterType: "network-1", bridge })],
      })

      repo2 = new Repo({
        identity: { name: "peer2", type: "user", peerId: "2" as `${number}` },
        adapters: [new BridgeAdapter({ adapterType: "network-2", bridge })],
      })

      // Wait for connection
      await new Promise(resolve => setTimeout(resolve, 100))

      // Get handles (this creates doc state)
      const handle1 = repo1.get("doc-1", DocSchema)
      const _handle2 = repo2.get("doc-1", DocSchema)

      // Modify document - this uses the existing sync mechanism
      handle1.change(draft => {
        draft.title.insert(0, "Hello")
      })

      await new Promise(resolve => setTimeout(resolve, 100))

      expect(handle1.doc.toJSON().title).toBe("Hello")
    })

    it("Test 7: Manual ephemeral broadcast via BridgeAdapter", async () => {
      // Test manual broadcast without subscription
      const bridge = new Bridge()

      repo1 = new Repo({
        identity: { name: "peer1", type: "user", peerId: "1" as `${number}` },
        adapters: [new BridgeAdapter({ adapterType: "network-1", bridge })],
      })

      repo2 = new Repo({
        identity: { name: "peer2", type: "user", peerId: "2" as `${number}` },
        adapters: [new BridgeAdapter({ adapterType: "network-2", bridge })],
      })

      await new Promise(resolve => setTimeout(resolve, 100))

      // Create stores manually
      const store1 = repo1.synchronizer.getOrCreateNamespacedStore(
        "doc-1",
        "test",
      )
      const _store2 = repo2.synchronizer.getOrCreateNamespacedStore(
        "doc-1",
        "test",
      )

      // Ensure doc state exists
      repo1.synchronizer.getOrCreateDocumentState("doc-1")
      repo2.synchronizer.getOrCreateDocumentState("doc-1")

      await new Promise(resolve => setTimeout(resolve, 100))

      // Set value and manually broadcast
      store1.set("key1", { value: 1 })
      repo1.synchronizer.broadcastNamespacedStore("doc-1", "test")

      await new Promise(resolve => setTimeout(resolve, 100))

      // Check if it synced
      const store2 = repo2.synchronizer.getNamespacedStore("doc-1", "test")
      console.log("Store2 state:", store2?.getAllStates())
    })

    it("Test 8: Subscription + BridgeAdapter (the problematic case)", async () => {
      // This is the case that hangs
      const bridge = new Bridge()

      repo1 = new Repo({
        identity: { name: "peer1", type: "user", peerId: "1" as `${number}` },
        adapters: [new BridgeAdapter({ adapterType: "network-1", bridge })],
      })

      repo2 = new Repo({
        identity: { name: "peer2", type: "user", peerId: "2" as `${number}` },
        adapters: [new BridgeAdapter({ adapterType: "network-2", bridge })],
      })

      await new Promise(resolve => setTimeout(resolve, 100))

      // Create stores
      const store1 = repo1.synchronizer.getOrCreateNamespacedStore(
        "doc-1",
        "test",
      )

      // Ensure doc state exists
      repo1.synchronizer.getOrCreateDocumentState("doc-1")
      repo2.synchronizer.getOrCreateDocumentState("doc-1")

      await new Promise(resolve => setTimeout(resolve, 100))

      // Add subscription that broadcasts
      let subCallCount = 0
      const unsub = store1.subscribe(event => {
        subCallCount++
        console.log(`Subscription fired: ${event.by}, count: ${subCallCount}`)

        if (event.by === "local") {
          console.log("About to broadcast...")
          // This is where it might hang
          repo1.synchronizer.broadcastNamespacedStore("doc-1", "test")
          console.log("Broadcast complete")
        }
      })

      console.log("About to set value...")
      store1.set("key1", { value: 1 })
      console.log("Value set")

      await new Promise(resolve => setTimeout(resolve, 100))

      unsub()
      console.log(`Final subscription count: ${subCallCount}`)
    })
  })

  describe("Timing and async behavior", () => {
    it("Test 9: Check if BridgeAdapter.send is synchronous", async () => {
      const bridge = new Bridge()
      const sendTimes: number[] = []
      const receiveTimes: number[] = []

      repo1 = new Repo({
        identity: { name: "peer1", type: "user", peerId: "1" as `${number}` },
        adapters: [new BridgeAdapter({ adapterType: "network-1", bridge })],
      })

      repo2 = new Repo({
        identity: { name: "peer2", type: "user", peerId: "2" as `${number}` },
        adapters: [new BridgeAdapter({ adapterType: "network-2", bridge })],
      })

      await new Promise(resolve => setTimeout(resolve, 100))

      // Spy on the synchronizer's channelReceive
      const originalReceive = repo2.synchronizer.channelReceive.bind(
        repo2.synchronizer,
      )
      repo2.synchronizer.channelReceive = (channelId, message) => {
        receiveTimes.push(Date.now())
        console.log(`Received at ${receiveTimes[receiveTimes.length - 1]}`)
        return originalReceive(channelId, message)
      }

      // Ensure doc state exists
      repo1.synchronizer.getOrCreateDocumentState("doc-1")
      repo2.synchronizer.getOrCreateDocumentState("doc-1")

      await new Promise(resolve => setTimeout(resolve, 100))

      // Send a message using the new namespaced store API
      console.log(`Sending at ${Date.now()}`)
      sendTimes.push(Date.now())

      // Use the new namespaced store API
      const store = repo1.synchronizer.getOrCreateNamespacedStore(
        "doc-1",
        "test",
      )
      store.set("key", { test: "value" })
      repo1.synchronizer.broadcastNamespacedStore("doc-1", "test")

      console.log(`After send at ${Date.now()}`)
      sendTimes.push(Date.now())

      await new Promise(resolve => setTimeout(resolve, 100))

      console.log("Send times:", sendTimes)
      console.log("Receive times:", receiveTimes)

      // If receive happens between the two send times, it's synchronous
      if (receiveTimes.length > 0) {
        const isSynchronous = receiveTimes[0] <= sendTimes[1]
        console.log(
          `BridgeAdapter appears to be ${isSynchronous ? "SYNCHRONOUS" : "ASYNCHRONOUS"}`,
        )
      }
    })
  })

  describe("Root cause analysis", () => {
    it("Test 10: Check if store.apply triggers subscription", async () => {
      const store = new EphemeralStore(10000)
      const events: string[] = []

      const unsub = store.subscribe(event => {
        events.push(`${event.by}`)
      })

      // Local set
      store.set("key1", { value: 1 })

      // Encode and apply (simulating network receive)
      const data = store.encodeAll()

      // Create another store and apply
      const store2 = new EphemeralStore(10000)
      const events2: string[] = []
      const unsub2 = store2.subscribe(event => {
        events2.push(`${event.by}`)
      })

      store2.apply(data)

      await new Promise(resolve => setTimeout(resolve, 10))

      unsub()
      unsub2()

      console.log("Store1 events:", events)
      console.log("Store2 events:", events2)

      // Store1 should have 'local' event
      expect(events).toContain("local")
      // Store2 should have 'import' event (not 'local')
      expect(events2).toContain("import")
      expect(events2).not.toContain("local")
    })

    it("Test 11: Minimal reproduction with recursion guard", async () => {
      // This test reproduces the hang with minimal code but with a recursion guard
      const bridge = new Bridge()

      repo1 = new Repo({
        identity: { name: "peer1", type: "user", peerId: "1" as `${number}` },
        adapters: [new BridgeAdapter({ adapterType: "network-1", bridge })],
      })

      repo2 = new Repo({
        identity: { name: "peer2", type: "user", peerId: "2" as `${number}` },
        adapters: [new BridgeAdapter({ adapterType: "network-2", bridge })],
      })

      await new Promise(resolve => setTimeout(resolve, 100))

      // Create stores and doc state
      const store1 = repo1.synchronizer.getOrCreateNamespacedStore(
        "doc-1",
        "test",
      )
      repo1.synchronizer.getOrCreateDocumentState("doc-1")
      repo2.synchronizer.getOrCreateDocumentState("doc-1")

      await new Promise(resolve => setTimeout(resolve, 100))

      // Track call depth to detect recursion
      let isBroadcasting = false
      let callCount = 0
      const MAX_CALLS = 10 // Safety limit

      // Add subscription that broadcasts - but with recursion protection
      const unsub = store1.subscribe(event => {
        callCount++
        console.log(
          `Subscription fired: ${event.by}, count: ${callCount}, isBroadcasting: ${isBroadcasting}`,
        )

        if (callCount > MAX_CALLS) {
          console.log("MAX_CALLS exceeded, stopping")
          return
        }

        if (event.by === "local" && !isBroadcasting) {
          isBroadcasting = true
          console.log("Broadcasting...")
          repo1.synchronizer.broadcastNamespacedStore("doc-1", "test")
          console.log("Broadcast complete")
          isBroadcasting = false
        }
      })

      console.log("Setting value...")
      store1.set("key1", { value: 1 })
      console.log("Value set")

      await new Promise(resolve => setTimeout(resolve, 100))

      unsub()
      console.log(`Total call count: ${callCount}`)

      // Should only fire once for the local set
      expect(callCount).toBeLessThanOrEqual(MAX_CALLS)
    })

    it("Test 12: Check what triggers the loop", async () => {
      // Simpler test to understand the loop
      const bridge = new Bridge()

      repo1 = new Repo({
        identity: { name: "peer1", type: "user", peerId: "1" as `${number}` },
        adapters: [new BridgeAdapter({ adapterType: "network-1", bridge })],
      })

      repo2 = new Repo({
        identity: { name: "peer2", type: "user", peerId: "2" as `${number}` },
        adapters: [new BridgeAdapter({ adapterType: "network-2", bridge })],
      })

      await new Promise(resolve => setTimeout(resolve, 100))

      // Create doc state only (no stores yet)
      repo1.synchronizer.getOrCreateDocumentState("doc-1")
      repo2.synchronizer.getOrCreateDocumentState("doc-1")

      await new Promise(resolve => setTimeout(resolve, 100))

      // Now create store and set value WITHOUT subscription
      const store1 = repo1.synchronizer.getOrCreateNamespacedStore(
        "doc-1",
        "test",
      )
      store1.set("key1", { value: 1 })

      // Manually broadcast
      console.log("Broadcasting manually...")
      repo1.synchronizer.broadcastNamespacedStore("doc-1", "test")
      console.log("Broadcast done")

      await new Promise(resolve => setTimeout(resolve, 100))

      // Check if repo2 received it
      const store2 = repo2.synchronizer.getNamespacedStore("doc-1", "test")
      console.log("Store2 state:", store2?.getAllStates())

      expect(store2?.get("key1")).toEqual({ value: 1 })
    })
  })
})
