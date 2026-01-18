import { describe, expect, it } from "vitest"
import {
  addActiveAsk,
  createWorkerPresence,
  isPresenceExpired,
  removeActiveAsk,
  updateHeartbeat,
} from "./presence.js"

describe("createWorkerPresence", () => {
  it("creates a presence with the given worker ID", () => {
    const presence = createWorkerPresence("worker-1")
    expect(presence.workerId).toBe("worker-1")
  })

  it("creates a presence with empty active asks by default", () => {
    const presence = createWorkerPresence("worker-1")
    expect(presence.activeAsks).toEqual([])
  })

  it("creates a presence with provided active asks", () => {
    const presence = createWorkerPresence("worker-1", ["ask-1", "ask-2"])
    expect(presence.activeAsks).toEqual(["ask-1", "ask-2"])
  })

  it("sets lastHeartbeat to current time", () => {
    const before = Date.now()
    const presence = createWorkerPresence("worker-1")
    const after = Date.now()

    expect(presence.lastHeartbeat).toBeGreaterThanOrEqual(before)
    expect(presence.lastHeartbeat).toBeLessThanOrEqual(after)
  })
})

describe("updateHeartbeat", () => {
  it("updates the lastHeartbeat timestamp", async () => {
    const presence = createWorkerPresence("worker-1")
    const originalHeartbeat = presence.lastHeartbeat

    // Wait a bit to ensure time difference
    await new Promise(resolve => setTimeout(resolve, 10))

    const updated = updateHeartbeat(presence)
    expect(updated.lastHeartbeat).toBeGreaterThan(originalHeartbeat)
  })

  it("preserves other fields", () => {
    const presence = createWorkerPresence("worker-1", ["ask-1"])
    const updated = updateHeartbeat(presence)

    expect(updated.workerId).toBe("worker-1")
    expect(updated.activeAsks).toEqual(["ask-1"])
  })

  it("returns a new object (immutable)", () => {
    const presence = createWorkerPresence("worker-1")
    const updated = updateHeartbeat(presence)

    expect(updated).not.toBe(presence)
  })
})

describe("addActiveAsk", () => {
  it("adds an ask ID to the active asks list", () => {
    const presence = createWorkerPresence("worker-1")
    const updated = addActiveAsk(presence, "ask-1")

    expect(updated.activeAsks).toContain("ask-1")
  })

  it("does not add duplicate ask IDs", () => {
    const presence = createWorkerPresence("worker-1", ["ask-1"])
    const updated = addActiveAsk(presence, "ask-1")

    expect(updated.activeAsks).toEqual(["ask-1"])
  })

  it("updates the heartbeat", async () => {
    const presence = createWorkerPresence("worker-1")
    const originalHeartbeat = presence.lastHeartbeat

    await new Promise(resolve => setTimeout(resolve, 10))

    const updated = addActiveAsk(presence, "ask-1")
    expect(updated.lastHeartbeat).toBeGreaterThan(originalHeartbeat)
  })

  it("returns the same object if ask already exists", () => {
    const presence = createWorkerPresence("worker-1", ["ask-1"])
    const updated = addActiveAsk(presence, "ask-1")

    expect(updated).toBe(presence)
  })
})

describe("removeActiveAsk", () => {
  it("removes an ask ID from the active asks list", () => {
    const presence = createWorkerPresence("worker-1", ["ask-1", "ask-2"])
    const updated = removeActiveAsk(presence, "ask-1")

    expect(updated.activeAsks).not.toContain("ask-1")
    expect(updated.activeAsks).toContain("ask-2")
  })

  it("handles removing non-existent ask ID gracefully", () => {
    const presence = createWorkerPresence("worker-1", ["ask-1"])
    const updated = removeActiveAsk(presence, "ask-2")

    expect(updated.activeAsks).toEqual(["ask-1"])
  })

  it("updates the heartbeat", async () => {
    const presence = createWorkerPresence("worker-1", ["ask-1"])
    const originalHeartbeat = presence.lastHeartbeat

    await new Promise(resolve => setTimeout(resolve, 10))

    const updated = removeActiveAsk(presence, "ask-1")
    expect(updated.lastHeartbeat).toBeGreaterThan(originalHeartbeat)
  })
})

describe("isPresenceExpired", () => {
  it("returns false for fresh presence", () => {
    const presence = createWorkerPresence("worker-1")
    expect(isPresenceExpired(presence, 5000)).toBe(false)
  })

  it("returns true for expired presence", () => {
    const presence = {
      workerId: "worker-1",
      activeAsks: [],
      lastHeartbeat: Date.now() - 10000, // 10 seconds ago
    }
    expect(isPresenceExpired(presence, 5000)).toBe(true)
  })

  it("returns false when exactly at timeout boundary", () => {
    const presence = {
      workerId: "worker-1",
      activeAsks: [],
      lastHeartbeat: Date.now() - 5000, // exactly 5 seconds ago
    }
    // At exactly the boundary, it should not be expired yet
    expect(isPresenceExpired(presence, 5000)).toBe(false)
  })
})
