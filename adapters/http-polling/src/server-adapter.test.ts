import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  HttpPollingConnection,
  HttpPollingServerNetworkAdapter,
} from "./server-adapter.js"

describe("HttpPollingConnection", () => {
  it("should create a connection with peerId and channelId", () => {
    const connection = new HttpPollingConnection("1001", 1)
    expect(connection.peerId).toBe("1001")
    expect(connection.channelId).toBe(1)
  })

  it("should enqueue and drain messages", () => {
    const connection = new HttpPollingConnection("1001", 1)

    const msg1 = { type: "channel/directory-request" as const }
    const msg2 = { type: "channel/directory-response" as const, docIds: [] }

    connection.enqueue(msg1)
    connection.enqueue(msg2)

    expect(connection.queueLength).toBe(2)

    const messages = connection.drain()
    expect(messages).toHaveLength(2)
    expect(messages[0]).toBe(msg1)
    expect(messages[1]).toBe(msg2)
    expect(connection.queueLength).toBe(0)
  })

  it("should update lastActivity on drain", () => {
    const connection = new HttpPollingConnection("1001", 1)
    const initialActivity = connection.lastActivity

    // Wait a bit
    vi.useFakeTimers()
    vi.advanceTimersByTime(100)

    connection.drain()
    expect(connection.lastActivity).toBeGreaterThan(initialActivity)

    vi.useRealTimers()
  })

  it("should return immediately from waitForMessages if messages are queued", async () => {
    const connection = new HttpPollingConnection("1001", 1)
    const msg = { type: "channel/directory-request" as const }
    connection.enqueue(msg)

    const messages = await connection.waitForMessages(5000)
    expect(messages).toHaveLength(1)
    expect(messages[0]).toBe(msg)
  })

  it("should return immediately from waitForMessages if timeout is 0", async () => {
    const connection = new HttpPollingConnection("1001", 1)

    const messages = await connection.waitForMessages(0)
    expect(messages).toHaveLength(0)
  })

  it("should wait for messages and resolve when message arrives", async () => {
    const connection = new HttpPollingConnection("1001", 1)

    // Start waiting
    const waitPromise = connection.waitForMessages(5000)

    // Enqueue a message after a short delay
    const msg = { type: "channel/directory-request" as const }
    setTimeout(() => connection.enqueue(msg), 10)

    const messages = await waitPromise
    expect(messages).toHaveLength(1)
    expect(messages[0]).toBe(msg)
  })

  it("should timeout and return empty array if no messages arrive", async () => {
    vi.useFakeTimers()

    const connection = new HttpPollingConnection("1001", 1)
    const waitPromise = connection.waitForMessages(100)

    // Advance time past the timeout
    vi.advanceTimersByTime(150)

    const messages = await waitPromise
    expect(messages).toHaveLength(0)

    vi.useRealTimers()
  })

  it("should cancel wait and return queued messages", async () => {
    vi.useFakeTimers()

    const connection = new HttpPollingConnection("1001", 1)
    const msg = { type: "channel/directory-request" as const }
    connection.enqueue(msg)

    const waitPromise = connection.waitForMessages(5000)

    // Cancel immediately (messages already queued, so should resolve)
    connection.cancelWait()

    const messages = await waitPromise
    expect(messages).toHaveLength(1)

    vi.useRealTimers()
  })

  it("should report isWaiting correctly", async () => {
    const connection = new HttpPollingConnection("1001", 1)

    expect(connection.isWaiting).toBe(false)

    // Start waiting (don't await yet)
    const waitPromise = connection.waitForMessages(5000)
    expect(connection.isWaiting).toBe(true)

    // Enqueue to resolve
    connection.enqueue({ type: "channel/directory-request" as const })
    await waitPromise

    expect(connection.isWaiting).toBe(false)
  })
})

describe("HttpPollingServerNetworkAdapter", () => {
  let adapter: HttpPollingServerNetworkAdapter

  beforeEach(() => {
    adapter = new HttpPollingServerNetworkAdapter()
  })

  afterEach(async () => {
    // Adapter may not be started, so we need to handle that
    try {
      await adapter._stop()
    } catch {
      // Ignore errors from stopping unstarted adapter
    }
  })

  it("should have correct adapterType", () => {
    expect(adapter.adapterType).toBe("http-polling-server")
  })

  it("should have default connection timeout", () => {
    expect(adapter.connectionTimeout).toBe(120000)
  })

  it("should accept custom connection timeout", () => {
    const customAdapter = new HttpPollingServerNetworkAdapter({
      connectionTimeout: 60000,
    })
    expect(customAdapter.connectionTimeout).toBe(60000)
  })

  it("should report isConnected correctly", async () => {
    // Initialize and start the adapter with mock hooks
    adapter._initialize({
      identity: { peerId: "9999", name: "test-server", type: "service" },
      onChannelReceive: vi.fn(),
      onChannelAdded: vi.fn(),
      onChannelRemoved: vi.fn(),
      onChannelEstablish: vi.fn(),
    })
    await adapter._start()

    expect(adapter.isConnected("1001")).toBe(false)

    adapter.registerConnection("1001")
    expect(adapter.isConnected("1001")).toBe(true)

    adapter.unregisterConnection("1001")
    expect(adapter.isConnected("1001")).toBe(false)
  })

  it("should return existing connection on re-register", async () => {
    adapter._initialize({
      identity: { peerId: "9999", name: "test-server", type: "service" },
      onChannelReceive: vi.fn(),
      onChannelAdded: vi.fn(),
      onChannelRemoved: vi.fn(),
      onChannelEstablish: vi.fn(),
    })
    await adapter._start()

    const conn1 = adapter.registerConnection("1001")
    const conn2 = adapter.registerConnection("1001")

    expect(conn1).toBe(conn2)
  })

  it("should get all connections", async () => {
    adapter._initialize({
      identity: { peerId: "9999", name: "test-server", type: "service" },
      onChannelReceive: vi.fn(),
      onChannelAdded: vi.fn(),
      onChannelRemoved: vi.fn(),
      onChannelEstablish: vi.fn(),
    })
    await adapter._start()

    adapter.registerConnection("1001")
    adapter.registerConnection("1002")

    const connections = adapter.getAllConnections()
    expect(connections).toHaveLength(2)
  })
})
