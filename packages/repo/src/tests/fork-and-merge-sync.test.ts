import {
  change,
  createTypedDoc,
  type DocShape,
  ext,
  type Frontiers,
  loro,
  replayDiff,
  Shape,
  type TypedDoc,
} from "@loro-extended/change"
import { UndoManager } from "loro-crdt"
import { afterEach, describe, expect, it } from "vitest"
import { Bridge, BridgeAdapter } from "../adapter/bridge-adapter.js"
import { Repo } from "../repo.js"

/**
 * Integration tests for fork-and-merge synchronization.
 *
 * These tests verify that the replayDiff approach correctly:
 * 1. Propagates fork-and-merge changes to peers via subscribeLocalUpdates
 * 2. Works with UndoManager for undo/redo support
 */

const DocSchema = Shape.doc({
  counter: Shape.counter(),
  data: Shape.struct({
    value: Shape.plain.string(),
  }),
})

type TestDocSchema = typeof DocSchema

/**
 * Fork-and-merge update function using replayDiff.
 * This is the pattern that enables synchronization and undo support.
 */
function createUpdate<Schema extends DocShape, Msg>(
  handler: (doc: TypedDoc<Schema>, msg: Msg) => void,
): (doc: TypedDoc<Schema>, frontier: Frontiers, msg: Msg) => Frontiers {
  return (doc, frontier, msg) => {
    // Create a shallow fork at the frontier
    const workingDoc = ext(doc).shallowForkAt(frontier, {
      preservePeerId: true,
    })

    // Capture frontier before handler execution
    const beforeFrontier = loro(workingDoc).frontiers()

    // Let handler read/write to the working doc
    handler(workingDoc, msg)

    // Get frontier after handler execution
    const afterFrontier = loro(workingDoc).frontiers()

    // Merge changes back using diff-replay (creates LOCAL events)
    const diff = loro(workingDoc).diff(beforeFrontier, afterFrontier, false)
    if (diff.length > 0) {
      replayDiff(loro(doc), diff)
      loro(doc).commit()
    }

    return loro(doc).frontiers()
  }
}

describe("fork-and-merge synchronization", () => {
  let repo1: Repo
  let repo2: Repo

  afterEach(() => {
    repo1?.synchronizer.stopHeartbeat()
    repo2?.synchronizer.stopHeartbeat()
  })

  it("should propagate fork-and-merge changes to peers", async () => {
    const bridge = new Bridge()

    repo1 = new Repo({
      identity: { name: "peer1", type: "user", peerId: "1" as `${number}` },
      adapters: [new BridgeAdapter({ adapterType: "network-1", bridge })],
    })

    repo2 = new Repo({
      identity: { name: "peer2", type: "user", peerId: "2" as `${number}` },
      adapters: [new BridgeAdapter({ adapterType: "network-2", bridge })],
    })

    await new Promise(resolve => setTimeout(resolve, 100))

    // Create documents on both repos
    const doc1 = repo1.get("doc-1", DocSchema)
    const doc2 = repo2.get("doc-1", DocSchema)

    await new Promise(resolve => setTimeout(resolve, 100))

    // Create the update function
    const update = createUpdate<TestDocSchema, { value: string }>(
      (doc, msg) => {
        change(doc, draft => {
          draft.data.value = msg.value
          draft.counter.increment(1)
        })
      },
    )

    // Apply update using fork-and-merge on peer1
    const frontier = loro(doc1).frontiers()
    update(doc1, frontier, { value: "hello from peer1" })

    // Wait for sync
    await new Promise(resolve => setTimeout(resolve, 200))

    // Verify peer2 received the changes
    expect(doc2.data.value).toBe("hello from peer1")
    expect(doc2.counter.value).toBe(1)
  })

  it("should allow undo of fork-and-merge changes", async () => {
    // Create a standalone doc with UndoManager
    const doc = createTypedDoc(DocSchema)
    // Set mergeInterval to 0 to prevent undo steps from being merged
    const undoManager = new UndoManager(loro(doc), { mergeInterval: 0 })

    // Create the update function
    const update = createUpdate<TestDocSchema, { value: string }>(
      (typedDoc, msg) => {
        change(typedDoc, draft => {
          draft.data.value = msg.value
          draft.counter.increment(1)
        })
      },
    )

    // Apply first update
    let frontier = loro(doc).frontiers()
    frontier = update(doc, frontier, { value: "first" })

    // Verify the change was applied
    expect(doc.data.value).toBe("first")
    expect(doc.counter.value).toBe(1)

    // Apply second update
    frontier = update(doc, frontier, { value: "second" })

    // Verify the second change
    expect(doc.data.value).toBe("second")
    expect(doc.counter.value).toBe(2)

    // Undo should work
    expect(undoManager.canUndo()).toBe(true)
    undoManager.undo()

    // After undo, should be back to first state
    expect(doc.data.value).toBe("first")
    expect(doc.counter.value).toBe(1)

    // Undo again
    undoManager.undo()

    // After second undo, should be back to initial state
    expect(doc.data.value).toBe("")
    expect(doc.counter.value).toBe(0)

    // Redo should work
    expect(undoManager.canRedo()).toBe(true)
    undoManager.redo()

    expect(doc.data.value).toBe("first")
    expect(doc.counter.value).toBe(1)
  })

  it("should fire subscribeLocalUpdates for fork-and-merge changes", async () => {
    const doc = createTypedDoc(DocSchema)
    const localUpdates: Uint8Array[] = []

    // Subscribe to local updates
    loro(doc).subscribeLocalUpdates(update => {
      localUpdates.push(update)
    })

    // Create the update function
    const update = createUpdate<TestDocSchema, { value: string }>(
      (typedDoc, msg) => {
        change(typedDoc, draft => {
          draft.data.value = msg.value
        })
      },
    )

    // Apply update using fork-and-merge
    const frontier = loro(doc).frontiers()
    update(doc, frontier, { value: "test" })

    // Verify local updates were fired
    expect(localUpdates.length).toBeGreaterThan(0)

    // Verify the change was applied
    expect(doc.data.value).toBe("test")
  })

  it("should sync multiple fork-and-merge updates between peers", async () => {
    const bridge = new Bridge()

    repo1 = new Repo({
      identity: { name: "peer1", type: "user", peerId: "1" as `${number}` },
      adapters: [new BridgeAdapter({ adapterType: "network-1", bridge })],
    })

    repo2 = new Repo({
      identity: { name: "peer2", type: "user", peerId: "2" as `${number}` },
      adapters: [new BridgeAdapter({ adapterType: "network-2", bridge })],
    })

    await new Promise(resolve => setTimeout(resolve, 100))

    const doc1 = repo1.get("doc-1", DocSchema)
    const doc2 = repo2.get("doc-1", DocSchema)

    await new Promise(resolve => setTimeout(resolve, 100))

    const update = createUpdate<TestDocSchema, { value: string }>(
      (doc, msg) => {
        change(doc, draft => {
          draft.data.value = msg.value
          draft.counter.increment(1)
        })
      },
    )

    // Apply multiple updates on peer1
    let frontier = loro(doc1).frontiers()
    frontier = update(doc1, frontier, { value: "update1" })
    frontier = update(doc1, frontier, { value: "update2" })
    frontier = update(doc1, frontier, { value: "update3" })

    // Wait for sync
    await new Promise(resolve => setTimeout(resolve, 300))

    // Verify peer2 received all changes
    expect(doc2.data.value).toBe("update3")
    expect(doc2.counter.value).toBe(3)
  })

  it("should handle concurrent fork-and-merge updates from both peers", async () => {
    const bridge = new Bridge()

    repo1 = new Repo({
      identity: { name: "peer1", type: "user", peerId: "1" as `${number}` },
      adapters: [new BridgeAdapter({ adapterType: "network-1", bridge })],
    })

    repo2 = new Repo({
      identity: { name: "peer2", type: "user", peerId: "2" as `${number}` },
      adapters: [new BridgeAdapter({ adapterType: "network-2", bridge })],
    })

    await new Promise(resolve => setTimeout(resolve, 100))

    const doc1 = repo1.get("doc-1", DocSchema)
    const doc2 = repo2.get("doc-1", DocSchema)

    await new Promise(resolve => setTimeout(resolve, 100))

    const update = createUpdate<TestDocSchema, { value: string }>(
      (doc, _msg) => {
        change(doc, draft => {
          draft.counter.increment(1)
        })
      },
    )

    // Apply updates concurrently from both peers
    const frontier1 = loro(doc1).frontiers()
    const frontier2 = loro(doc2).frontiers()

    update(doc1, frontier1, { value: "from-peer1" })
    update(doc2, frontier2, { value: "from-peer2" })

    // Wait for sync
    await new Promise(resolve => setTimeout(resolve, 300))

    // Both peers should have counter = 2 (both increments merged)
    expect(doc1.counter.value).toBe(2)
    expect(doc2.counter.value).toBe(2)
  })
})
