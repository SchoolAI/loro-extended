import { LoroDoc, LoroList, UndoManager } from "loro-crdt"
import { describe, expect, it } from "vitest"
import { replayDiff } from "./replay-diff.js"

describe("replayDiff", () => {
  it("should fire subscribeLocalUpdates for text changes", () => {
    // Create source doc with text changes
    const sourceDoc = new LoroDoc()
    sourceDoc.setPeerId("1")
    const sourceText = sourceDoc.getText("text")
    const beforeFrontier = sourceDoc.frontiers()

    sourceText.insert(0, "Hello World")
    const afterFrontier = sourceDoc.frontiers()

    // Get the diff
    const diff = sourceDoc.diff(beforeFrontier, afterFrontier, false)

    // Create target doc and track local updates
    const targetDoc = new LoroDoc()
    targetDoc.setPeerId("2")
    targetDoc.getText("text") // Ensure container exists

    const localUpdates: Uint8Array[] = []
    targetDoc.subscribeLocalUpdates(update => {
      localUpdates.push(update)
    })

    // Replay the diff
    replayDiff(targetDoc, diff)
    targetDoc.commit() // Commit to trigger subscribeLocalUpdates

    // Verify local updates were fired
    expect(localUpdates.length).toBeGreaterThan(0)

    // Verify the text was applied
    expect(targetDoc.getText("text").toString()).toBe("Hello World")
  })

  it("should fire subscribeLocalUpdates for map changes", () => {
    // Create source doc with map changes
    const sourceDoc = new LoroDoc()
    sourceDoc.setPeerId("1")
    const sourceMap = sourceDoc.getMap("map")
    const beforeFrontier = sourceDoc.frontiers()

    sourceMap.set("name", "Alice")
    sourceMap.set("age", 30)
    const afterFrontier = sourceDoc.frontiers()

    // Get the diff
    const diff = sourceDoc.diff(beforeFrontier, afterFrontier, false)

    // Create target doc and track local updates
    const targetDoc = new LoroDoc()
    targetDoc.setPeerId("2")
    targetDoc.getMap("map") // Ensure container exists

    const localUpdates: Uint8Array[] = []
    targetDoc.subscribeLocalUpdates(update => {
      localUpdates.push(update)
    })

    // Replay the diff
    replayDiff(targetDoc, diff)
    targetDoc.commit() // Commit to trigger subscribeLocalUpdates

    // Verify local updates were fired
    expect(localUpdates.length).toBeGreaterThan(0)

    // Verify the map was applied
    const targetMap = targetDoc.getMap("map")
    expect(targetMap.get("name")).toBe("Alice")
    expect(targetMap.get("age")).toBe(30)
  })

  it("should fire subscribeLocalUpdates for list changes", () => {
    // Create source doc with list changes
    const sourceDoc = new LoroDoc()
    sourceDoc.setPeerId("1")
    const sourceList = sourceDoc.getList("list")
    const beforeFrontier = sourceDoc.frontiers()

    sourceList.insert(0, "first")
    sourceList.insert(1, "second")
    sourceList.insert(2, "third")
    const afterFrontier = sourceDoc.frontiers()

    // Get the diff
    const diff = sourceDoc.diff(beforeFrontier, afterFrontier, false)

    // Create target doc and track local updates
    const targetDoc = new LoroDoc()
    targetDoc.setPeerId("2")
    targetDoc.getList("list") // Ensure container exists

    const localUpdates: Uint8Array[] = []
    targetDoc.subscribeLocalUpdates(update => {
      localUpdates.push(update)
    })

    // Replay the diff
    replayDiff(targetDoc, diff)
    targetDoc.commit() // Commit to trigger subscribeLocalUpdates

    // Verify local updates were fired
    expect(localUpdates.length).toBeGreaterThan(0)

    // Verify the list was applied
    const targetList = targetDoc.getList("list")
    expect(targetList.toJSON()).toEqual(["first", "second", "third"])
  })

  it("should fire subscribeLocalUpdates for counter changes", () => {
    // Create source doc with counter changes
    const sourceDoc = new LoroDoc()
    sourceDoc.setPeerId("1")
    const sourceCounter = sourceDoc.getCounter("counter")
    const beforeFrontier = sourceDoc.frontiers()

    sourceCounter.increment(5)
    const afterFrontier = sourceDoc.frontiers()

    // Get the diff
    const diff = sourceDoc.diff(beforeFrontier, afterFrontier, false)

    // Create target doc and track local updates
    const targetDoc = new LoroDoc()
    targetDoc.setPeerId("2")
    targetDoc.getCounter("counter") // Ensure container exists

    const localUpdates: Uint8Array[] = []
    targetDoc.subscribeLocalUpdates(update => {
      localUpdates.push(update)
    })

    // Replay the diff
    replayDiff(targetDoc, diff)
    targetDoc.commit() // Commit to trigger subscribeLocalUpdates

    // Verify local updates were fired
    expect(localUpdates.length).toBeGreaterThan(0)

    // Verify the counter was applied
    expect(targetDoc.getCounter("counter").toJSON()).toBe(5)
  })

  it("should work with UndoManager", () => {
    // Create source doc with changes
    const sourceDoc = new LoroDoc()
    sourceDoc.setPeerId("1")
    const sourceText = sourceDoc.getText("text")
    const beforeFrontier = sourceDoc.frontiers()

    sourceText.insert(0, "Hello")
    const afterFrontier = sourceDoc.frontiers()

    // Get the diff
    const diff = sourceDoc.diff(beforeFrontier, afterFrontier, false)

    // Create target doc with UndoManager
    const targetDoc = new LoroDoc()
    targetDoc.setPeerId("2")
    const targetText = targetDoc.getText("text")

    const undoManager = new UndoManager(targetDoc, {})

    // Replay the diff
    replayDiff(targetDoc, diff)
    targetDoc.commit()

    // Verify the text was applied
    expect(targetText.toString()).toBe("Hello")

    // Undo should work
    const canUndo = undoManager.canUndo()
    expect(canUndo).toBe(true)

    undoManager.undo()
    expect(targetText.toString()).toBe("")
  })

  it("should handle nested containers", () => {
    // Create source doc with nested containers
    const sourceDoc = new LoroDoc()
    sourceDoc.setPeerId("1")
    const sourceMap = sourceDoc.getMap("root")
    const beforeFrontier = sourceDoc.frontiers()

    // Create a nested structure: map -> list -> text
    const nestedList = sourceMap.setContainer("items", new LoroList())
    nestedList.insert(0, "item1")
    nestedList.insert(1, "item2")

    const afterFrontier = sourceDoc.frontiers()

    // Get the diff
    const diff = sourceDoc.diff(beforeFrontier, afterFrontier, false)

    // Create target doc and track local updates
    const targetDoc = new LoroDoc()
    targetDoc.setPeerId("2")
    targetDoc.getMap("root") // Ensure container exists

    const localUpdates: Uint8Array[] = []
    targetDoc.subscribeLocalUpdates(update => {
      localUpdates.push(update)
    })

    // Replay the diff
    replayDiff(targetDoc, diff)
    targetDoc.commit() // Commit to trigger subscribeLocalUpdates

    // Verify local updates were fired
    expect(localUpdates.length).toBeGreaterThan(0)

    // Verify the nested structure was applied
    const targetMap = targetDoc.getMap("root")
    const items = targetMap.get("items") as LoroList
    expect(items).toBeDefined()
    expect(items.toJSON()).toEqual(["item1", "item2"])
  })

  it("should handle map deletions", () => {
    // Create source doc with initial state
    const sourceDoc = new LoroDoc()
    sourceDoc.setPeerId("1")
    const sourceMap = sourceDoc.getMap("map")
    sourceMap.set("keep", "value1")
    sourceMap.set("remove", "value2")

    const beforeFrontier = sourceDoc.frontiers()

    // Delete a key
    sourceMap.delete("remove")
    const afterFrontier = sourceDoc.frontiers()

    // Get the diff
    const diff = sourceDoc.diff(beforeFrontier, afterFrontier, false)

    // Create target doc with same initial state
    const targetDoc = new LoroDoc()
    targetDoc.setPeerId("2")
    const targetMap = targetDoc.getMap("map")
    targetMap.set("keep", "value1")
    targetMap.set("remove", "value2")

    const localUpdates: Uint8Array[] = []
    targetDoc.subscribeLocalUpdates(update => {
      localUpdates.push(update)
    })

    // Replay the diff
    replayDiff(targetDoc, diff)
    targetDoc.commit() // Commit to trigger subscribeLocalUpdates

    // Verify local updates were fired
    expect(localUpdates.length).toBeGreaterThan(0)

    // Verify the deletion was applied
    expect(targetMap.get("keep")).toBe("value1")
    expect(targetMap.get("remove")).toBeUndefined()
  })

  it("should handle list deletions", () => {
    // Create source doc with initial state
    const sourceDoc = new LoroDoc()
    sourceDoc.setPeerId("1")
    const sourceList = sourceDoc.getList("list")
    sourceList.insert(0, "a")
    sourceList.insert(1, "b")
    sourceList.insert(2, "c")

    const beforeFrontier = sourceDoc.frontiers()

    // Delete middle element
    sourceList.delete(1, 1)
    const afterFrontier = sourceDoc.frontiers()

    // Get the diff
    const diff = sourceDoc.diff(beforeFrontier, afterFrontier, false)

    // Create target doc with same initial state
    const targetDoc = new LoroDoc()
    targetDoc.setPeerId("2")
    const targetList = targetDoc.getList("list")
    targetList.insert(0, "a")
    targetList.insert(1, "b")
    targetList.insert(2, "c")

    const localUpdates: Uint8Array[] = []
    targetDoc.subscribeLocalUpdates(update => {
      localUpdates.push(update)
    })

    // Replay the diff
    replayDiff(targetDoc, diff)
    targetDoc.commit() // Commit to trigger subscribeLocalUpdates

    // Verify local updates were fired
    expect(localUpdates.length).toBeGreaterThan(0)

    // Verify the deletion was applied
    expect(targetList.toJSON()).toEqual(["a", "c"])
  })

  it("should handle counter decrement", () => {
    // Create source doc with initial counter value
    const sourceDoc = new LoroDoc()
    sourceDoc.setPeerId("1")
    const sourceCounter = sourceDoc.getCounter("counter")
    sourceCounter.increment(10)

    const beforeFrontier = sourceDoc.frontiers()

    // Decrement
    sourceCounter.decrement(3)
    const afterFrontier = sourceDoc.frontiers()

    // Get the diff
    const diff = sourceDoc.diff(beforeFrontier, afterFrontier, false)

    // Create target doc with same initial state
    const targetDoc = new LoroDoc()
    targetDoc.setPeerId("2")
    const targetCounter = targetDoc.getCounter("counter")
    targetCounter.increment(10)

    const localUpdates: Uint8Array[] = []
    targetDoc.subscribeLocalUpdates(update => {
      localUpdates.push(update)
    })

    // Replay the diff
    replayDiff(targetDoc, diff)
    targetDoc.commit() // Commit to trigger subscribeLocalUpdates

    // Verify local updates were fired
    expect(localUpdates.length).toBeGreaterThan(0)

    // Verify the decrement was applied
    expect(targetCounter.toJSON()).toBe(7)
  })

  it("should handle text with attributes", () => {
    // Create source doc with rich text
    const sourceDoc = new LoroDoc()
    sourceDoc.setPeerId("1")
    sourceDoc.configTextStyle({ bold: { expand: "after" } })
    const sourceText = sourceDoc.getText("text")
    const beforeFrontier = sourceDoc.frontiers()

    sourceText.insert(0, "Hello World")
    sourceText.mark({ start: 0, end: 5 }, "bold", true)
    const afterFrontier = sourceDoc.frontiers()

    // Get the diff
    const diff = sourceDoc.diff(beforeFrontier, afterFrontier, false)

    // Create target doc
    const targetDoc = new LoroDoc()
    targetDoc.setPeerId("2")
    targetDoc.configTextStyle({ bold: { expand: "after" } })
    targetDoc.getText("text") // Ensure container exists

    const localUpdates: Uint8Array[] = []
    targetDoc.subscribeLocalUpdates(update => {
      localUpdates.push(update)
    })

    // Replay the diff
    replayDiff(targetDoc, diff)
    targetDoc.commit() // Commit to trigger subscribeLocalUpdates

    // Verify local updates were fired
    expect(localUpdates.length).toBeGreaterThan(0)

    // Verify the text was applied
    const targetText = targetDoc.getText("text")
    expect(targetText.toString()).toBe("Hello World")

    // Verify the delta includes the bold attribute
    const delta = targetText.toDelta()
    expect(delta[0]).toMatchObject({
      insert: "Hello",
      attributes: { bold: true },
    })
  })
})
