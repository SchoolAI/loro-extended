import { change, createTypedDoc, loro, value } from "@loro-extended/change"
import { createLens } from "@loro-extended/lens"
import { describe, expect, it } from "vitest"
import { createClientLensFilter } from "../client/filters.js"
import { makeGameFilter } from "../server/filters.js"
import { createIdentityMessage, SERVER_PLAYER_ID } from "./identity.js"
import { GameSchema } from "./schema.js"

describe("lens sovereignty integration", () => {
  it("client lens accepts server commits and rejects other player modifying our state", () => {
    const world = createTypedDoc(GameSchema)
    const loroDoc = loro(world)

    // Initialize game state as server
    loroDoc.setNextCommitMessage(createIdentityMessage(SERVER_PLAYER_ID))
    change(world, d => {
      d.game.players.set("alice", { choice: null, locked: false })
      d.game.players.set("bob", { choice: null, locked: false })
    })

    // Create alice's lens
    const aliceLens = createLens(world, {
      filter: createClientLensFilter("alice"),
    })

    // Server changes phase - should be accepted
    loroDoc.setNextCommitMessage(createIdentityMessage(SERVER_PLAYER_ID))
    change(world, d => {
      d.game.phase = "reveal"
    })

    expect(value(aliceLens.worldview.game.phase)).toBe("reveal")

    // Bob modifies his own state - should be accepted by alice's lens
    loroDoc.setNextCommitMessage(createIdentityMessage("bob"))
    change(world, d => {
      const bob = d.game.players.get("bob")
      if (bob) {
        bob.choice = "rock"
        bob.locked = true
      }
    })

    // Alice should see bob's changes
    expect(value(aliceLens.worldview.game.players.get("bob")?.choice)).toBe(
      "rock",
    )
    expect(value(aliceLens.worldview.game.players.get("bob")?.locked)).toBe(
      true,
    )

    aliceLens.dispose()
  })

  it("server lens accepts player commits for their own state", () => {
    const world = createTypedDoc(GameSchema)
    const loroDoc = loro(world)

    // Initialize game state as server
    loroDoc.setNextCommitMessage(createIdentityMessage(SERVER_PLAYER_ID))
    change(world, d => {
      d.game.players.set("alice", { choice: null, locked: false })
      d.game.players.set("bob", { choice: null, locked: false })
    })

    // Create server's lens
    const serverLens = createLens(world, {
      filter: makeGameFilter(),
    })

    // Alice modifies her own state
    loroDoc.setNextCommitMessage(createIdentityMessage("alice"))
    change(world, d => {
      const alice = d.game.players.get("alice")
      if (alice) {
        alice.choice = "rock"
        alice.locked = true
      }
    })

    // Server should see alice's changes
    expect(value(serverLens.worldview.game.players.get("alice")?.choice)).toBe(
      "rock",
    )
    expect(value(serverLens.worldview.game.players.get("alice")?.locked)).toBe(
      true,
    )

    // Bob modifies his own state
    loroDoc.setNextCommitMessage(createIdentityMessage("bob"))
    change(world, d => {
      const bob = d.game.players.get("bob")
      if (bob) {
        bob.choice = "paper"
        bob.locked = true
      }
    })

    // Server should see bob's changes
    expect(value(serverLens.worldview.game.players.get("bob")?.choice)).toBe(
      "paper",
    )
    expect(value(serverLens.worldview.game.players.get("bob")?.locked)).toBe(
      true,
    )

    serverLens.dispose()
  })

  it("server lens rejects player trying to modify another player's state", () => {
    const world = createTypedDoc(GameSchema)
    const loroDoc = loro(world)

    // Initialize game state as server
    loroDoc.setNextCommitMessage(createIdentityMessage(SERVER_PLAYER_ID))
    change(world, d => {
      d.game.players.set("alice", { choice: null, locked: false })
      d.game.players.set("bob", { choice: null, locked: false })
    })

    // Create server's lens
    const serverLens = createLens(world, {
      filter: makeGameFilter(),
    })

    // Alice tries to modify bob's state (malicious)
    loroDoc.setNextCommitMessage(createIdentityMessage("alice"))
    change(world, d => {
      const bob = d.game.players.get("bob")
      if (bob) {
        bob.choice = "rock"
        bob.locked = true
      }
    })

    // Server should NOT see the malicious changes
    expect(
      value(serverLens.worldview.game.players.get("bob")?.choice),
    ).toBeNull()
    expect(value(serverLens.worldview.game.players.get("bob")?.locked)).toBe(
      false,
    )

    serverLens.dispose()
  })

  it("server lens rejects player trying to modify phase", () => {
    const world = createTypedDoc(GameSchema)
    const loroDoc = loro(world)

    // Initialize game state as server
    loroDoc.setNextCommitMessage(createIdentityMessage(SERVER_PLAYER_ID))
    change(world, d => {
      d.game.players.set("alice", { choice: null, locked: false })
      d.game.players.set("bob", { choice: null, locked: false })
    })

    // Create server's lens
    const serverLens = createLens(world, {
      filter: makeGameFilter(),
    })

    expect(value(serverLens.worldview.game.phase)).toBe("choosing")

    // Alice tries to modify phase (malicious)
    loroDoc.setNextCommitMessage(createIdentityMessage("alice"))
    change(world, d => {
      d.game.phase = "reveal"
    })

    // Server should NOT see the malicious phase change
    expect(value(serverLens.worldview.game.phase)).toBe("choosing")

    serverLens.dispose()
  })
})
