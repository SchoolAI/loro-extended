import { change, createTypedDoc, loro } from "@loro-extended/change"
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
import { createIdentityMessage, SERVER_PLAYER_ID } from "../shared/identity.js"
import { GameSchema } from "../shared/schema.js"
import { makeGameFilter } from "./filters.js"

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

describe("server filter - path-based container IDs", () => {
  it("should use path-based container IDs with mergeable: true", () => {
    // Create a typed doc and initialize it
    const doc = createTypedDoc(GameSchema)
    const loroDoc = loro(doc)

    // Initialize game state as server
    loroDoc.setNextCommitMessage(createIdentityMessage(SERVER_PLAYER_ID))
    change(doc, d => {
      d.game.players.set("alice", { choice: null, locked: false })
      d.game.players.set("bob", { choice: null, locked: false })
    })

    const frontiersBefore = loroDoc.frontiers()

    // Now simulate alice making a change
    loroDoc.setNextCommitMessage(createIdentityMessage("alice"))
    change(doc, d => {
      const alice = d.game.players.get("alice")
      if (alice) {
        alice.choice = "rock"
        alice.locked = true
      }
    })

    const frontiersAfter = loroDoc.frontiers()

    // Get the changes between frontiers
    const spans = loroDoc.findIdSpansBetween(frontiersBefore, frontiersAfter)
    expect(spans.forward.length).toBeGreaterThan(0)

    // Verify the ops target alice's container with path-based ID
    for (const span of spans.forward) {
      const changes = loroDoc.exportJsonInIdSpan({
        peer: span.peer,
        counter: span.counter,
        length: span.length,
      })
      expect(changes.length).toBeGreaterThan(0)

      // The ops should target alice's container with path-based ID
      for (const jsonChange of changes) {
        for (const op of jsonChange.ops) {
          // Container ID should be path-based like "cid:root-game-players-alice:Map"
          expect(op.container).toBe("cid:root-game-players-alice:Map")
        }
      }
    }
  })

  it("should examine ops when bob makes a change", () => {
    const doc = createTypedDoc(GameSchema)
    const loroDoc = loro(doc)

    // Initialize game state as server
    loroDoc.setNextCommitMessage(createIdentityMessage(SERVER_PLAYER_ID))
    change(doc, d => {
      d.game.players.set("alice", { choice: null, locked: false })
      d.game.players.set("bob", { choice: null, locked: false })
    })

    const frontiersBefore = loroDoc.frontiers()

    // Now simulate bob making a change
    loroDoc.setNextCommitMessage(createIdentityMessage("bob"))
    change(doc, d => {
      const bob = d.game.players.get("bob")
      if (bob) {
        bob.choice = "paper"
      }
    })

    const frontiersAfter = loroDoc.frontiers()

    // Get the changes between frontiers
    const spans = loroDoc.findIdSpansBetween(frontiersBefore, frontiersAfter)
    expect(spans.forward.length).toBeGreaterThan(0)

    // Verify the ops target bob's container with path-based ID
    for (const span of spans.forward) {
      const changes = loroDoc.exportJsonInIdSpan({
        peer: span.peer,
        counter: span.counter,
        length: span.length,
      })

      for (const jsonChange of changes) {
        for (const op of jsonChange.ops) {
          // Container ID should be path-based like "cid:root-game-players-bob:Map"
          expect(op.container).toBe("cid:root-game-players-bob:Map")
        }
      }
    }
  })
})

describe("server filter - filtering behavior", () => {
  it("should allow alice to modify her own container", () => {
    const filter = makeGameFilter()

    // Create a commit info that simulates alice modifying her container
    // Using path-based container ID
    const commitInfo = createCommitInfo("alice", [
      {
        container: "cid:root-game-players-alice:Map",
        key: "choice",
        value: "rock",
      },
    ])

    const result = filter(commitInfo)

    // The filter should allow this
    expect(result).toBe(true)
  })

  it("should reject alice modifying bob's container", () => {
    const filter = makeGameFilter()

    // Create a commit info that simulates alice trying to modify bob's container
    // Using path-based container ID
    const commitInfo = createCommitInfo("alice", [
      {
        container: "cid:root-game-players-bob:Map",
        key: "choice",
        value: "rock",
      },
    ])

    const result = filter(commitInfo)

    // The filter should reject this
    expect(result).toBe(false)
  })

  it("should allow bob to modify his own container", () => {
    const filter = makeGameFilter()

    const commitInfo = createCommitInfo("bob", [
      {
        container: "cid:root-game-players-bob:Map",
        key: "choice",
        value: "paper",
      },
    ])

    const result = filter(commitInfo)

    expect(result).toBe(true)
  })

  it("should reject bob modifying alice's container", () => {
    const filter = makeGameFilter()

    const commitInfo = createCommitInfo("bob", [
      {
        container: "cid:root-game-players-alice:Map",
        key: "choice",
        value: "paper",
      },
    ])

    const result = filter(commitInfo)

    expect(result).toBe(false)
  })

  it("should allow server to modify any container", () => {
    const filter = makeGameFilter()

    // Create a commit info that simulates server modifying phase
    const commitInfo = createCommitInfo(SERVER_PLAYER_ID, [
      {
        container: "cid:root-game:Map",
        key: "phase",
        value: "reveal",
      },
    ])

    const result = filter(commitInfo)

    // The filter should allow server commits
    expect(result).toBe(true)
  })

  it("should reject non-server modifying phase", () => {
    const filter = makeGameFilter()

    // Create a commit info that simulates alice trying to modify phase
    const commitInfo = createCommitInfo("alice", [
      {
        container: "cid:root-game:Map",
        key: "phase",
        value: "reveal",
      },
    ])

    const result = filter(commitInfo)

    // The filter should reject this
    expect(result).toBe(false)
  })

  it("should reject commits without identity", () => {
    const filter = makeGameFilter()

    // Create a commit info without identity
    const commitInfo = createCommitInfo(undefined, [
      {
        container: "cid:root-game:Map",
        key: "phase",
        value: "reveal",
      },
    ])

    const result = filter(commitInfo)

    // The filter should reject commits without identity
    expect(result).toBe(false)
  })
})
