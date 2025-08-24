import type { Patch } from "mutative"
import { describe, expect, it } from "vitest"
import { makeMutableUpdate } from "./make-mutable-update.js"

// Simple test types
type TestMessage =
  | { type: "increment" }
  | { type: "decrement" }
  | { type: "set"; value: number }

type TestModel = {
  count: number
  history: string[]
}

type TestCommand = { type: "log"; message: string }

// Simple mutative update function for testing
function testUpdateMutative(
  msg: TestMessage,
  model: TestModel,
): TestCommand | undefined {
  switch (msg.type) {
    case "increment":
      model.count += 1
      model.history.push("incremented")
      return { type: "log", message: `Count is now ${model.count}` }

    case "decrement":
      model.count -= 1
      model.history.push("decremented")
      return { type: "log", message: `Count is now ${model.count}` }

    case "set": {
      const oldValue = model.count
      model.count = msg.value
      model.history.push(`set from ${oldValue} to ${msg.value}`)
      return { type: "log", message: `Count set to ${model.count}` }
    }

    default:
      return undefined
  }
}

describe("makeMutableUpdate", () => {
  it("should transform mutative update to raj-compatible update", () => {
    const patches: Patch[] = []
    const onPatch = (newPatches: Patch[]) => {
      patches.push(...newPatches)
    }

    const rajUpdate = makeMutableUpdate(testUpdateMutative, onPatch)

    const initialModel: TestModel = {
      count: 0,
      history: [],
    }

    // Test increment
    const [newModel1, command1] = rajUpdate({ type: "increment" }, initialModel)

    expect(newModel1.count).toBe(1)
    expect(newModel1.history).toEqual(["incremented"])
    expect(command1).toEqual({ type: "log", message: "Count is now 1" })
    expect(patches.length).toBeGreaterThan(0)

    // Test that original model is unchanged
    expect(initialModel.count).toBe(0)
    expect(initialModel.history).toEqual([])

    // Test decrement
    const [newModel2, command2] = rajUpdate({ type: "decrement" }, newModel1)

    expect(newModel2.count).toBe(0)
    expect(newModel2.history).toEqual(["incremented", "decremented"])
    expect(command2).toEqual({ type: "log", message: "Count is now 0" })

    // Test set
    const [newModel3, command3] = rajUpdate(
      { type: "set", value: 42 },
      newModel2,
    )

    expect(newModel3.count).toBe(42)
    expect(newModel3.history).toEqual([
      "incremented",
      "decremented",
      "set from 0 to 42",
    ])
    expect(command3).toEqual({ type: "log", message: "Count set to 42" })
  })

  it("should work without patch callback", () => {
    const rajUpdate = makeMutableUpdate(testUpdateMutative)

    const initialModel: TestModel = {
      count: 5,
      history: [],
    }

    const [newModel, command] = rajUpdate({ type: "increment" }, initialModel)

    expect(newModel.count).toBe(6)
    expect(newModel.history).toEqual(["incremented"])
    expect(command).toEqual({ type: "log", message: "Count is now 6" })

    // Original model should be unchanged
    expect(initialModel.count).toBe(5)
    expect(initialModel.history).toEqual([])
  })

  it("should handle undefined commands", () => {
    const mutativeUpdate = (
      msg: TestMessage,
      model: TestModel,
    ): TestCommand | undefined => {
      // This update function doesn't return commands
      model.count += 1
      return
    }

    const rajUpdate = makeMutableUpdate(mutativeUpdate)

    const initialModel: TestModel = {
      count: 0,
      history: [],
    }

    const [newModel, command] = rajUpdate({ type: "increment" }, initialModel)

    expect(newModel.count).toBe(1)
    expect(command).toBeUndefined()
  })

  it("should generate patches for complex state changes", () => {
    const patches: Patch[] = []
    const onPatch = (newPatches: Patch[]) => {
      patches.push(...newPatches)
    }

    const rajUpdate = makeMutableUpdate(testUpdateMutative, onPatch)

    const initialModel: TestModel = {
      count: 0,
      history: [],
    }

    // Clear patches from previous tests
    patches.length = 0

    rajUpdate({ type: "set", value: 100 }, initialModel)

    // Should have patches for both count and history changes
    expect(patches.length).toBeGreaterThan(0)

    // Check that patches contain the expected operations
    const countPatch = patches.find(p => p.path[0] === "count")
    const historyPatch = patches.find(p => p.path[0] === "history")

    expect(countPatch).toBeDefined()
    expect(historyPatch).toBeDefined()
  })
})
