import { describe, expect, it } from "vitest"
import { loro } from "../loro.js"
import { Shape } from "../shape.js"
import { createTypedDoc } from "../typed-doc.js"

describe("TreeRef loro() support", () => {
  it("should support loro() on TreeRef property", () => {
    const StateNodeDataShape = Shape.struct({
      name: Shape.plain.string(),
    })

    const Schema = Shape.doc({
      states: Shape.tree(StateNodeDataShape),
    })

    const doc = createTypedDoc(Schema)

    // This should compile and run without error
    const treeLoro = loro(doc.states)

    expect(treeLoro).toBeDefined()
    expect(treeLoro.doc).toBeDefined()
    expect(treeLoro.container).toBeDefined()
    expect(typeof treeLoro.subscribe).toBe("function")
  })

  it("should support loro() on TreeNodeRef", () => {
    const StateNodeDataShape = Shape.struct({
      name: Shape.plain.string(),
    })

    const Schema = Shape.doc({
      states: Shape.tree(StateNodeDataShape),
    })

    const doc = createTypedDoc(Schema)

    doc.change(draft => {
      const root = draft.states.createNode({ name: "root" })

      // This should compile and run without error
      const nodeLoro = loro(root)

      expect(nodeLoro).toBeDefined()
      expect(nodeLoro.doc).toBeDefined()
      expect(nodeLoro.container).toBeDefined()
      // subscribe might be a no-op or undefined depending on LoroTreeNode support
      // but the method should exist on the interface
      expect(typeof nodeLoro.subscribe).toBe("function")
    })
  })
})
