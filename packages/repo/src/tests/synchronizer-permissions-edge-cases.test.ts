import { Shape } from "@loro-extended/change"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Bridge, BridgeAdapter } from "../adapter/bridge-adapter.js"
import { Repo } from "../repo.js"
import { createVersionVector } from "../synchronizer/test-utils.js"
import { generatePeerId } from "../utils/generate-peer-id.js"

// Schema for test documents
const DocSchema = Shape.doc({
  title: Shape.text(),
})

describe("Synchronizer Permissions Edge Cases", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("should sync a document if peer already has it, even if visibility becomes false", async () => {
    const bridge = new Bridge()

    // repoA has the doc and restrictive permissions
    const repoA = new Repo({
      identity: { name: "repoA", type: "user" },
      adapters: [new BridgeAdapter({ bridge, adapterType: "adapterA" })],
      permissions: {
        visibility: () => false, // Deny everything by default
      },
    })

    // Create doc on repoA
    const docId = crypto.randomUUID()
    const handleA = repoA.get(docId, DocSchema)
    handleA.change(draft => {
      draft.title.insert(0, "secret")
    })

    // Manually inject peer state into repoA to simulate that repoB ALREADY has the doc
    // We do this BEFORE creating repoB to avoid race conditions
    const peerIdB = generatePeerId()

    repoA.synchronizer.model.peers.set(peerIdB, {
      identity: { peerId: peerIdB, name: "repoB", type: "user" },
      docSyncStates: new Map([
        [
          docId,
          {
            status: "synced",
            lastKnownVersion: createVersionVector(),
            lastUpdated: new Date(),
          },
        ],
      ]),
      subscriptions: new Set(),
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
    // (even though visibility is false)
    expect(repoB.has(docId)).toBe(true)

    const handleB = repoB.get(docId, DocSchema)
    await handleB.waitForSync({ timeout: 0 })
    expect(handleB.doc.toJSON().title).toBe("secret")
  })
})
