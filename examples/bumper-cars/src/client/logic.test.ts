import type { PeerID } from "@loro-extended/repo"
import { describe, expect, it } from "vitest"
import type {
  ClientPresence,
  GamePresence,
  InputState,
  PlayerScore,
  ServerPresence,
} from "../shared/types"
import {
  combineInputs,
  createClientPresence,
  getActivePlayers,
  partitionPresences,
  shouldSendPresenceUpdate,
  sortScores,
  ZERO_INPUT,
} from "./logic"

// =============================================================================
// partitionPresences
// =============================================================================

describe("partitionPresences", () => {
  const myPeerId = "my-peer" as PeerID

  it("returns null serverPresence when none exists", () => {
    const clientPresence: ClientPresence = {
      type: "client",
      name: "Player1",
      color: "#FF6B6B",
      input: ZERO_INPUT,
    }

    const result = partitionPresences(clientPresence, new Map(), myPeerId)

    expect(result.serverPresence).toBeNull()
    expect(result.clientPresences[myPeerId]).toEqual(clientPresence)
  })

  it("finds server presence among peers", () => {
    const serverPresence: ServerPresence = {
      type: "server",
      cars: {},
      tick: 42,
    }
    const serverPeerId = "server-peer" as PeerID

    const result = partitionPresences(
      null,
      new Map([[serverPeerId, serverPresence]]),
      myPeerId,
    )

    expect(result.serverPresence).toEqual(serverPresence)
    expect(Object.keys(result.clientPresences)).toHaveLength(0)
  })

  it("collects all client presences", () => {
    const selfPresence: ClientPresence = {
      type: "client",
      name: "Self",
      color: "#FF6B6B",
      input: ZERO_INPUT,
    }
    const peer1Presence: ClientPresence = {
      type: "client",
      name: "Peer1",
      color: "#26DE81",
      input: { force: 0.5, angle: 1.0 },
    }
    const peer2Presence: ClientPresence = {
      type: "client",
      name: "Peer2",
      color: "#54A0FF",
      input: ZERO_INPUT,
    }
    const peer1Id = "peer-1" as PeerID
    const peer2Id = "peer-2" as PeerID

    const result = partitionPresences(
      selfPresence,
      new Map([
        [peer1Id, peer1Presence],
        [peer2Id, peer2Presence],
      ]),
      myPeerId,
    )

    expect(result.serverPresence).toBeNull()
    expect(Object.keys(result.clientPresences)).toHaveLength(3)
    expect(result.clientPresences[myPeerId]).toEqual(selfPresence)
    expect(result.clientPresences[peer1Id]).toEqual(peer1Presence)
    expect(result.clientPresences[peer2Id]).toEqual(peer2Presence)
  })

  it("excludes null presences", () => {
    const clientPresence: ClientPresence = {
      type: "client",
      name: "Player1",
      color: "#FF6B6B",
      input: ZERO_INPUT,
    }
    const validPeerId = "valid-peer" as PeerID
    const nullPeerId = "null-peer" as PeerID

    const result = partitionPresences(
      null,
      new Map([
        [validPeerId, clientPresence],
        [nullPeerId, null],
      ]),
      myPeerId,
    )

    expect(Object.keys(result.clientPresences)).toHaveLength(1)
    expect(result.clientPresences[validPeerId]).toEqual(clientPresence)
    expect(result.clientPresences[nullPeerId]).toBeUndefined()
  })

  it("handles mixed server and client presences", () => {
    const selfPresence: ClientPresence = {
      type: "client",
      name: "Self",
      color: "#FF6B6B",
      input: ZERO_INPUT,
    }
    const serverPresence: ServerPresence = {
      type: "server",
      cars: {},
      tick: 100,
    }
    const otherClientPresence: ClientPresence = {
      type: "client",
      name: "Other",
      color: "#26DE81",
      input: ZERO_INPUT,
    }
    const serverPeerId = "server" as PeerID
    const otherPeerId = "other" as PeerID

    const result = partitionPresences(
      selfPresence,
      new Map<PeerID, GamePresence | null>([
        [serverPeerId, serverPresence],
        [otherPeerId, otherClientPresence],
      ]),
      myPeerId,
    )

    expect(result.serverPresence).toEqual(serverPresence)
    expect(Object.keys(result.clientPresences)).toHaveLength(2)
    expect(result.clientPresences[myPeerId]).toEqual(selfPresence)
    expect(result.clientPresences[otherPeerId]).toEqual(otherClientPresence)
  })
})

// =============================================================================
// getActivePlayers
// =============================================================================

describe("getActivePlayers", () => {
  it("maps client presences to player list format", () => {
    const peer1Id = "peer-1" as PeerID
    const peer2Id = "peer-2" as PeerID
    const clientPresences: Record<PeerID, ClientPresence> = {
      [peer1Id]: {
        type: "client",
        name: "Alice",
        color: "#FF6B6B",
        input: { force: 0.5, angle: 1.0 },
      },
      [peer2Id]: {
        type: "client",
        name: "Bob",
        color: "#26DE81",
        input: ZERO_INPUT,
      },
    }

    const result = getActivePlayers(clientPresences)

    expect(result).toHaveLength(2)
    expect(result).toContainEqual({
      peerId: peer1Id,
      name: "Alice",
      color: "#FF6B6B",
    })
    expect(result).toContainEqual({
      peerId: peer2Id,
      name: "Bob",
      color: "#26DE81",
    })
  })

  it("returns empty array for empty presences", () => {
    const result = getActivePlayers({})
    expect(result).toEqual([])
  })
})

// =============================================================================
// createClientPresence
// =============================================================================

describe("createClientPresence", () => {
  it("constructs correct ClientPresence shape", () => {
    const result = createClientPresence("TestPlayer", "#54A0FF", {
      force: 0.8,
      angle: 2.5,
    })

    expect(result).toEqual({
      type: "client",
      name: "TestPlayer",
      color: "#54A0FF",
      input: { force: 0.8, angle: 2.5 },
    })
  })

  it("uses ZERO_INPUT for stationary player", () => {
    const result = createClientPresence("Idle", "#FFFFFF", ZERO_INPUT)

    expect(result.input.force).toBe(0)
    expect(result.input.angle).toBe(0)
  })
})

// =============================================================================
// sortScores
// =============================================================================

describe("sortScores", () => {
  it("sorts by bumps descending", () => {
    const scores: Record<string, PlayerScore> = {
      "peer-1": { name: "Low", color: "#FF6B6B", bumps: 5 },
      "peer-2": { name: "High", color: "#26DE81", bumps: 20 },
      "peer-3": { name: "Mid", color: "#54A0FF", bumps: 10 },
    }

    const result = sortScores(scores, 10)

    expect(result[0].name).toBe("High")
    expect(result[0].bumps).toBe(20)
    expect(result[1].name).toBe("Mid")
    expect(result[1].bumps).toBe(10)
    expect(result[2].name).toBe("Low")
    expect(result[2].bumps).toBe(5)
  })

  it("respects limit parameter", () => {
    const scores: Record<string, PlayerScore> = {
      "peer-1": { name: "First", color: "#FF6B6B", bumps: 100 },
      "peer-2": { name: "Second", color: "#26DE81", bumps: 80 },
      "peer-3": { name: "Third", color: "#54A0FF", bumps: 60 },
      "peer-4": { name: "Fourth", color: "#FFEAA7", bumps: 40 },
      "peer-5": { name: "Fifth", color: "#A55EEA", bumps: 20 },
    }

    const result = sortScores(scores, 3)

    expect(result).toHaveLength(3)
    expect(result.map(s => s.name)).toEqual(["First", "Second", "Third"])
  })

  it("handles empty scores object", () => {
    const result = sortScores({}, 5)
    expect(result).toEqual([])
  })

  it("includes peerId in result", () => {
    const scores: Record<string, PlayerScore> = {
      "test-peer-id": { name: "Test", color: "#FF6B6B", bumps: 10 },
    }

    const result = sortScores(scores, 5)

    expect(result[0].peerId).toBe("test-peer-id" as PeerID)
  })

  it("handles limit larger than scores count", () => {
    const scores: Record<string, PlayerScore> = {
      "peer-1": { name: "Only", color: "#FF6B6B", bumps: 10 },
    }

    const result = sortScores(scores, 100)

    expect(result).toHaveLength(1)
  })
})

// =============================================================================
// combineInputs
// =============================================================================

describe("combineInputs", () => {
  it("returns joystick input when force > 0", () => {
    const joystickInput: InputState = { force: 0.5, angle: 1.2 }
    const keyboardInput: InputState = { force: 1.0, angle: 0 }

    const result = combineInputs(joystickInput, keyboardInput)

    expect(result).toEqual(joystickInput)
  })

  it("returns keyboard input when joystick force is 0", () => {
    const joystickInput: InputState = { force: 0, angle: 0 }
    const keyboardInput: InputState = { force: 0.8, angle: 2.5 }

    const result = combineInputs(joystickInput, keyboardInput)

    expect(result).toEqual(keyboardInput)
  })

  it("returns keyboard input when both have zero force", () => {
    const result = combineInputs(ZERO_INPUT, ZERO_INPUT)

    expect(result).toEqual(ZERO_INPUT)
  })

  it("returns joystick even with small non-zero force", () => {
    const joystickInput: InputState = { force: 0.001, angle: 0.5 }
    const keyboardInput: InputState = { force: 1.0, angle: 0 }

    const result = combineInputs(joystickInput, keyboardInput)

    expect(result).toEqual(joystickInput)
  })
})

// =============================================================================
// shouldSendPresenceUpdate
// =============================================================================

describe("shouldSendPresenceUpdate", () => {
  const THROTTLE_MS = 50

  it("returns false when input unchanged", () => {
    const input: InputState = { force: 0.5, angle: 1.0 }

    const result = shouldSendPresenceUpdate(input, input, 0, 1000, THROTTLE_MS)

    expect(result).toBe(false)
  })

  it("returns false when input values are equal but different objects", () => {
    const current: InputState = { force: 0.5, angle: 1.0 }
    const last: InputState = { force: 0.5, angle: 1.0 }

    const result = shouldSendPresenceUpdate(current, last, 0, 1000, THROTTLE_MS)

    expect(result).toBe(false)
  })

  it("returns true immediately for zero-force (stop) input", () => {
    const current: InputState = { force: 0, angle: 0 }
    const last: InputState = { force: 0.5, angle: 1.0 }
    const lastUpdateTime = 1000
    const now = 1010 // Only 10ms elapsed, less than throttle

    const result = shouldSendPresenceUpdate(
      current,
      last,
      lastUpdateTime,
      now,
      THROTTLE_MS,
    )

    expect(result).toBe(true)
  })

  it("returns false when throttle interval not elapsed", () => {
    const current: InputState = { force: 0.8, angle: 2.0 }
    const last: InputState = { force: 0.5, angle: 1.0 }
    const lastUpdateTime = 1000
    const now = 1030 // 30ms elapsed, less than 50ms throttle

    const result = shouldSendPresenceUpdate(
      current,
      last,
      lastUpdateTime,
      now,
      THROTTLE_MS,
    )

    expect(result).toBe(false)
  })

  it("returns true when throttle interval elapsed", () => {
    const current: InputState = { force: 0.8, angle: 2.0 }
    const last: InputState = { force: 0.5, angle: 1.0 }
    const lastUpdateTime = 1000
    const now = 1050 // Exactly 50ms elapsed

    const result = shouldSendPresenceUpdate(
      current,
      last,
      lastUpdateTime,
      now,
      THROTTLE_MS,
    )

    expect(result).toBe(true)
  })

  it("returns true when throttle interval exceeded", () => {
    const current: InputState = { force: 0.8, angle: 2.0 }
    const last: InputState = { force: 0.5, angle: 1.0 }
    const lastUpdateTime = 1000
    const now = 1100 // 100ms elapsed, well over throttle

    const result = shouldSendPresenceUpdate(
      current,
      last,
      lastUpdateTime,
      now,
      THROTTLE_MS,
    )

    expect(result).toBe(true)
  })

  it("detects change in force only", () => {
    const current: InputState = { force: 0.8, angle: 1.0 }
    const last: InputState = { force: 0.5, angle: 1.0 }

    const result = shouldSendPresenceUpdate(current, last, 0, 100, THROTTLE_MS)

    expect(result).toBe(true)
  })

  it("detects change in angle only", () => {
    const current: InputState = { force: 0.5, angle: 2.0 }
    const last: InputState = { force: 0.5, angle: 1.0 }

    const result = shouldSendPresenceUpdate(current, last, 0, 100, THROTTLE_MS)

    expect(result).toBe(true)
  })
})
