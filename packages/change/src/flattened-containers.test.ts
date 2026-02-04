/**
 * Tests to validate assumptions about flattened container approach for mergeable containers.
 *
 * Key assumptions to test:
 * 1. Root container names can contain path-like separators (NOT "/" - Loro forbids it)
 * 2. Root containers survive applyDiff (IDs are preserved)
 * 3. Two peers creating the same root container get the same ID
 * 4. Nested containers created via applyDiff get remapped (the problem we're solving)
 */

import { LoroDoc, LoroList } from "loro-crdt"
import { describe, expect, it } from "vitest"

describe("Flattened Container Assumptions", () => {
  describe("Root container naming - forbidden characters", () => {
    it("should NOT allow / in root container names", () => {
      const doc = new LoroDoc()

      // "/" is explicitly forbidden by Loro
      expect(() => doc.getMap("data/nested")).toThrow(
        "Invalid root container name",
      )
    })

    it("should NOT allow null character in root container names", () => {
      const doc = new LoroDoc()

      // "\0" is explicitly forbidden by Loro
      expect(() => doc.getMap("data\0nested")).toThrow(
        "Invalid root container name",
      )
    })
  })

  describe("Root container naming - alternative separators", () => {
    it("should allow . (dot) as path separator", () => {
      const doc = new LoroDoc()

      const map = doc.getMap("data.nested.struct")
      const list = doc.getList("data.nested.items")
      const text = doc.getText("data.nested.content")

      expect(map.id).toBe("cid:root-data.nested.struct:Map")
      expect(list.id).toBe("cid:root-data.nested.items:List")
      expect(text.id).toBe("cid:root-data.nested.content:Text")
    })

    it("should allow : (colon) as path separator", () => {
      const doc = new LoroDoc()

      const map = doc.getMap("data:nested:struct")
      const list = doc.getList("data:nested:items")

      expect(map.id).toBe("cid:root-data:nested:struct:Map")
      expect(list.id).toBe("cid:root-data:nested:items:List")
    })

    it("should allow | (pipe) as path separator", () => {
      const doc = new LoroDoc()

      const map = doc.getMap("data|nested|struct")
      const list = doc.getList("data|nested|items")

      expect(map.id).toBe("cid:root-data|nested|struct:Map")
      expect(list.id).toBe("cid:root-data|nested|items:List")
    })

    it("should allow ~ (tilde) as path separator", () => {
      const doc = new LoroDoc()

      const map = doc.getMap("data~nested~struct")
      const list = doc.getList("data~nested~items")

      expect(map.id).toBe("cid:root-data~nested~struct:Map")
      expect(list.id).toBe("cid:root-data~nested~items:List")
    })

    it("should allow -> (arrow) as path separator", () => {
      const doc = new LoroDoc()

      const map = doc.getMap("data->nested->struct")
      const list = doc.getList("data->nested->items")

      expect(map.id).toBe("cid:root-data->nested->struct:Map")
      expect(list.id).toBe("cid:root-data->nested->items:List")
    })

    it("should allow - (hyphen) as path separator", () => {
      const doc = new LoroDoc()

      // Using hyphen follows the existing root-{name} pattern
      const map = doc.getMap("data-nested-struct")
      const list = doc.getList("data-nested-items")

      // Note: This creates IDs like cid:root-data-nested-struct:Map
      // which is consistent with Loro's existing naming convention
      expect(map.id).toBe("cid:root-data-nested-struct:Map")
      expect(list.id).toBe("cid:root-data-nested-items:List")
    })
  })

  describe("Hyphen separator with backslash escaping", () => {
    it("should handle keys with hyphens using backslash escape sequence", () => {
      const doc = new LoroDoc()

      // Backslash escaping: hyphen becomes \-
      // Double backslash for literal backslash: \\
      const map = doc.getMap("data-my\\-key-value")
      expect(map.id).toBe("cid:root-data-my\\-key-value:Map")

      // This represents: data["my-key"].value
    })

    it("should demonstrate backslash escaping strategy for hyphen separator", () => {
      // Escaping strategy: backslash-escape hyphens in keys as \-
      // Path separator: single hyphen "-"
      // Literal hyphen in key: "\-"
      // Literal backslash in key: "\\"

      function escapePath(segments: string[]): string {
        return segments
          .map(s => s.replace(/\\/g, "\\\\").replace(/-/g, "\\-"))
          .join("-")
      }

      function unescapePath(path: string): string[] {
        const result: string[] = []
        let current = ""
        let i = 0

        while (i < path.length) {
          if (path[i] === "\\") {
            // Escape sequence
            if (path[i + 1] === "-") {
              current += "-"
              i += 2
            } else if (path[i + 1] === "\\") {
              current += "\\"
              i += 2
            } else {
              // Invalid escape, treat as literal backslash
              current += "\\"
              i += 1
            }
          } else if (path[i] === "-") {
            // Path separator
            result.push(current)
            current = ""
            i += 1
          } else {
            current += path[i]
            i += 1
          }
        }
        result.push(current)

        return result
      }

      // Test escaping
      expect(escapePath(["data", "nested", "items"])).toBe("data-nested-items")
      expect(escapePath(["data", "my-key", "value"])).toBe(
        "data-my\\-key-value",
      )
      expect(escapePath(["config", "api-url"])).toBe("config-api\\-url")

      // Test unescaping
      expect(unescapePath("data-nested-items")).toEqual([
        "data",
        "nested",
        "items",
      ])
      expect(unescapePath("data-my\\-key-value")).toEqual([
        "data",
        "my-key",
        "value",
      ])
      expect(unescapePath("config-api\\-url")).toEqual(["config", "api-url"])

      // Edge case: key that is just a hyphen
      expect(escapePath(["data", "-", "value"])).toBe("data-\\--value")
      expect(unescapePath("data-\\--value")).toEqual(["data", "-", "value"])

      // Edge case: key with multiple consecutive hyphens
      expect(escapePath(["data", "a--b", "value"])).toBe("data-a\\-\\-b-value")
      expect(unescapePath("data-a\\-\\-b-value")).toEqual([
        "data",
        "a--b",
        "value",
      ])

      // Edge case: key containing backslash
      expect(escapePath(["data", "path\\to", "value"])).toBe(
        "data-path\\\\to-value",
      )
      expect(unescapePath("data-path\\\\to-value")).toEqual([
        "data",
        "path\\to",
        "value",
      ])

      // Edge case: key containing backslash followed by hyphen
      expect(escapePath(["data", "a\\-b", "value"])).toBe(
        "data-a\\\\\\-b-value",
      )
      expect(unescapePath("data-a\\\\\\-b-value")).toEqual([
        "data",
        "a\\-b",
        "value",
      ])
    })

    it("should work with escaped paths in LoroDoc", () => {
      const doc = new LoroDoc()

      function escapePath(segments: string[]): string {
        return segments
          .map(s => s.replace(/\\/g, "\\\\").replace(/-/g, "\\-"))
          .join("-")
      }

      // Create a structure where a key contains a hyphen
      // Schema: { config: { "api-url": string } }
      const configPath = escapePath(["config"])
      const apiUrlPath = escapePath(["config", "api-url"])

      const config = doc.getMap(configPath)
      config.set("api-url", null) // Marker for child container

      const apiUrl = doc.getMap(apiUrlPath)
      apiUrl.set("value", "https://example.com")

      doc.commit()

      expect(config.id).toBe("cid:root-config:Map")
      expect(apiUrl.id).toBe("cid:root-config-api\\-url:Map")
      expect(apiUrl.get("value")).toBe("https://example.com")
    })

    it("should merge concurrent creations with escaped paths", () => {
      function escapePath(segments: string[]): string {
        return segments
          .map(s => s.replace(/\\/g, "\\\\").replace(/-/g, "\\-"))
          .join("-")
      }

      const path = escapePath(["data", "my-key", "items"])

      // Peer A
      const docA = new LoroDoc()
      docA.setPeerId("1")
      const listA = docA.getList(path)
      listA.insert(0, "A")
      docA.commit()

      // Peer B
      const docB = new LoroDoc()
      docB.setPeerId("2")
      const listB = docB.getList(path)
      listB.insert(0, "B")
      docB.commit()

      // Same container ID
      expect(listA.id).toBe(listB.id)
      expect(listA.id).toBe("cid:root-data-my\\-key-items:List")

      // Sync and verify merge
      const exportA = docA.export({ mode: "update" })
      const exportB = docB.export({ mode: "update" })

      docA.import(exportB)
      docB.import(exportA)

      expect(listA.toJSON()).toHaveLength(2)
      expect(listA.toJSON()).toContain("A")
      expect(listA.toJSON()).toContain("B")
    })
  })

  describe("Root containers and applyDiff (using . separator)", () => {
    it("should preserve root container IDs through applyDiff", () => {
      // Source doc creates root containers with path-like names
      const source = new LoroDoc()
      source.setPeerId("1")

      const sourceList = source.getList("data.items")
      sourceList.insert(0, "item1")
      sourceList.insert(1, "item2")
      source.commit()

      // Target doc is empty
      const target = new LoroDoc()
      target.setPeerId("2")

      // Get diff from source
      const diff = source.diff([], source.frontiers(), false)

      // Apply diff to target
      target.applyDiff(diff)

      // Verify target has the same root container ID
      const targetList = target.getList("data.items")
      expect(targetList.id).toBe("cid:root-data.items:List")
      expect(targetList.toJSON()).toEqual(["item1", "item2"])
    })

    it("should merge concurrent root container creations", () => {
      // Peer A creates a root list and adds items
      const docA = new LoroDoc()
      docA.setPeerId("1")
      const listA = docA.getList("shared.items")
      listA.insert(0, "A")
      docA.commit()

      // Peer B creates the same root list and adds items
      const docB = new LoroDoc()
      docB.setPeerId("2")
      const listB = docB.getList("shared.items")
      listB.insert(0, "B")
      docB.commit()

      // Both should have the same container ID
      expect(listA.id).toBe(listB.id)
      expect(listA.id).toBe("cid:root-shared.items:List")

      // Sync via import
      const exportA = docA.export({ mode: "update" })
      const exportB = docB.export({ mode: "update" })

      docA.import(exportB)
      docB.import(exportA)

      // Both should have both items (merged)
      expect(listA.toJSON()).toHaveLength(2)
      expect(listB.toJSON()).toHaveLength(2)
      expect(listA.toJSON()).toContain("A")
      expect(listA.toJSON()).toContain("B")
    })

    it("should merge concurrent root container creations via applyDiff", () => {
      // Peer A creates a root list and adds items
      const docA = new LoroDoc()
      docA.setPeerId("1")
      const listA = docA.getList("shared.items")
      listA.insert(0, "A")
      docA.commit()

      // Peer B creates the same root list and adds items
      const docB = new LoroDoc()
      docB.setPeerId("2")
      const listB = docB.getList("shared.items")
      listB.insert(0, "B")
      docB.commit()

      // Sync via applyDiff (simulating lens propagation)
      const diffA = docA.diff([], docA.frontiers(), false)
      const diffB = docB.diff([], docB.frontiers(), false)

      docA.applyDiff(diffB)
      docB.applyDiff(diffA)

      // Both should have both items (merged)
      expect(listA.toJSON()).toHaveLength(2)
      expect(listB.toJSON()).toHaveLength(2)
      expect(listA.toJSON()).toContain("A")
      expect(listA.toJSON()).toContain("B")
    })
  })

  describe("Nested containers and applyDiff (the problem)", () => {
    it("should demonstrate that nested containers get remapped by applyDiff", () => {
      // Source doc creates a nested container
      const source = new LoroDoc()
      source.setPeerId("1")

      const rootMap = source.getMap("data")
      const nestedList = rootMap.setContainer("items", new LoroList())
      nestedList.insert(0, "item1")
      source.commit()

      // The nested list has a peer-dependent ID
      expect(nestedList.id).toMatch(/^cid:\d+@1:List$/)

      // Target doc is empty
      const target = new LoroDoc()
      target.setPeerId("2")

      // Get diff from source
      const diff = source.diff([], source.frontiers(), false)

      // Apply diff to target
      target.applyDiff(diff)

      // Get the nested list from target
      const targetRootMap = target.getMap("data")
      const targetNestedList = targetRootMap.get("items") as LoroList

      // The nested list in target has a DIFFERENT ID (remapped)
      // This is the problem we're trying to solve!
      expect(targetNestedList.id).not.toBe(nestedList.id)
      expect(targetNestedList.id).toMatch(/^cid:\d+@2:List$/)

      // But the data is still there
      expect(targetNestedList.toJSON()).toEqual(["item1"])
    })

    it("should demonstrate that concurrent nested container creation causes LWW", () => {
      // Peer A creates a nested list and adds items
      const docA = new LoroDoc()
      docA.setPeerId("1")
      const rootMapA = docA.getMap("data")
      const nestedListA = rootMapA.setContainer("items", new LoroList())
      nestedListA.insert(0, "A")
      docA.commit()

      // Peer B creates the same nested list and adds items
      const docB = new LoroDoc()
      docB.setPeerId("2")
      const rootMapB = docB.getMap("data")
      const nestedListB = rootMapB.setContainer("items", new LoroList())
      nestedListB.insert(0, "B")
      docB.commit()

      // The nested lists have DIFFERENT IDs
      expect(nestedListA.id).not.toBe(nestedListB.id)

      // Sync via import
      const exportA = docA.export({ mode: "update" })
      const exportB = docB.export({ mode: "update" })

      docA.import(exportB)
      docB.import(exportA)

      // After sync, the "items" key points to ONE of the lists (LWW)
      // The other list's items are "lost" (still in oplog but not visible)
      const finalListA = rootMapA.get("items") as LoroList
      const finalListB = rootMapB.get("items") as LoroList

      // Both docs converge to the same list
      expect(finalListA.id).toBe(finalListB.id)

      // But only ONE item is visible (the other was in the "losing" container)
      expect(finalListA.toJSON()).toHaveLength(1)
    })
  })

  describe("Flattened approach validation (using . separator)", () => {
    it("should demonstrate that flattened root containers merge correctly", () => {
      // Peer A creates a flattened structure
      const docA = new LoroDoc()
      docA.setPeerId("1")

      // Instead of nested: rootMap.setContainer("items", new LoroList())
      // Use flattened: doc.getList("data.items")
      const rootMapA = docA.getMap("data")
      rootMapA.set("items", null) // Marker for "this is a container reference"
      const listA = docA.getList("data.items")
      listA.insert(0, "A")
      docA.commit()

      // Peer B creates the same flattened structure
      const docB = new LoroDoc()
      docB.setPeerId("2")

      const rootMapB = docB.getMap("data")
      rootMapB.set("items", null) // Marker
      const listB = docB.getList("data.items")
      listB.insert(0, "B")
      docB.commit()

      // Both lists have the SAME root container ID
      expect(listA.id).toBe(listB.id)
      expect(listA.id).toBe("cid:root-data.items:List")

      // Sync via import
      const exportA = docA.export({ mode: "update" })
      const exportB = docB.export({ mode: "update" })

      docA.import(exportB)
      docB.import(exportA)

      // Both items are merged!
      expect(listA.toJSON()).toHaveLength(2)
      expect(listB.toJSON()).toHaveLength(2)
      expect(listA.toJSON()).toContain("A")
      expect(listA.toJSON()).toContain("B")
    })

    it("should demonstrate that flattened root containers merge via applyDiff", () => {
      // Peer A creates a flattened structure
      const docA = new LoroDoc()
      docA.setPeerId("1")

      const rootMapA = docA.getMap("data")
      rootMapA.set("items", null)
      const listA = docA.getList("data.items")
      listA.insert(0, "A")
      docA.commit()

      // Peer B creates the same flattened structure
      const docB = new LoroDoc()
      docB.setPeerId("2")

      const rootMapB = docB.getMap("data")
      rootMapB.set("items", null)
      const listB = docB.getList("data.items")
      listB.insert(0, "B")
      docB.commit()

      // Sync via applyDiff (simulating lens propagation)
      const diffA = docA.diff([], docA.frontiers(), false)
      const diffB = docB.diff([], docB.frontiers(), false)

      docA.applyDiff(diffB)
      docB.applyDiff(diffA)

      // Both items are merged!
      expect(listA.toJSON()).toHaveLength(2)
      expect(listB.toJSON()).toHaveLength(2)
      expect(listA.toJSON()).toContain("A")
      expect(listA.toJSON()).toContain("B")
    })

    it("should handle deeply nested flattened paths", () => {
      const doc = new LoroDoc()

      // Create a deeply nested flattened structure
      const level1 = doc.getMap("root")
      level1.set("level2", null)

      const level2 = doc.getMap("root.level2")
      level2.set("level3", null)

      const level3 = doc.getMap("root.level2.level3")
      level3.set("items", null)

      const items = doc.getList("root.level2.level3.items")
      items.insert(0, "deep item")

      doc.commit()

      // Verify all containers have root IDs
      expect(level1.id).toBe("cid:root-root:Map")
      expect(level2.id).toBe("cid:root-root.level2:Map")
      expect(level3.id).toBe("cid:root-root.level2.level3:Map")
      expect(items.id).toBe("cid:root-root.level2.level3.items:List")

      // Verify data
      expect(items.toJSON()).toEqual(["deep item"])
    })

    it("should handle record-like dynamic keys in flattened paths", () => {
      const doc = new LoroDoc()

      // Simulate a Record<string, Struct> with flattened paths
      const players = doc.getMap("game.players")

      // Player "alice"
      players.set("alice", null)
      const alice = doc.getMap("game.players.alice")
      alice.set("score", 100)
      alice.set("name", "Alice")

      // Player "bob"
      players.set("bob", null)
      const bob = doc.getMap("game.players.bob")
      bob.set("score", 200)
      bob.set("name", "Bob")

      doc.commit()

      // Verify container IDs
      expect(players.id).toBe("cid:root-game.players:Map")
      expect(alice.id).toBe("cid:root-game.players.alice:Map")
      expect(bob.id).toBe("cid:root-game.players.bob:Map")

      // Verify data
      expect(alice.get("score")).toBe(100)
      expect(bob.get("score")).toBe(200)
    })
  })

  describe("Edge cases for path separator choice", () => {
    it("should handle keys that naturally contain dots", () => {
      const doc = new LoroDoc()

      // If a user has a key like "config.json", we need to escape it
      // or use a different separator
      // Option 1: Use a separator that's unlikely in user data
      // Let's test with ~ (tilde)
      const filesWithTilde = doc.getMap("files~list")
      filesWithTilde.set("config.json", "content")

      expect(filesWithTilde.id).toBe("cid:root-files~list:Map")
      expect(filesWithTilde.get("config.json")).toBe("content")
    })

    it("should handle numeric keys in records (array-like access)", () => {
      const doc = new LoroDoc()

      // Record with numeric keys
      const items = doc.getMap("items")
      items.set("0", null)
      items.set("1", null)

      const item0 = doc.getMap("items.0")
      item0.set("value", "first")

      const item1 = doc.getMap("items.1")
      item1.set("value", "second")

      doc.commit()

      expect(item0.id).toBe("cid:root-items.0:Map")
      expect(item1.id).toBe("cid:root-items.1:Map")
    })
  })

  describe("toJSON reconstruction (using . separator)", () => {
    it("should be able to reconstruct hierarchy from flattened storage", () => {
      const doc = new LoroDoc()

      // Create flattened structure
      const data = doc.getMap("data")
      data.set("nested", null) // Marker

      const nested = doc.getMap("data.nested")
      nested.set("value", "hello")
      nested.set("items", null) // Marker

      const items = doc.getList("data.nested.items")
      items.insert(0, "item1")
      items.insert(1, "item2")

      doc.commit()

      // Manual reconstruction (this is what toJSON would do)
      function reconstructHierarchy(
        doc: LoroDoc,
        rootPath: string,
      ): Record<string, unknown> {
        const result: Record<string, unknown> = {}
        const map = doc.getMap(rootPath)

        for (const key of map.keys()) {
          const value = map.get(key)
          if (value === null) {
            // This is a container reference - check what type it is
            const childPath = `${rootPath}.${key}`

            // Try to determine the type by checking if it exists
            // In practice, we'd use the schema to know the type
            const childList = doc.getList(childPath)
            const childMap = doc.getMap(childPath)

            // Check which one has content (hacky, but works for this test)
            if (childList.length > 0) {
              result[key] = childList.toJSON()
            } else if (childMap.size > 0) {
              result[key] = reconstructHierarchy(doc, childPath)
            } else {
              // Empty container - need schema to know type
              // For now, assume map
              result[key] = {}
            }
          } else {
            result[key] = value
          }
        }

        return result
      }

      const reconstructed = reconstructHierarchy(doc, "data")
      expect(reconstructed).toEqual({
        nested: {
          value: "hello",
          items: ["item1", "item2"],
        },
      })
    })
  })
})
