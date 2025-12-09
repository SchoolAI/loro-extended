import { LoroDoc, LoroList } from "loro-crdt"
import { describe, expect, it } from "vitest"
import {
  applyMigrationsToValue,
  getValueWithMigrationFallback,
  keyExistsInMap,
  readWithMigration,
} from "./migration-executor.js"
import { Shape } from "./shape.js"

describe("Migration Executor", () => {
  describe("keyExistsInMap", () => {
    it("should return true for existing keys", () => {
      const doc = new LoroDoc()
      const map = doc.getMap("test")
      map.set("key1", "value1")

      expect(keyExistsInMap(map, "key1")).toBe(true)
    })

    it("should return false for missing keys", () => {
      const doc = new LoroDoc()
      const map = doc.getMap("test")

      expect(keyExistsInMap(map, "nonexistent")).toBe(false)
    })

    it("should return true for empty string values", () => {
      const doc = new LoroDoc()
      const map = doc.getMap("test")
      map.set("emptyString", "")

      expect(keyExistsInMap(map, "emptyString")).toBe(true)
    })

    it("should return true for zero values", () => {
      const doc = new LoroDoc()
      const map = doc.getMap("test")
      map.set("zero", 0)

      expect(keyExistsInMap(map, "zero")).toBe(true)
    })

    it("should return true for null values", () => {
      const doc = new LoroDoc()
      const map = doc.getMap("test")
      map.set("nullValue", null)

      expect(keyExistsInMap(map, "nullValue")).toBe(true)
    })

    it("should return true for empty array containers", () => {
      const doc = new LoroDoc()
      const map = doc.getMap("test")
      map.setContainer("emptyList", new LoroList())

      expect(keyExistsInMap(map, "emptyList")).toBe(true)
    })
  })

  describe("readWithMigration", () => {
    it("should return value from primary key when it exists", () => {
      const doc = new LoroDoc()
      const map = doc.getMap("test")
      map.set("_v2_title", "Hello World")

      const shape = Shape.text().key("_v2_title")

      const result = readWithMigration(map, "title", shape)

      expect(result.found).toBe(true)
      expect(result.value).toBe("Hello World")
      expect(result.migrated).toBe(false)
    })

    it("should return empty value from primary key (not migrate)", () => {
      const doc = new LoroDoc()
      const map = doc.getMap("test")
      map.set("_v2_title", "")

      const shape = Shape.text()
        .key("_v2_title")
        .migrateFrom({
          key: "_v1_title",
          sourceShape: Shape.plain.string(),
          transform: v1 => v1,
        })

      // Also set V1 data to verify it's not used
      map.set("_v1_title", "Old Title")

      const result = readWithMigration(map, "title", shape)

      expect(result.found).toBe(true)
      expect(result.value).toBe("") // Empty string from V2, not "Old Title" from V1
      expect(result.migrated).toBe(false)
    })

    it("should migrate from V1 when V2 is missing", () => {
      const doc = new LoroDoc()
      const map = doc.getMap("test")
      map.set("_v1_title", "Old Title")

      const shape = Shape.text()
        .key("_v2_title")
        .migrateFrom({
          key: "_v1_title",
          sourceShape: Shape.plain.string(),
          transform: v1 => `Migrated: ${v1}`,
        })

      const result = readWithMigration(map, "title", shape)

      expect(result.found).toBe(true)
      expect(result.value).toBe("Migrated: Old Title")
      expect(result.migrated).toBe(true)
      expect(result.migratedFrom).toBe("_v1_title")

      // Verify eager migration wrote to V2 (as a LoroText container)
      const v2Container = map.get("_v2_title")
      expect(v2Container).toBeDefined()
      // The container is a LoroText, so we check its string value
      expect((v2Container as any).toString()).toBe("Migrated: Old Title")
    })

    it("should not write when readonly is true", () => {
      const doc = new LoroDoc()
      const map = doc.getMap("test")
      map.set("_v1_title", "Old Title")

      const shape = Shape.text()
        .key("_v2_title")
        .migrateFrom({
          key: "_v1_title",
          sourceShape: Shape.plain.string(),
          transform: v1 => `Migrated: ${v1}`,
        })

      const result = readWithMigration(map, "title", shape, true)

      expect(result.found).toBe(true)
      expect(result.value).toBe("Migrated: Old Title")
      expect(result.migrated).toBe(false) // Not migrated because readonly

      // Verify V2 was NOT written
      expect(keyExistsInMap(map, "_v2_title")).toBe(false)
    })

    it("should return not found when no data exists", () => {
      const doc = new LoroDoc()
      const map = doc.getMap("test")

      const shape = Shape.text()
        .key("_v2_title")
        .migrateFrom({
          key: "_v1_title",
          sourceShape: Shape.plain.string(),
          transform: v1 => v1,
        })

      const result = readWithMigration(map, "title", shape)

      expect(result.found).toBe(false)
      expect(result.migrated).toBe(false)
    })

    it("should handle chained migrations (V1 -> V3)", () => {
      const doc = new LoroDoc()
      const map = doc.getMap("test")
      map.set("task_v1", "Buy milk")

      const v3Shape = Shape.plain
        .object({
          title: Shape.plain.string(),
          status: Shape.plain.string(),
          assignee: Shape.plain.string(),
        })
        .key("task_v3")
        .migrateFrom({
          key: "task_v2",
          sourceShape: Shape.plain.object({
            title: Shape.plain.string(),
            done: Shape.plain.boolean(),
          }),
          transform: v2 => ({
            title: v2.title,
            status: v2.done ? "done" : "todo",
            assignee: "unassigned",
          }),
        })
        .migrateFrom({
          key: "task_v1",
          sourceShape: Shape.plain.string(),
          transform: v1 => ({
            title: v1,
            status: "todo",
            assignee: "unassigned",
          }),
        })

      const result = readWithMigration(map, "task", v3Shape)

      expect(result.found).toBe(true)
      expect(result.value).toEqual({
        title: "Buy milk",
        status: "todo",
        assignee: "unassigned",
      })
      expect(result.migrated).toBe(true)
      expect(result.migratedFrom).toBe("task_v1")
    })

    it("should prefer V2 over V1 when both exist", () => {
      const doc = new LoroDoc()
      const map = doc.getMap("test")
      map.set("task_v1", "V1 Task")
      map.set("task_v2", { title: "V2 Task", done: true })

      const v3Shape = Shape.plain
        .object({
          title: Shape.plain.string(),
          status: Shape.plain.string(),
          assignee: Shape.plain.string(),
        })
        .key("task_v3")
        .migrateFrom({
          key: "task_v2",
          sourceShape: Shape.plain.object({
            title: Shape.plain.string(),
            done: Shape.plain.boolean(),
          }),
          transform: v2 => ({
            title: v2.title,
            status: v2.done ? "done" : "todo",
            assignee: "unassigned",
          }),
        })
        .migrateFrom({
          key: "task_v1",
          sourceShape: Shape.plain.string(),
          transform: v1 => ({
            title: v1,
            status: "todo",
            assignee: "unassigned",
          }),
        })

      const result = readWithMigration(map, "task", v3Shape)

      expect(result.found).toBe(true)
      expect(result.value).toEqual({
        title: "V2 Task",
        status: "done",
        assignee: "unassigned",
      })
      expect(result.migratedFrom).toBe("task_v2")
    })

    it("should work with shapes that have no migrations", () => {
      const doc = new LoroDoc()
      const map = doc.getMap("test")
      map.set("title", "Hello")

      const shape = Shape.text() // No migrations

      const result = readWithMigration(map, "title", shape)

      expect(result.found).toBe(true)
      expect(result.value).toBe("Hello")
      expect(result.migrated).toBe(false)
    })
  })

  describe("getValueWithMigrationFallback", () => {
    it("should return value from primary key", () => {
      const crdtValue = {
        _v2_messages: ["Hello", "World"],
      }

      const shape = Shape.list(Shape.text()).key("_v2_messages")

      const result = getValueWithMigrationFallback(crdtValue, "messages", shape)

      expect(result).toEqual(["Hello", "World"])
    })

    it("should transform and return from migration source", () => {
      const crdtValue = {
        _v1_messages: ["Hello", "World"],
      }

      const shape = Shape.list(
        Shape.map({
          type: Shape.plain.string(),
          content: Shape.plain.string(),
        }),
      )
        .key("_v2_messages")
        .migrateFrom({
          key: "_v1_messages",
          sourceShape: Shape.list(Shape.text()),
          transform: (v1: string[]) =>
            v1.map(text => ({ type: "text", content: text })),
        })

      const result = getValueWithMigrationFallback(crdtValue, "messages", shape)

      expect(result).toEqual([
        { type: "text", content: "Hello" },
        { type: "text", content: "World" },
      ])
    })

    it("should return undefined when no data exists", () => {
      const crdtValue = {}

      const shape = Shape.text()
        .key("_v2_title")
        .migrateFrom({
          key: "_v1_title",
          sourceShape: Shape.plain.string(),
          transform: v1 => v1,
        })

      const result = getValueWithMigrationFallback(crdtValue, "title", shape)

      expect(result).toBeUndefined()
    })
  })

  describe("applyMigrationsToValue", () => {
    it("should apply migrations to all fields", () => {
      const crdtValue = {
        _v2_title: "New Title",
        _v1_messages: ["Hello", "World"],
      }

      const shapes = {
        title: Shape.text().key("_v2_title"),
        messages: Shape.list(
          Shape.map({
            type: Shape.plain.string(),
            content: Shape.plain.string(),
          }),
        )
          .key("_v2_messages")
          .migrateFrom({
            key: "_v1_messages",
            sourceShape: Shape.list(Shape.text()),
            transform: (v1: string[]) =>
              v1.map(text => ({ type: "text", content: text })),
          }),
      }

      const result = applyMigrationsToValue(crdtValue, shapes)

      expect(result).toEqual({
        title: "New Title",
        messages: [
          { type: "text", content: "Hello" },
          { type: "text", content: "World" },
        ],
      })
    })

    it("should handle mixed migrated and non-migrated fields", () => {
      const crdtValue = {
        title: "Direct Title",
        _v1_count: 5,
      }

      const shapes = {
        title: Shape.text(), // No migration
        count: Shape.counter()
          .key("_v2_count")
          .migrateFrom({
            key: "_v1_count",
            sourceShape: Shape.plain.number(),
            transform: v1 => v1 * 10,
          }),
      }

      const result = applyMigrationsToValue(crdtValue, shapes)

      expect(result).toEqual({
        title: "Direct Title",
        count: 50,
      })
    })
  })
})
