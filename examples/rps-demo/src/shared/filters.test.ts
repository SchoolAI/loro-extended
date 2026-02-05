import type { CommitInfo } from "@loro-extended/lens"
import type {
  ContainerID,
  JsonChange,
  JsonOp,
  JsonOpID,
  JsonValue,
  MapOp,
  PeerID,
} from "loro-crdt"
import { describe, expect, it } from "vitest"
import { createClientLensFilter } from "../client/filters.js"
import { SERVER_PLAYER_ID } from "./identity.js"

/**
 * Helper to create a commit info object for testing
 */
function createCommitInfo(
  playerId: string | undefined,
  ops: Array<{
    container: ContainerID
    key?: string
    value?: JsonValue
  }>,
): CommitInfo {
  const peerId: PeerID = "0"
  const counter = 1
  const id: JsonOpID = `${counter}@${peerId}`
  const msg = playerId ? JSON.stringify({ playerId }) : null

  const jsonOps: JsonOp[] = ops.map((op, index) => {
    const content: MapOp = {
      type: "insert",
      key: op.key ?? "",
      value: op.value ?? null,
    }

    return {
      container: op.container,
      counter: index,
      content,
    }
  })

  const raw: JsonChange = {
    id,
    timestamp: Math.floor(Date.now() / 1000),
    deps: [],
    lamport: 1,
    msg,
    ops: jsonOps,
  }

  return {
    raw,
    peerId,
    counter,
    timestamp: raw.timestamp,
    message: playerId ? { playerId } : undefined,
  }
}

describe("client filter - with path-based container IDs", () => {
  it("accepts server commits", () => {
    const filter = createClientLensFilter("alice")
    const serverCommit = createCommitInfo(SERVER_PLAYER_ID, [
      {
        container: "cid:root-game:Map",
        key: "phase",
        value: "reveal",
      },
    ])
    expect(filter(serverCommit)).toBe(true)
  })

  it("accepts own player mutations", () => {
    const filter = createClientLensFilter("alice")

    const ownCommit = createCommitInfo("alice", [
      {
        container: "cid:root-game-players-alice:Map",
        key: "choice",
        value: "rock",
      },
    ])
    expect(filter(ownCommit)).toBe(true)
  })

  it("rejects other player trying to modify our state", () => {
    const filter = createClientLensFilter("alice")

    // Bob trying to modify alice's state
    const otherPlayerCommit = createCommitInfo("bob", [
      {
        container: "cid:root-game-players-alice:Map",
        key: "choice",
        value: "rock",
      },
    ])
    expect(filter(otherPlayerCommit)).toBe(false)
  })

  it("accepts other player modifying their own state", () => {
    const filter = createClientLensFilter("alice")

    // Bob modifying his own state - alice's filter should accept this
    const otherPlayerCommit = createCommitInfo("bob", [
      {
        container: "cid:root-game-players-bob:Map",
        key: "choice",
        value: "rock",
      },
    ])
    expect(filter(otherPlayerCommit)).toBe(true)
  })

  it("rejects non-server peer edits to phase", () => {
    const filter = createClientLensFilter("alice")
    const peerPhaseCommit = createCommitInfo("bob", [
      {
        container: "cid:root-game:Map",
        key: "phase",
        value: "reveal",
      },
    ])
    expect(filter(peerPhaseCommit)).toBe(false)
  })

  it("rejects commits without identity", () => {
    const filter = createClientLensFilter("alice")
    const noIdentityCommit = createCommitInfo(undefined, [
      { container: "cid:root-game:Map" },
    ])
    expect(filter(noIdentityCommit)).toBe(false)
  })
})

describe("client filter - bob's perspective", () => {
  it("accepts bob's own mutations", () => {
    const filter = createClientLensFilter("bob")

    const ownCommit = createCommitInfo("bob", [
      {
        container: "cid:root-game-players-bob:Map",
        key: "choice",
        value: "paper",
      },
    ])
    expect(filter(ownCommit)).toBe(true)
  })

  it("rejects alice trying to modify bob's state", () => {
    const filter = createClientLensFilter("bob")

    // Alice trying to modify bob's state
    const otherPlayerCommit = createCommitInfo("alice", [
      {
        container: "cid:root-game-players-bob:Map",
        key: "choice",
        value: "rock",
      },
    ])
    expect(filter(otherPlayerCommit)).toBe(false)
  })

  it("accepts alice modifying her own state", () => {
    const filter = createClientLensFilter("bob")

    // Alice modifying her own state - bob's filter should accept this
    const otherPlayerCommit = createCommitInfo("alice", [
      {
        container: "cid:root-game-players-alice:Map",
        key: "choice",
        value: "rock",
      },
    ])
    expect(filter(otherPlayerCommit)).toBe(true)
  })
})
