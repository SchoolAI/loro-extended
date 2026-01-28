import type { CommitInfo } from "@loro-extended/lens"
import { describe, expect, it } from "vitest"
import { createClientLensFilter } from "../client/filters.js"
import { SERVER_PLAYER_ID } from "./identity.js"

type OpLike = {
  container: string
  content?: { type?: string; key?: unknown }
}

function commit(playerId: string | undefined, ops: OpLike[]): CommitInfo {
  return {
    raw: {
      id: "1@peer",
      timestamp: Date.now(),
      msg: playerId ? JSON.stringify({ playerId }) : undefined,
      ops,
      length: 1,
      deps: [],
      lamport: 1,
    } as unknown as CommitInfo["raw"],
    peerId: "peer",
    counter: 1,
    timestamp: Date.now(),
    message: playerId ? { playerId } : undefined,
  }
}

describe("filters", () => {
  it("client lens rejects other-player mutations", () => {
    const filter = createClientLensFilter("alice")
    const otherPlayerCommit = commit("bob", [
      { container: "cid:root-game/players/bob:Map" },
    ])
    expect(filter(otherPlayerCommit)).toBe(false)
  })

  it("client lens rejects non-server peer edits to shared phase", () => {
    const filter = createClientLensFilter("alice")
    const peerPhaseCommit = commit("bob", [
      {
        container: "cid:root-game:Map",
        content: { type: "insert", key: "phase" },
      },
    ])
    expect(filter(peerPhaseCommit)).toBe(false)
  })

  it("client lens accepts its own player mutations", () => {
    const filter = createClientLensFilter("alice")
    const ownCommit = commit("alice", [
      { container: "cid:root-game/players/alice:Map" },
    ])
    expect(filter(ownCommit)).toBe(true)
  })

  it("client lens accepts server commits", () => {
    const filter = createClientLensFilter("alice")
    const serverCommit = commit(SERVER_PLAYER_ID, [
      {
        container: "cid:root-game:Map",
        content: { type: "insert", key: "phase" },
      },
    ])
    expect(filter(serverCommit)).toBe(true)
  })
})
