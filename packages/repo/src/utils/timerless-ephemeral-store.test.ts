import { EphemeralStore } from "loro-crdt"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TimerlessEphemeralStore } from "./timerless-ephemeral-store.js"

describe("TimerlessEphemeralStore", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("should set and get values", () => {
    const store = new TimerlessEphemeralStore()

    store.set("cursor", { x: 10, y: 20 })
    store.set("name", "Alice")

    expect(store.get("cursor")).toEqual({ x: 10, y: 20 })
    expect(store.get("name")).toBe("Alice")
  })

  it("should return all states via getAllStates", () => {
    const store = new TimerlessEphemeralStore()

    store.set("cursor", { x: 10, y: 20 })
    store.set("name", "Alice")
    store.set("status", "online")

    const allStates = store.getAllStates()
    expect(allStates).toEqual({
      cursor: { x: 10, y: 20 },
      name: "Alice",
      status: "online",
    })
  })

  it("should encode and decode data correctly", () => {
    const store1 = new TimerlessEphemeralStore()
    store1.set("cursor", { x: 100, y: 200 })
    store1.set("name", "Bob")

    const encoded = store1.encodeAll()
    expect(encoded.length).toBeGreaterThan(0)

    const store2 = new TimerlessEphemeralStore()
    store2.apply(encoded)

    expect(store2.get("cursor")).toEqual({ x: 100, y: 200 })
    expect(store2.get("name")).toBe("Bob")
  })

  it("should NOT expire data after timeout (unlike regular EphemeralStore)", async () => {
    // Use real timers for this test since we need actual timeout behavior
    vi.useRealTimers()

    const timerlessStore = new TimerlessEphemeralStore()
    timerlessStore.set("key", "value")

    // Create a regular EphemeralStore with a very short timeout for comparison
    const regularStore = new EphemeralStore(50) // 50ms timeout
    regularStore.set("key", "value")

    // Wait for the regular store's timeout to expire
    await new Promise(resolve => setTimeout(resolve, 150))

    // Regular store should have expired the data
    expect(regularStore.get("key")).toBeUndefined()

    // Timerless store should still have the data
    expect(timerlessStore.get("key")).toBe("value")
  })

  it("should handle multiple set calls without expiring previous values", () => {
    const store = new TimerlessEphemeralStore()

    store.set("a", 1)
    store.set("b", 2)
    store.set("c", 3)

    // Advance time significantly
    vi.advanceTimersByTime(100000) // 100 seconds

    // All values should still be present
    expect(store.get("a")).toBe(1)
    expect(store.get("b")).toBe(2)
    expect(store.get("c")).toBe(3)
  })

  it("should handle apply without expiring data", () => {
    const sourceStore = new TimerlessEphemeralStore()
    sourceStore.set("data", { nested: { value: 42 } })

    const encoded = sourceStore.encodeAll()

    const targetStore = new TimerlessEphemeralStore()
    targetStore.apply(encoded)

    // Advance time significantly
    vi.advanceTimersByTime(100000) // 100 seconds

    // Data should still be present
    expect(targetStore.get("data")).toEqual({ nested: { value: 42 } })
  })

  it("should allow overwriting values", () => {
    const store = new TimerlessEphemeralStore()

    store.set("cursor", { x: 10, y: 20 })
    expect(store.get("cursor")).toEqual({ x: 10, y: 20 })

    store.set("cursor", { x: 50, y: 60 })
    expect(store.get("cursor")).toEqual({ x: 50, y: 60 })
  })

  it("should handle delete operation", () => {
    const store = new TimerlessEphemeralStore()

    store.set("key", "value")
    expect(store.get("key")).toBe("value")

    store.delete("key")
    expect(store.get("key")).toBeUndefined()
  })

  it("should work with various value types", () => {
    const store = new TimerlessEphemeralStore()

    // String
    store.set("string", "hello")
    expect(store.get("string")).toBe("hello")

    // Number
    store.set("number", 42)
    expect(store.get("number")).toBe(42)

    // Boolean
    store.set("boolean", true)
    expect(store.get("boolean")).toBe(true)

    // Array
    store.set("array", [1, 2, 3])
    expect(store.get("array")).toEqual([1, 2, 3])

    // Object
    store.set("object", { a: 1, b: "two" })
    expect(store.get("object")).toEqual({ a: 1, b: "two" })

    // Null
    store.set("null", null)
    expect(store.get("null")).toBeNull()
  })

  it("should encode specific keys", () => {
    const store = new TimerlessEphemeralStore()

    store.set("key1", "value1")
    store.set("key2", "value2")

    // Encode only key1
    const encoded = store.encode("key1")
    expect(encoded.length).toBeGreaterThan(0)

    const targetStore = new TimerlessEphemeralStore()
    targetStore.apply(encoded)

    // Only key1 should be present
    expect(targetStore.get("key1")).toBe("value1")
    expect(targetStore.get("key2")).toBeUndefined()
  })

  describe("heartbeat simulation (client -> server)", () => {
    it("using touch() before encoding keeps server data alive", async () => {
      // Use real timers for this test
      vi.useRealTimers()

      const TIMEOUT = 100 // 100ms timeout for fast testing

      // Client's store (never expires)
      const clientStore = new TimerlessEphemeralStore()
      clientStore.set("key", "value")

      // Server's store for this client (expires after TIMEOUT)
      const serverStore = new EphemeralStore(TIMEOUT)

      // Initial sync - client sends data to server
      const initialData = clientStore.encodeAll()
      console.log("Initial data length:", initialData.length)
      serverStore.apply(initialData)
      console.log(
        "Server state after initial apply:",
        serverStore.getAllStates(),
      )

      // Simulate heartbeats every 50ms for 300ms (3x the timeout)
      for (let i = 0; i < 6; i++) {
        await new Promise(r => setTimeout(r, 50))

        // Touch to update timestamps before encoding (this is what the synchronizer does)
        clientStore.touch()

        // Client encodes data with fresh timestamps
        const heartbeatData = clientStore.encodeAll()
        console.log(`Heartbeat ${i}: encoded ${heartbeatData.length} bytes`)

        // Server applies the heartbeat
        serverStore.apply(heartbeatData)
        console.log(
          `Server state after heartbeat ${i}:`,
          serverStore.getAllStates(),
        )
      }

      // Data should still exist on server
      const finalState = serverStore.getAllStates()
      console.log("Final server state:", finalState)

      expect(finalState).toEqual({ key: "value" })
    })

    it("without touch(), server data expires even with heartbeats", async () => {
      // Use real timers for this test
      vi.useRealTimers()

      const TIMEOUT = 100 // 100ms timeout for fast testing

      // Client's store (never expires)
      const clientStore = new TimerlessEphemeralStore()
      clientStore.set("key", "value")

      // Server's store for this client (expires after TIMEOUT)
      const serverStore = new EphemeralStore(TIMEOUT)

      // Initial sync - client sends data to server
      const initialData = clientStore.encodeAll()
      serverStore.apply(initialData)

      // Simulate heartbeats every 50ms for 300ms (3x the timeout)
      // WITHOUT calling touch() - this demonstrates the bug we fixed
      for (let i = 0; i < 6; i++) {
        await new Promise(r => setTimeout(r, 50))

        // Encode WITHOUT touching - stale timestamps!
        const heartbeatData = clientStore.encodeAll()
        serverStore.apply(heartbeatData)
      }

      // Data should be expired because timestamps were stale
      const finalState = serverStore.getAllStates()
      console.log("Final server state (no touch):", finalState)

      expect(finalState).toEqual({})
    })

    it("without heartbeats, server data expires", async () => {
      // Use real timers for this test
      vi.useRealTimers()

      const TIMEOUT = 100 // 100ms timeout for fast testing

      // Client's store (never expires)
      const clientStore = new TimerlessEphemeralStore()
      clientStore.set("key", "value")

      // Server's store for this client (expires after TIMEOUT)
      const serverStore = new EphemeralStore(TIMEOUT)

      // Initial sync - client sends data to server
      const initialData = clientStore.encodeAll()
      serverStore.apply(initialData)
      console.log(
        "Server state after initial apply:",
        serverStore.getAllStates(),
      )

      // Wait for timeout + generous buffer (no heartbeats)
      // The timer runs asynchronously, so we need to wait a bit longer
      await new Promise(r => setTimeout(r, 200))

      // Data should be expired
      const finalState = serverStore.getAllStates()
      console.log("Final server state (no heartbeats):", finalState)

      expect(finalState).toEqual({})
    })
  })
})
