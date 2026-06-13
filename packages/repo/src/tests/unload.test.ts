/**
 * Integration tests for Repo.unload(docId).
 *
 * unload evicts a document from memory while retaining storage and sending NO
 * channel messages, unlike delete (which fans a delete-request out to peers).
 * These tests pin the four behaviors the durability work depends on:
 *
 *  1. unload → re-get rehydrates from the storage adapter.
 *  2. unload sends NO channel/delete-request to peers (contrast with delete).
 *  3. inbound sync for an unloaded doc re-creates docState.
 *  4. unload while a storage consult is in flight: recovers on re-get
 *     (the documented orphaned-pending caveat).
 */

import { change, Shape } from "@loro-extended/change"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Bridge, BridgeAdapter } from "../adapter/bridge-adapter.js"
import { Repo } from "../repo.js"
import { InMemoryStorageAdapter } from "../storage/in-memory-storage-adapter.js"
import { sync } from "../sync.js"

const StorageDocSchema = Shape.doc({
  data: Shape.struct({
    title: Shape.plain.string(),
  }),
})

describe("Repo.unload", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("rehydrates from the storage adapter on re-get", async () => {
    const storage = new InMemoryStorageAdapter()
    const repo = new Repo({
      identity: { name: "repo", type: "user" },
      adapters: [storage],
    })
    await vi.runAllTimersAsync()

    const docId = "unload-rehydrate"
    const doc = repo.get(docId, StorageDocSchema)
    change(doc, draft => {
      draft.data.title.set("persisted")
    })

    // Ensure the content reached the storage adapter before evicting.
    await repo.flush()
    await vi.runAllTimersAsync()
    expect(repo.has(docId)).toBe(true)

    // Evict from memory. Storage is retained.
    await repo.unload(docId)
    expect(repo.has(docId)).toBe(false)
    // Storage chunks survive the unload.
    expect(storage.getStorage().size).toBeGreaterThan(0)

    // Re-get and await storage-first sync — content comes back from disk.
    const doc2 = repo.get(docId, StorageDocSchema)
    await sync(doc2).waitForSync({ kind: "storage", timeout: 0 })
    await vi.runAllTimersAsync()

    expect(doc2.toJSON().data.title).toBe("persisted")
  }, 1000)

  it("sends NO delete-request to a connected peer (contrast with delete)", async () => {
    const bridge = new Bridge()
    const repoA = new Repo({
      identity: { name: "repoA", type: "user" },
      adapters: [new BridgeAdapter({ bridge, adapterType: "a" })],
    })
    const repoB = new Repo({
      identity: { name: "repoB", type: "user" },
      adapters: [new BridgeAdapter({ bridge, adapterType: "b" })],
    })

    const docId = "unload-no-delete"
    const docA = repoA.get(docId, StorageDocSchema)
    change(docA, draft => {
      draft.data.title.set("shared")
    })

    // Let B sync the doc from A so B is subscribed.
    const docB = repoB.get(docId, StorageDocSchema)
    await sync(docB).waitForSync({ timeout: 0 })
    await vi.runAllTimersAsync()
    expect(docB.toJSON().data.title).toBe("shared")
    expect(repoB.has(docId)).toBe(true)

    // Unload on A: B must NOT be told the doc is gone.
    await repoA.unload(docId)
    await vi.runAllTimersAsync()

    // B still holds the doc — no delete-request arrived to evict it.
    expect(repoB.has(docId)).toBe(true)
    expect(docB.toJSON().data.title).toBe("shared")
  }, 1000)

  it("re-creates docState from an inbound sync after unload", async () => {
    const bridge = new Bridge()
    const repoA = new Repo({
      identity: { name: "repoA", type: "user" },
      adapters: [new BridgeAdapter({ bridge, adapterType: "a" })],
    })
    const repoB = new Repo({
      identity: { name: "repoB", type: "user" },
      adapters: [new BridgeAdapter({ bridge, adapterType: "b" })],
    })

    const docId = "unload-inbound-recreate"
    const docA = repoA.get(docId, StorageDocSchema)
    change(docA, draft => {
      draft.data.title.set("v1")
    })

    const docB = repoB.get(docId, StorageDocSchema)
    await sync(docB).waitForSync({ timeout: 0 })
    await vi.runAllTimersAsync()

    // Unload on B, then have A make a change. B's re-get + sync should pull it.
    await repoB.unload(docId)
    expect(repoB.has(docId)).toBe(false)

    change(docA, draft => {
      draft.data.title.set("v2")
    })
    await vi.runAllTimersAsync()

    // Re-get on B recreates docState and re-syncs from A.
    const docB2 = repoB.get(docId, StorageDocSchema)
    await sync(docB2).waitForSync({ timeout: 0 })
    await vi.runAllTimersAsync()

    expect(repoB.has(docId)).toBe(true)
    expect(docB2.toJSON().data.title).toBe("v2")
  }, 1000)

  it("recovers on re-get when unloaded mid storage consult (orphaned-pending caveat)", async () => {
    const storage = new InMemoryStorageAdapter()
    const repo = new Repo({
      identity: { name: "repo", type: "user" },
      adapters: [storage],
    })
    await vi.runAllTimersAsync()

    const docId = "unload-mid-consult"
    const doc = repo.get(docId, StorageDocSchema)
    change(doc, draft => {
      draft.data.title.set("durable")
    })
    await repo.flush()
    await vi.runAllTimersAsync()

    // Evict, then re-get WITHOUT awaiting the storage consult, and unload again
    // immediately — the second unload orphans the in-flight storage consult
    // queued by the re-get (the documented caveat). A late storage sync-response
    // may then re-create docState via the snapshot path; whether or not it has
    // by this point is a race, so we don't assert on `has` here.
    await repo.unload(docId)
    repo.get(docId, StorageDocSchema)
    await repo.unload(docId)

    // The point of the caveat: regardless of the orphaned consult, the doc
    // recovers correctly on re-get because the durable chunks are still on disk.
    const docFinal = repo.get(docId, StorageDocSchema)
    await vi.runAllTimersAsync()
    await repo.flush()
    await vi.runAllTimersAsync()

    expect(docFinal.toJSON().data.title).toBe("durable")
  }, 1000)
})
