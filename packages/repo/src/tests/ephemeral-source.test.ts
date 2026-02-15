import { Shape } from "@loro-extended/change"
import { describe, expect, it } from "vitest"
import { Bridge, BridgeAdapter } from "../adapter/bridge-adapter.js"
import { Repo } from "../repo.js"
import { sync } from "../sync.js"

/**
 * Tests for ephemeral event source tracking.
 *
 * These tests verify that the `source` field in ephemeral-change events
 * correctly distinguishes between local and remote changes. This is critical
 * for preventing infinite loops when bridging two reactive systems.
 */

// Schema for test documents
const DocSchema = Shape.doc({
  title: Shape.text(),
})

// Schema for presence
const PresenceSchema = Shape.plain.struct({
  cursor: Shape.plain.string(),
})

describe("Ephemeral Event Source", () => {
  /**
   * Helper to create a connected client-server pair
   */
  function createConnectedPair() {
    const bridge = new Bridge()

    const server = new Repo({
      identity: { name: "server", type: "service", peerId: "1" as `${number}` },
      adapters: [new BridgeAdapter({ bridge, adapterType: "server-adapter" })],
    })

    const client = new Repo({
      identity: { name: "client", type: "user", peerId: "2" as `${number}` },
      adapters: [new BridgeAdapter({ bridge, adapterType: "client-adapter" })],
    })

    return { server, client, bridge }
  }

  describe("Local changes emit source: 'local'", () => {
    it("should emit source: 'local' when setSelf is called", async () => {
      const { client } = createConnectedPair()
      const docId = "test-doc"
      const doc = client.get(docId, DocSchema, {
        presence: PresenceSchema,
      })

      const events: Array<{ source: string }> = []

      // Subscribe to presence changes
      sync(doc).presence.subscribe(event => {
        events.push({ source: event.source })
      })

      // Trigger a local change via presence.setSelf()
      sync(doc).presence.setSelf({ cursor: "test-value" })

      // Wait for event processing
      await new Promise(resolve => setTimeout(resolve, 50))

      // Should have initial + local
      expect(events.length).toBeGreaterThan(0)
      // The last event should be local
      const localEvents = events.filter(e => e.source === "local")
      expect(localEvents.length).toBeGreaterThan(0)
    })
  })

  describe("Remote changes emit source: 'remote'", () => {
    it("should emit source: 'remote' when receiving ephemeral data from peer", async () => {
      const { server, client } = createConnectedPair()
      const docId = "test-doc"

      // Both need to get docs to establish subscription
      const serverDoc = server.get(docId, DocSchema, {
        presence: PresenceSchema,
      })
      const clientDoc = client.get(docId, DocSchema, {
        presence: PresenceSchema,
      })

      // Wait for connection to establish
      await new Promise(resolve => setTimeout(resolve, 100))

      const clientEvents: Array<{ source: string; key: string }> = []

      // Subscribe to client's presence changes
      sync(clientDoc).presence.subscribe(event => {
        clientEvents.push({ source: event.source, key: event.key })
      })

      // Server sets presence (this should propagate to client as "remote")
      sync(serverDoc).presence.setSelf({ cursor: "server-cursor" })

      // Wait for propagation
      await new Promise(resolve => setTimeout(resolve, 200))

      // Client should have received a remote event
      const remoteEvents = clientEvents.filter(e => e.source === "remote")
      expect(remoteEvents.length).toBeGreaterThan(0)
      expect(remoteEvents[0].key).toBe("1") // Server's peerId
    })
  })

  describe("Initial subscription gets source: 'initial'", () => {
    it("should pass source: 'initial' on first subscribe callback", async () => {
      const { client } = createConnectedPair()
      const docId = "test-doc"
      const doc = client.get(docId, DocSchema, {
        presence: PresenceSchema,
      })

      // Set some presence first
      sync(doc).presence.setSelf({ cursor: "initial-cursor" })

      const sources: string[] = []

      // Subscribe to presence - first callback should be "initial"
      sync(doc).presence.subscribe(event => {
        sources.push(event.source)
      })

      // Initial call should have happened for the existing presence
      expect(sources.length).toBeGreaterThan(0)
      expect(sources[0]).toBe("initial")
    })
  })

  describe("No infinite loop when bridging reactive systems", () => {
    it("should not create infinite loop when filtering by source", async () => {
      const { server, client } = createConnectedPair()
      const docId = "test-doc"

      const serverDoc = server.get(docId, DocSchema, {
        presence: PresenceSchema,
      })
      const clientDoc = client.get(docId, DocSchema, {
        presence: PresenceSchema,
      })

      // Wait for connection
      await new Promise(resolve => setTimeout(resolve, 100))

      let callCount = 0
      const maxCalls = 50 // If we hit this, we're likely looping

      // Simulate the bridge pattern on client side
      sync(clientDoc).presence.subscribe(event => {
        callCount++

        if (callCount > maxCalls) {
          throw new Error(
            `Infinite loop detected! Call count: ${callCount}. ` +
              `This indicates the source filtering is not working correctly.`,
          )
        }

        // KEY: Only react to remote/initial changes (like the prosemirror bridge does)
        if (event.source === "local") return

        // This simulates what the bridge does: when receiving remote data,
        // it updates local state, which triggers another event.
        // Without source filtering, this would loop infinitely.
        sync(clientDoc).presence.setSelf({ cursor: `updated-${callCount}` })
      })

      // Server sends presence update (triggers remote event on client)
      sync(serverDoc).presence.setSelf({ cursor: "initial" })

      // Wait for propagation and any potential loops
      await new Promise(resolve => setTimeout(resolve, 300))

      // Should have:
      // 1. Initial call (source: "initial") -> triggers set -> local event (filtered)
      // 2. Remote event from server -> triggers set -> local event (filtered)
      // Without filtering, each set would trigger another callback infinitely
      expect(callCount).toBeLessThan(10)
    })

    it("demonstrates that source filtering prevents the loop", async () => {
      const { client } = createConnectedPair()
      const docId = "test-doc"
      const doc = client.get(docId, DocSchema, {
        presence: PresenceSchema,
      })

      const sources: string[] = []

      // Subscribe first
      sync(doc).presence.subscribe(event => {
        sources.push(event.source)
      })

      // Now trigger a local change
      sync(doc).presence.setSelf({ cursor: "test" })

      // Wait for event processing
      await new Promise(resolve => setTimeout(resolve, 50))

      // Should have local event
      expect(sources).toContain("local")
    })
  })
})
