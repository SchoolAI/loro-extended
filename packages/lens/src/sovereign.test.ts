/**
 * Import vs ApplyDiff: Sovereign Intention Preservation
 *
 * This test demonstrates why we use applyDiff() instead of import() for
 * propagating changes from worldview (lens.doc) back to world (source).
 *
 * Scenario:
 * - Bob surreptitiously writes Alice's choice: aliceChoice = 'paper'
 * - Alice's worldview filters out Bob's write (she doesn't see it)
 * - Alice writes her own choice: aliceChoice = 'rock'
 * - The worldview propagates back to the world doc
 *
 * With import(): Alice's write may LOSE to Bob's due to CRDT convergence
 * With applyDiff(): Alice's write ALWAYS WINS (state transformation)
 */

import { LoroDoc } from "loro-crdt"
import { describe, expect, it } from "vitest"

describe("import vs applyDiff: sovereign intention preservation", () => {
  /**
   * PROBLEM: import() loses Alice's sovereign intention to Bob's surreptitious write.
   *
   * When Alice's worldview doesn't include Bob's operation, her write creates a
   * CONCURRENT operation from the CRDT's perspective. Loro resolves concurrent
   * operations using Last-Writer-Wins: higher peer ID wins.
   *
   * Bob (peer 999) beats Alice (peer 100). Alice's intention is LOST.
   */
  it("import() loses to higher peer ID (Bob wins)", () => {
    // World doc
    const world = new LoroDoc()
    world.setPeerId("1")

    // Bob has a HIGHER peer ID and writes Alice's choice
    const bob = new LoroDoc()
    bob.setPeerId("999")
    bob.getMap("choices").set("aliceChoice", "paper")
    bob.commit()

    // Bob's write arrives at world
    world.import(bob.export({ mode: "update" }))
    expect(world.getMap("choices").get("aliceChoice")).toBe("paper")

    // Alice's worldview has a LOWER peer ID and doesn't see Bob's write
    // (simulating filtered import - she only knows about her own state)
    const aliceWorldview = new LoroDoc()
    aliceWorldview.setPeerId("100")

    // Alice writes her sovereign choice
    aliceWorldview.getMap("choices").set("aliceChoice", "rock")
    aliceWorldview.commit()

    // Propagate via import()
    world.import(aliceWorldview.export({ mode: "update" }))

    // Bob's write wins because:
    // 1. Operations are concurrent (Alice didn't see Bob's write)
    // 2. Bob has higher peer ID (999 > 100)
    expect(world.getMap("choices").get("aliceChoice")).toBe("paper")
  })

  /**
   * SOLUTION: applyDiff() preserves Alice's sovereign intention.
   *
   * applyDiff() is a STATE transformation, not an operation replay.
   * It doesn't care about causal history or peer ID ordering.
   * Alice's write ALWAYS wins because it's applied as the new state.
   */
  it("applyDiff() preserves sovereign intention (Alice wins)", () => {
    // World doc
    const world = new LoroDoc()
    world.setPeerId("1")

    // Bob has a HIGHER peer ID and writes Alice's choice
    const bob = new LoroDoc()
    bob.setPeerId("999")
    bob.getMap("choices").set("aliceChoice", "paper")
    bob.commit()

    // Bob's write arrives at world
    world.import(bob.export({ mode: "update" }))
    expect(world.getMap("choices").get("aliceChoice")).toBe("paper")

    // Alice's worldview (can use same peer ID with applyDiff!)
    const aliceWorldview = new LoroDoc()
    aliceWorldview.setPeerId("1")

    // Capture frontiers before Alice's write
    const frontiersBefore = aliceWorldview.frontiers()

    // Alice writes her sovereign choice
    aliceWorldview.getMap("choices").set("aliceChoice", "rock")
    aliceWorldview.commit()

    const frontiersAfter = aliceWorldview.frontiers()

    // Propagate via applyDiff() - state transformation, not operation replay
    const diff = aliceWorldview.diff(frontiersBefore, frontiersAfter, false)
    world.applyDiff(diff)
    world.commit()

    // Alice's write ALWAYS wins with applyDiff!
    expect(world.getMap("choices").get("aliceChoice")).toBe("rock")
  })
})
