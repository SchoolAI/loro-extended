# SSE Client Reconnection Improvements - TDD Plan

## Overview

This document outlines a Test-Driven Development (TDD) plan for improving the robustness of the SSE adapter. It addresses client-side reconnection logic and a critical server-side resource leak.

## Current Behavior (Problems)

### Problem 1: Server-Side Channel Leak
In `adapters/sse/src/server-adapter.ts`, `registerConnection` overwrites the existing connection in the map without cleaning up the old one. This leaves "zombie" channels registered in the `Adapter` that are no longer accessible via `this.connections`.

### Problem 2: Channel Removed on Every Error (Client)
In `adapters/sse/src/client.ts`, the channel is removed on every `onerror` event. This breaks sync state during transient failures because `ReconnectingEventSource` will automatically reconnect, but the channel is already gone.

### Problem 3: No POST Retry Logic (Client)
In `adapters/sse/src/client.ts`, failed POST requests throw immediately. No retry mechanism exists for transient network failures.

### Problem 4: `reconnect()` Destroys Channel
The manual `reconnect()` method explicitly removes the channel, bypassing any preservation logic we intend to add.

---

## Phase 1: Server-Side Fix (High Priority)

### Test Cases for Server-Side Leak

#### Test Group: Server Connection Management

```typescript
describe("Server Connection Management", () => {
  it("cleans up existing connection when same peer reconnects", () => {
    const adapter = new SseServerNetworkAdapter()
    const peerId = "test-peer" as PeerID
    
    // First connection
    const conn1 = adapter.registerConnection(peerId)
    const channelId1 = conn1.channelId
    
    // Verify first connection active
    expect(adapter.channels.has(channelId1)).toBe(true)
    
    // Second connection (reconnect)
    const conn2 = adapter.registerConnection(peerId)
    const channelId2 = conn2.channelId
    
    // Verify old channel removed
    expect(adapter.channels.has(channelId1)).toBe(false)
    
    // Verify new channel active
    expect(adapter.channels.has(channelId2)).toBe(true)
    expect(conn1).not.toBe(conn2)
  })
})
```

---

## Phase 2: Client Connection State Tracking

### New Types/Interfaces

```typescript
type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

interface SseClientOptions {
  postUrl: string | ((peerId: PeerID) => string)
  eventSourceUrl: string | ((peerId: PeerID) => string)
  reconnect?: {
    maxAttempts?: number      // default: 10
    maxRetryTime?: number     // passed to ReconnectingEventSource, default: 30000
  }
}
```

### Test Cases for Client Connection State

#### Test Group: Connection State Tracking

```typescript
describe("Connection State Tracking", () => {
  it("starts in 'disconnected' state before initialization", () => {
    const adapter = new SseClientNetworkAdapter({
      postUrl: "/sync",
      eventSourceUrl: "/events",
    })
    
    expect(adapter.connectionState).toBe("disconnected")
  })

  it("transitions to 'connecting' when setupEventSource is called", async () => {
    adapter._initialize(context)
    await adapter._start()
    
    // Before onopen fires
    expect(adapter.connectionState).toBe("connecting")
  })

  it("transitions to 'connected' when EventSource opens", async () => {
    adapter._initialize(context)
    await adapter._start()
    
    currentMockEventSource?.onopen?.(new Event("open"))
    
    expect(adapter.connectionState).toBe("connected")
  })

  it("transitions to 'reconnecting' on error (not 'disconnected')", async () => {
    adapter._initialize(context)
    await adapter._start()
    currentMockEventSource?.onopen?.(new Event("open"))
    
    // Simulate error
    currentMockEventSource?.onerror?.(new Event("error"))
    
    expect(adapter.connectionState).toBe("reconnecting")
    // Channel should NOT be removed yet
    expect(adapter.channels.size).toBe(1)
  })

  it("returns to 'connected' when EventSource reconnects after error", async () => {
    adapter._initialize(context)
    await adapter._start()
    currentMockEventSource?.onopen?.(new Event("open"))
    
    // Simulate error then reconnect
    currentMockEventSource?.onerror?.(new Event("error"))
    expect(adapter.connectionState).toBe("reconnecting")
    
    currentMockEventSource?.onopen?.(new Event("open"))
    expect(adapter.connectionState).toBe("connected")
  })
})
```

#### Test Group: Reconnect Attempt Tracking

```typescript
describe("Reconnect Attempt Tracking", () => {
  it("increments reconnectAttempts on each error", async () => {
    adapter._initialize(context)
    await adapter._start()
    currentMockEventSource?.onopen?.(new Event("open"))
    
    expect(adapter.reconnectAttempts).toBe(0)
    
    currentMockEventSource?.onerror?.(new Event("error"))
    expect(adapter.reconnectAttempts).toBe(1)
    
    currentMockEventSource?.onerror?.(new Event("error"))
    expect(adapter.reconnectAttempts).toBe(2)
  })

  it("resets reconnectAttempts to 0 on successful reconnection", async () => {
    adapter._initialize(context)
    await adapter._start()
    currentMockEventSource?.onopen?.(new Event("open"))
    
    // Simulate multiple errors
    currentMockEventSource?.onerror?.(new Event("error"))
    currentMockEventSource?.onerror?.(new Event("error"))
    expect(adapter.reconnectAttempts).toBe(2)
    
    // Successful reconnection
    currentMockEventSource?.onopen?.(new Event("open"))
    expect(adapter.reconnectAttempts).toBe(0)
  })

  it("does NOT remove channel until maxAttempts is reached", async () => {
    adapter = new SseClientNetworkAdapter({
      postUrl: "/sync",
      eventSourceUrl: "/events",
      reconnect: { maxAttempts: 3 },
    })
    adapter._initialize(context)
    await adapter._start()
    currentMockEventSource?.onopen?.(new Event("open"))
    
    // First two errors - channel should remain
    currentMockEventSource?.onerror?.(new Event("error"))
    expect(adapter.channels.size).toBe(1)
    
    currentMockEventSource?.onerror?.(new Event("error"))
    expect(adapter.channels.size).toBe(1)
    
    // Third error - max reached, channel should be removed
    currentMockEventSource?.onerror?.(new Event("error"))
    expect(adapter.channels.size).toBe(0)
    expect(adapter.connectionState).toBe("disconnected")
  })
})
```

#### Test Group: Channel Preservation During Reconnection

```typescript
describe("Channel Preservation During Reconnection", () => {
  it("keeps the same channel during reconnection attempts", async () => {
    adapter._initialize(context)
    await adapter._start()
    currentMockEventSource?.onopen?.(new Event("open"))
    
    const originalChannelId = Array.from(adapter.channels)[0].channelId
    
    // Error occurs
    currentMockEventSource?.onerror?.(new Event("error"))
    
    // Channel should still exist with same ID
    expect(adapter.channels.size).toBe(1)
    expect(Array.from(adapter.channels)[0].channelId).toBe(originalChannelId)
  })

  it("preserves channel when reconnect() is triggered by send on closed socket", async () => {
    adapter._initialize(context)
    await adapter._start()
    currentMockEventSource?.onopen?.(new Event("open"))
    
    const originalChannelId = Array.from(adapter.channels)[0].channelId
    
    // Simulate closed socket
    if (currentMockEventSource) currentMockEventSource.readyState = 2 // CLOSED
    
    // Trigger send, which triggers reconnect()
    const channel = Array.from(adapter.channels)[0]
    await channel.send({ type: "channel/sync-request" as const, docs: [], bidirectional: false })
    
    // Channel should still exist
    expect(adapter.channels.size).toBe(1)
    expect(Array.from(adapter.channels)[0].channelId).toBe(originalChannelId)
    expect(adapter.connectionState).toBe("reconnecting")
  })

  it("creates new channel only after successful reconnection following max attempts", async () => {
    adapter = new SseClientNetworkAdapter({
      postUrl: "/sync",
      eventSourceUrl: "/events",
      reconnect: { maxAttempts: 2 },
    })
    adapter._initialize(context)
    await adapter._start()
    currentMockEventSource?.onopen?.(new Event("open"))
    
    const originalChannelId = Array.from(adapter.channels)[0].channelId
    
    // Max attempts reached - channel removed
    currentMockEventSource?.onerror?.(new Event("error"))
    currentMockEventSource?.onerror?.(new Event("error"))
    expect(adapter.channels.size).toBe(0)
    
    // New connection - new channel
    currentMockEventSource?.onopen?.(new Event("open"))
    expect(adapter.channels.size).toBe(1)
    expect(Array.from(adapter.channels)[0].channelId).not.toBe(originalChannelId)
  })
})
```

---

## Phase 3: Client POST Retry Logic

### New Types/Interfaces

```typescript
interface SseClientOptions {
  // ... existing options
  postRetry?: {
    maxAttempts?: number    // default: 3
    baseDelay?: number      // default: 1000ms
    maxDelay?: number       // default: 10000ms
  }
}
```

### Test Cases for POST Retry

#### Test Group: POST Retry on Network Errors

```typescript
describe("POST Retry on Network Errors", () => {
  it("retries on TypeError (network error)", async () => {
    // First call fails with network error, second succeeds
    mockFetch
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ ok: true })
    
    adapter._initialize(context)
    await adapter._start()
    currentMockEventSource?.onopen?.(new Event("open"))
    const channel = Array.from(adapter.channels)[0]
    
    const message = {
      type: "channel/sync-request" as const,
      docs: [],
      bidirectional: false,
    }
    
    await channel.send(message)
    
    // Should have been called twice
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it("retries up to maxAttempts times on network errors", async () => {
    adapter = new SseClientNetworkAdapter({
      postUrl: "/sync",
      eventSourceUrl: "/events",
      postRetry: { maxAttempts: 3 },
    })
    
    // All calls fail with network error
    mockFetch.mockRejectedValue(new TypeError("Failed to fetch"))
    
    adapter._initialize(context)
    await adapter._start()
    currentMockEventSource?.onopen?.(new Event("open"))
    const channel = Array.from(adapter.channels)[0]
    
    const message = {
      type: "channel/sync-request" as const,
      docs: [],
      bidirectional: false,
    }
    
    await expect(channel.send(message)).rejects.toThrow("Failed to fetch")
    
    // Should have been called 3 times
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })
})
```

#### Test Group: Exponential Backoff with Jitter

```typescript
describe("POST Retry Exponential Backoff", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("waits baseDelay before first retry", async () => {
    adapter = new SseClientNetworkAdapter({
      postUrl: "/sync",
      eventSourceUrl: "/events",
      postRetry: { baseDelay: 1000 },
    })
    
    mockFetch
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ ok: true })
    
    adapter._initialize(context)
    await adapter._start()
    currentMockEventSource?.onopen?.(new Event("open"))
    const channel = Array.from(adapter.channels)[0]
    
    const sendPromise = channel.send({ type: "channel/sync-request" as const, docs: [], bidirectional: false })
    
    // First call happens immediately
    expect(mockFetch).toHaveBeenCalledTimes(1)
    
    // Advance time by 999ms - retry should not have happened yet
    await vi.advanceTimersByTimeAsync(999)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    
    // Advance to 1000ms - retry should happen
    await vi.advanceTimersByTimeAsync(1)
    expect(mockFetch).toHaveBeenCalledTimes(2)
    
    await sendPromise
  })
})
```

---

## Implementation Order

### Phase 1: Server-Side Fix
1.  **Update `server-adapter.ts`**: Implement cleanup in `registerConnection`.
2.  **Tests**: Add test case for "Server cleans up old connection on reconnect".

### Phase 2: Client Connection State
1.  **Add new properties to `SseClientNetworkAdapter`**:
    - `connectionState: ConnectionState`
    - `reconnectAttempts: number`
    - `maxReconnectAttempts: number`
2.  **Update constructor** to accept `reconnect` options.
3.  **Modify `onerror` handler** to:
    - Increment `reconnectAttempts`
    - Set `connectionState = 'reconnecting'`
    - Only remove channel when `reconnectAttempts >= maxReconnectAttempts`
4.  **Modify `onopen` handler** to:
    - Reset `reconnectAttempts = 0`
    - Set `connectionState = 'connected'`
    - **Crucial**: Only create a new channel if one doesn't exist (or if we're recovering from a full disconnect).
5.  **Update `reconnect()`**: Align with new state logic (don't destroy channel if recovering).

### Phase 3: Client POST Retry
1.  **Add new properties**:
    - `postRetryOptions: { maxAttempts, baseDelay, maxDelay }`
2.  **Create `sendWithRetry` private method**:
    - Implements exponential backoff with jitter.
    - Retries on network errors and 5xx server errors.
3.  **Update `generate().send`** to use `sendWithRetry`.

---

## Success Criteria

- [ ] Server cleans up old channels on reconnect (no leaks).
- [ ] Client preserves channel during transient network errors.
- [ ] Client retries failed POST requests with backoff.
- [ ] Client correctly handles "max attempts reached" by resetting state.