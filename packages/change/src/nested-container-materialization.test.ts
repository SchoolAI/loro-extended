import { describe, expect, it } from "vitest"
import { convertInputToRef } from "./conversion.js"
import { createTypedDoc, loro, Shape, value } from "./index.js"

describe("Nested Container Materialization", () => {
  it("syncs correctly between peers when struct has nested empty record", () => {
    // Define a schema with a nested map
    const schema = Shape.doc({
      items: Shape.record(
        Shape.struct({
          id: Shape.plain.string(),
          metadata: Shape.record(Shape.struct({ key: Shape.plain.string() })), // Nested map of structs
        }),
      ),
    })

    // Create two separate documents (simulating two peers)
    const clientDoc = createTypedDoc(schema)
    const serverDoc = createTypedDoc(schema)

    // Client creates an item with empty nested map
    clientDoc.items.set("item-1", {
      id: "item-1",
      metadata: {}, // Empty nested map - BUG: may not materialize properly
    })

    // Sync client -> server
    const clientSnapshot = loro(clientDoc).export({ mode: "snapshot" })
    loro(serverDoc).import(clientSnapshot)

    // Server writes to the nested map
    const serverEntry = serverDoc.items.get("item-1")
    expect(serverEntry).toBeDefined()
    serverEntry?.metadata.set("entry-1", { key: "value" })

    // Sync server -> client
    const serverUpdate = loro(serverDoc).export({
      mode: "update",
      from: loro(clientDoc).version(),
    })
    loro(clientDoc).import(serverUpdate)

    // BUG: Client's metadata is EMPTY!
    const clientEntry = clientDoc.items.get("item-1")
    expect(clientEntry?.metadata.toJSON()).toEqual({
      "entry-1": { key: "value" },
    })
  })

  it("handles concurrent creation of nested containers", () => {
    const schema = Shape.doc({
      items: Shape.record(
        Shape.struct({
          id: Shape.plain.string(),
          metadata: Shape.record(Shape.plain.string()),
        }),
      ),
    })

    const doc1 = createTypedDoc(schema)
    const doc2 = createTypedDoc(schema)

    // Peer 1 creates item with empty metadata
    doc1.items.set("item-1", {
      id: "item-1",
      metadata: {},
    })

    // Sync 1 -> 2
    loro(doc2).import(loro(doc1).export({ mode: "snapshot" }))

    // Peer 1 writes to metadata
    doc1.items.get("item-1")?.metadata.set("p1", "v1")

    // Peer 2 writes to metadata (concurrently)
    doc2.items.get("item-1")?.metadata.set("p2", "v2")

    // Sync 1 -> 2
    loro(doc2).import(
      loro(doc1).export({ mode: "update", from: loro(doc2).version() }),
    )

    // Sync 2 -> 1
    loro(doc1).import(
      loro(doc2).export({ mode: "update", from: loro(doc1).version() }),
    )

    // Both should have both values
    const json1 = doc1.items.get("item-1")?.metadata.toJSON()
    const json2 = doc2.items.get("item-1")?.metadata.toJSON()

    console.log("JSON1", json1)
    console.log("JSON2", json2)

    expect(json1).toEqual({ p1: "v1", p2: "v2" })
    expect(json2).toEqual({ p1: "v1", p2: "v2" })
  })

  it("materializes nested containers in Tree nodes", () => {
    const schema = Shape.doc({
      tree: Shape.tree(
        Shape.struct({
          id: Shape.plain.string(),
          tags: Shape.record(Shape.plain.boolean()),
        }),
      ),
    })

    const doc1 = createTypedDoc(schema)
    const doc2 = createTypedDoc(schema)

    // Create a node with empty tags
    const node = doc1.tree.createNode({
      id: "node-1",
      tags: {},
    })

    // Get the node ID for lookup
    const nodeId = loro(node).id

    // Sync 1 -> 2
    loro(doc2).import(loro(doc1).export({ mode: "snapshot" }))

    // Verify the container exists in doc1
    const tags = node.data.tags
    expect(tags).toBeDefined()

    // Verify it's materialized by checking if we can get its container ID
    const tagsContainer = loro(tags)
    expect(tagsContainer).toBeDefined()

    // Now check doc2 using getNodeByID
    const tree2 = loro(doc2.tree)
    const node2 = tree2.getNodeByID(nodeId)

    expect(node2).toBeDefined()
    if (node2) {
      const data = node2.data // LoroMap
      const tagsMap = data.get("tags") // Should be LoroMap
      expect(tagsMap).toBeDefined()
      // @ts-expect-error - kind() exists at runtime
      expect(tagsMap.kind()).toBe("Map")
    }
  })

  it("handles missing containers gracefully (schema evolution)", async () => {
    // Simulate an old document that doesn't have a nested container
    const { LoroDoc } = await import("loro-crdt")
    const oldDoc = new LoroDoc()
    const map = oldDoc.getMap("root")
    map.set("existing", "value")
    // "newField" is missing
    oldDoc.commit()

    // Load with new schema that expects "newField" as a container
    const schema = Shape.doc({
      root: Shape.struct({
        existing: Shape.plain.string(),
        newField: Shape.record(Shape.plain.string()),
      }),
    })

    const doc = createTypedDoc(schema)
    loro(doc).import(oldDoc.export({ mode: "snapshot" }))

    // Access missing container
    const root = doc.root
    // Should not crash
    expect(value(root.existing)).toBe("value")

    // Accessing the missing container ref should work (it creates the wrapper)
    const newField = root.newField
    expect(newField).toBeDefined()

    // But the underlying container doesn't exist yet?
    // getOrCreateRef creates the wrapper.
    // The wrapper's getContainer() calls getOrCreateContainer().

    // If we read from it:
    expect(newField.keys()).toEqual([])

    // If we write to it:
    newField.set("k", "v")

    // It should create the container lazily (or eagerly on set)
    expect(value(newField.get("k"))).toBe("v")

    // Verify in raw doc
    const rawMap = loro(doc).getMap("root")
    const rawNewField = rawMap.get("newField")
    expect(rawNewField).toBeDefined()
  })

  // Task 1.2: Test struct with deeply nested empty containers
  it("materializes all levels of deeply nested structs", () => {
    const schema = Shape.doc({
      root: Shape.struct({
        level1: Shape.struct({
          level2: Shape.struct({
            level3: Shape.record(Shape.plain.string()),
          }),
        }),
      }),
    })

    const doc1 = createTypedDoc(schema)
    const doc2 = createTypedDoc(schema)

    // Initialize with empty nested structure - all levels should materialize
    // Note: For structs, we need to access them to trigger materialization
    // since the doc root is created lazily
    const _root = doc1.root
    const _level1 = doc1.root.level1
    const _level2 = doc1.root.level1.level2
    const _level3 = doc1.root.level1.level2.level3

    // Sync doc1 -> doc2
    loro(doc2).import(loro(doc1).export({ mode: "snapshot" }))

    // Peer 2 writes to the deeply nested container
    doc2.root.level1.level2.level3.set("deep-key", "deep-value")

    // Sync doc2 -> doc1
    loro(doc1).import(
      loro(doc2).export({ mode: "update", from: loro(doc1).version() }),
    )

    // Verify the deeply nested value is visible in doc1
    expect(value(doc1.root.level1.level2.level3.get("deep-key"))).toBe(
      "deep-value",
    )
  })

  // Task 1.3: Test list push with nested empty container
  it("materializes nested containers when pushing to list", () => {
    const schema = Shape.doc({
      items: Shape.list(
        Shape.struct({
          id: Shape.plain.string(),
          metadata: Shape.record(Shape.plain.string()),
        }),
      ),
    })

    const doc1 = createTypedDoc(schema)
    const doc2 = createTypedDoc(schema)

    // Push an item with empty nested metadata
    doc1.items.push({
      id: "item-1",
      metadata: {},
    })

    // Sync doc1 -> doc2
    loro(doc2).import(loro(doc1).export({ mode: "snapshot" }))

    // Peer 2 writes to the nested metadata
    const item = doc2.items[0]
    expect(item).toBeDefined()
    item?.metadata.set("key", "value")

    // Sync doc2 -> doc1
    loro(doc1).import(
      loro(doc2).export({ mode: "update", from: loro(doc1).version() }),
    )

    // Verify the nested value is visible in doc1
    expect(value(doc1.items[0]?.metadata.get("key"))).toBe("value")
  })

  // Task 1.5: Test conversion API with nested empty container
  it("convertInputToRef creates containers for empty nested values", async () => {
    const loroCrdt = await import("loro-crdt")

    const structShape = Shape.struct({
      id: Shape.plain.string(),
      nested: Shape.record(Shape.plain.string()),
    })

    // Convert a plain object with empty nested record
    const result = convertInputToRef({ id: "test", nested: {} }, structShape)

    // Result should be a LoroMap
    expect(result).toBeInstanceOf(loroCrdt.LoroMap)

    // The nested field should also be a LoroMap (not undefined or plain object)
    const nestedContainer = (result as typeof loroCrdt.LoroMap.prototype).get(
      "nested",
    )
    expect(nestedContainer).toBeDefined()
    expect(nestedContainer).toBeInstanceOf(loroCrdt.LoroMap)
  })

  // Tree Node Full Sync Test (from test-plan)
  it("syncs nested containers in Tree nodes between peers", () => {
    const schema = Shape.doc({
      tree: Shape.tree(
        Shape.struct({
          id: Shape.plain.string(),
          tags: Shape.record(Shape.plain.boolean()),
        }),
      ),
    })

    const doc1 = createTypedDoc(schema)
    const doc2 = createTypedDoc(schema)

    // Create a node with empty tags in doc1
    const node = doc1.tree.createNode({
      id: "node-1",
      tags: {},
    })

    // Get the node ID for later lookup
    const nodeId = loro(node).id

    // Sync doc1 -> doc2
    loro(doc2).import(loro(doc1).export({ mode: "snapshot" }))

    // Peer 2 writes to tags using raw Loro API (since TreeRef doesn't expose get by ID)
    const tree2 = loro(doc2.tree)
    const node2Raw = tree2.getNodeByID(nodeId)
    expect(node2Raw).toBeDefined()
    if (node2Raw) {
      const data2 = node2Raw.data as any
      const tags2 = data2.get("tags") as any
      tags2.set("important", true)
    }

    // Sync doc2 -> doc1
    loro(doc1).import(
      loro(doc2).export({ mode: "update", from: loro(doc1).version() }),
    )

    // Verify the tag is visible in doc1's node
    expect(value(node.data.tags.get("important"))).toBe(true)
  })
})
