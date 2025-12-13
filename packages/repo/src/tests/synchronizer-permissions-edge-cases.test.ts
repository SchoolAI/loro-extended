import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Bridge, BridgeAdapter } from "../adapter/bridge-adapter.js"
import { Repo } from "../repo.js"
import { createVersionVector } from "../synchronizer/test-utils.js"
import { generatePeerId } from "../utils/generate-peer-id.js"

describe("Synchronizer Permissions Edge Cases", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("should sync a document if peer already has it, even if canReveal becomes false", async () => {
    const bridge = new Bridge()

    // repoA has the doc and restrictive rules
    const repoA = new Repo({
      identity: { name: "repoA", type: "user" },
      adapters: [new BridgeAdapter({ bridge, adapterType: "adapterA" })],
      rules: {
        canReveal: () => false, // Deny everything by default
      },
    })

    // Create doc on repoA
    const docId = crypto.randomUUID()
    const handleA = repoA.get(docId)
    handleA.batch(doc => doc.getMap("doc").set("text", "secret"))

    // Manually inject peer state into repoA to simulate that repoB ALREADY has the doc
    // We do this BEFORE creating repoB to avoid race conditions
    const peerIdB = generatePeerId()

    repoA.synchronizer.model.peers.set(peerIdB, {
      identity: { peerId: peerIdB, name: "repoB", type: "user" },
      documentAwareness: new Map([
        [
          docId,
          {
            awareness: "has-doc",
            lastKnownVersion: createVersionVector(),
            lastUpdated: new Date(),
          },
        ],
      ]),
      subscriptions: new Set(),
      lastSeen: new Date(),
      channels: new Set(),
    })

    // repoB connects
    const repoB = new Repo({
      identity: { name: "repoB", type: "user", peerId: peerIdB },
      adapters: [new BridgeAdapter({ bridge, adapterType: "adapterB" })],
    })

    // Wait for sync
    await vi.runAllTimersAsync()

    // repoB should have received the doc because repoA knows repoB has it
    // (even though canReveal is false)
    expect(repoB.has(docId)).toBe(true)

    const handleB = repoB.get(docId)
    await handleB.waitForNetwork()
    expect(handleB.doc.getMap("doc").toJSON()).toEqual({ text: "secret" })
  })
})
