import { describe, expect, it } from "vitest"
import { change } from "../functional-helpers.js"
import { Shape } from "../shape.js"
import { createTypedDoc } from "../typed-doc.js"

// Define the state machine schema from the plan
const StateNodeDataShape = Shape.struct({
  name: Shape.text(),
  facts: Shape.record(Shape.plain.any()),
  rules: Shape.list(
    Shape.plain.struct({
      name: Shape.plain.string(),
      rego: Shape.plain.string(),
      description: Shape.plain.string().nullable(),
    }),
  ),
})

const ResmSchema = Shape.doc({
  states: Shape.tree(StateNodeDataShape),
  currentPath: Shape.list(Shape.plain.string()),
  input: Shape.record(Shape.plain.any()),
})

describe("TreeRef", () => {
  describe("basic operations", () => {
    it("should create a root node with typed data", () => {
      const typedDoc = createTypedDoc(ResmSchema)

      change(typedDoc, draft => {
        const root = draft.states.createNode()
        expect(root).toBeDefined()
        expect(root.id).toBeDefined()
      })
    })

    it("should create a root node and set data", () => {
      const typedDoc = createTypedDoc(ResmSchema)

      change(typedDoc, draft => {
        const root = draft.states.createNode()
        // Set data after creation
        root.data.name.insert(0, "idle")
      })

      // Verify the data was set
      const json = typedDoc.toJSON()
      expect(json.states).toHaveLength(1)
      expect(json.states[0].data.name).toBe("idle")
    })

    it("should create child nodes", () => {
      const typedDoc = createTypedDoc(ResmSchema)

      change(typedDoc, draft => {
        const root = draft.states.createNode()
        root.data.name.insert(0, "idle")

        const child = root.createNode()
        child.data.name.insert(0, "running")
      })

      const json = typedDoc.toJSON()
      expect(json.states).toHaveLength(1)
      expect(json.states[0].data.name).toBe("idle")
      expect(json.states[0].children).toHaveLength(1)
      expect(json.states[0].children[0].data.name).toBe("running")
    })

    it("should access node.data with type safety", () => {
      const typedDoc = createTypedDoc(ResmSchema)

      change(typedDoc, draft => {
        const root = draft.states.createNode()
        root.data.name.insert(0, "idle")

        // Access nested list container
        root.data.rules.push({
          name: "rule1",
          rego: "package test",
          description: null,
        })
      })

      const json = typedDoc.toJSON()
      expect(json.states[0].data.name).toBe("idle")
      expect(json.states[0].data.rules).toEqual([
        { name: "rule1", rego: "package test", description: null },
      ])
    })

    it("should access record containers in node.data", () => {
      const typedDoc = createTypedDoc(ResmSchema)

      change(typedDoc, draft => {
        const root = draft.states.createNode()
        root.data.name.insert(0, "idle")

        // Access nested record container - use set method
        const facts = root.data.facts
        facts.set("key1", "value1")
      })

      const json = typedDoc.toJSON()
      expect(json.states[0].data.name).toBe("idle")
      expect(json.states[0].data.facts).toEqual({ key1: "value1" })
    })
  })

  describe("tree navigation", () => {
    it("should get roots", () => {
      const typedDoc = createTypedDoc(ResmSchema)

      change(typedDoc, draft => {
        draft.states.createNode()
        draft.states.createNode()
      })

      change(typedDoc, draft => {
        const roots = draft.states.roots()
        expect(roots).toHaveLength(2)
      })
    })

    it("should get all nodes", () => {
      const typedDoc = createTypedDoc(ResmSchema)

      change(typedDoc, draft => {
        const root = draft.states.createNode()
        root.createNode()
        root.createNode()
      })

      change(typedDoc, draft => {
        const nodes = draft.states.nodes()
        expect(nodes).toHaveLength(3) // 1 root + 2 children
      })
    })

    it("should navigate parent/children relationships", () => {
      const typedDoc = createTypedDoc(ResmSchema)

      let rootId: string | undefined
      let childId: string | undefined

      change(typedDoc, draft => {
        const root = draft.states.createNode()
        root.data.name.insert(0, "root")
        rootId = root.id

        const child = root.createNode()
        child.data.name.insert(0, "child")
        childId = child.id
      })

      change(typedDoc, draft => {
        const root = draft.states.getNodeByID(rootId as string)
        expect(root).toBeDefined()
        expect(root?.children()).toHaveLength(1)

        const child = draft.states.getNodeByID(childId as string)
        expect(child).toBeDefined()
        expect(child?.parent()?.id).toBe(rootId)
      })
    })

    it("should get node by ID", () => {
      const typedDoc = createTypedDoc(ResmSchema)

      let nodeId: string | undefined

      change(typedDoc, draft => {
        const root = draft.states.createNode()
        root.data.name.insert(0, "test")
        nodeId = root.id
      })

      change(typedDoc, draft => {
        const node = draft.states.getNodeByID(nodeId as string)
        expect(node).toBeDefined()
        expect(node?.data.name.toString()).toBe("test")
      })
    })

    it("should check if node exists with has()", () => {
      const typedDoc = createTypedDoc(ResmSchema)

      let nodeId: string | undefined

      change(typedDoc, draft => {
        const root = draft.states.createNode()
        nodeId = root.id
      })

      change(typedDoc, draft => {
        expect(draft.states.has(nodeId as string)).toBe(true)
        expect(draft.states.has("0@999" as any)).toBe(false)
      })
    })
  })

  describe("tree mutations", () => {
    it("should delete a node", () => {
      const typedDoc = createTypedDoc(ResmSchema)

      let nodeId: string | undefined

      change(typedDoc, draft => {
        const root = draft.states.createNode()
        nodeId = root.id
      })

      change(typedDoc, draft => {
        draft.states.delete(nodeId as string)
      })

      const json = typedDoc.toJSON()
      expect(json.states).toHaveLength(0)
    })

    it("should move nodes between parents", () => {
      const typedDoc = createTypedDoc(ResmSchema)

      let root1Id: string | undefined
      let root2Id: string | undefined
      let childId: string | undefined

      change(typedDoc, draft => {
        const root1 = draft.states.createNode()
        root1.data.name.insert(0, "root1")
        root1Id = root1.id

        const root2 = draft.states.createNode()
        root2.data.name.insert(0, "root2")
        root2Id = root2.id

        const child = root1.createNode()
        child.data.name.insert(0, "child")
        childId = child.id
      })

      // Move child from root1 to root2
      change(typedDoc, draft => {
        const child = draft.states.getNodeByID(childId as string)
        const root2 = draft.states.getNodeByID(root2Id as string)
        if (child && root2) {
          child.move(root2)
        }
      })

      change(typedDoc, draft => {
        const root1 = draft.states.getNodeByID(root1Id as string)
        const root2 = draft.states.getNodeByID(root2Id as string)

        expect(root1?.children()).toHaveLength(0)
        expect(root2?.children()).toHaveLength(1)
      })
    })
  })

  describe("serialization", () => {
    it("should serialize tree to nested JSON with toJSON()", () => {
      const typedDoc = createTypedDoc(ResmSchema)

      change(typedDoc, draft => {
        const root = draft.states.createNode()
        root.data.name.insert(0, "root")

        const child1 = root.createNode()
        child1.data.name.insert(0, "child1")

        const child2 = root.createNode()
        child2.data.name.insert(0, "child2")

        const grandchild = child1.createNode()
        grandchild.data.name.insert(0, "grandchild")
      })

      const json = typedDoc.toJSON()
      expect(json.states).toHaveLength(1)
      expect(json.states[0].data.name).toBe("root")
      expect(json.states[0].children).toHaveLength(2)
      expect(json.states[0].children[0].children).toHaveLength(1)
    })

    it("should serialize tree to flat array with toArray()", () => {
      const typedDoc = createTypedDoc(ResmSchema)

      change(typedDoc, draft => {
        const root = draft.states.createNode()
        root.data.name.insert(0, "root")

        const child = root.createNode()
        child.data.name.insert(0, "child")
      })

      change(typedDoc, draft => {
        const array = draft.states.toArray()
        expect(array).toHaveLength(2)
        // Each item should have id, parent, index, fractionalIndex, data
        expect(array[0]).toHaveProperty("id")
        expect(array[0]).toHaveProperty("parent")
        expect(array[0]).toHaveProperty("index")
        expect(array[0]).toHaveProperty("data")
      })
    })
  })

  describe("fractional index", () => {
    it("should enable fractional index", () => {
      const typedDoc = createTypedDoc(ResmSchema)

      change(typedDoc, draft => {
        draft.states.enableFractionalIndex(8)
        const root = draft.states.createNode()
        expect(root.fractionalIndex()).toBeDefined()
      })
    })

    it("should get node index among siblings", () => {
      const typedDoc = createTypedDoc(ResmSchema)

      change(typedDoc, draft => {
        const root = draft.states.createNode()
        const child1 = root.createNode()
        const child2 = root.createNode()

        expect(child1.index()).toBe(0)
        expect(child2.index()).toBe(1)
      })
    })
  })

  describe("absorbPlainValues", () => {
    it("should propagate absorbPlainValues to all nodes", () => {
      const typedDoc = createTypedDoc(ResmSchema)

      change(typedDoc, draft => {
        const root = draft.states.createNode()
        root.data.name.insert(0, "test")
        root.data.rules.push({
          name: "rule1",
          rego: "package test",
          description: null,
        })

        // absorbPlainValues is called automatically at the end of change()
      })

      // Verify data was persisted
      const json = typedDoc.toJSON()
      expect(json.states[0].data.name).toBe("test")
      expect(json.states[0].data.rules).toEqual([
        { name: "rule1", rego: "package test", description: null },
      ])
    })
  })

  describe("node deletion tracking", () => {
    it("should track deleted nodes with isDeleted()", () => {
      const typedDoc = createTypedDoc(ResmSchema)

      let nodeId: string | undefined

      change(typedDoc, draft => {
        const root = draft.states.createNode()
        nodeId = root.id
      })

      change(typedDoc, draft => {
        const node = draft.states.getNodeByID(nodeId as string)
        if (node) {
          expect(node.isDeleted()).toBe(false)
          draft.states.delete(nodeId as string)
        }
      })

      // After deletion, Loro's has() still returns true (node exists in history)
      // but isDeleted() returns true and the node won't appear in toJSON()
      const json = typedDoc.toJSON()
      expect(json.states).toHaveLength(0)
    })
  })
})
