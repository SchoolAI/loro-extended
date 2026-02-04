import { change, createTypedDoc, loro } from "@loro-extended/change"
import { createLens } from "@loro-extended/lens"
import { describe, expect, it } from "vitest"
import { createClientLensFilter } from "../client/filters.js"
import { createIdentityMessage, SERVER_PLAYER_ID } from "./identity.js"
import { GameSchema } from "./schema.js"

describe("lens sovereignty integration", () => {
  it.skip("accepts server commits and rejects other player state", () => {
    const world = createTypedDoc(GameSchema)
    const aliceLens = createLens(world, {
      filter: createClientLensFilter("alice"),
    })

    loro(world).setNextCommitMessage(createIdentityMessage(SERVER_PLAYER_ID))
    change(world, (d: any) => {
      d.game.phase = "reveal"
    })

    expect(aliceLens.worldview.game.phase).toBe("reveal")

    loro(world).setNextCommitMessage(createIdentityMessage("bob"))
    change(world, d => {
      d.game.players.set("bob", { choice: "rock", locked: true })
    })

    expect(aliceLens.worldview.game.players.get("bob")).toBeUndefined()

    aliceLens.dispose()
  })
})
