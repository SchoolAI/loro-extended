import { describe, expect, it } from "vitest"
import {
  getMigrations,
  getStorageKey,
  hasCustomStorageKey,
  hasMigrations,
} from "./migration.js"
import { Shape } from "./shape.js"

describe("Schema Migration", () => {
  describe("Direct migration methods on Shape", () => {
    it("should have migration methods available directly on Shape.text()", () => {
      const textShape = Shape.text()

      expect(textShape._type).toBe("text")
      expect(textShape._storageKey).toBeUndefined()
      expect(textShape._migrations).toBeUndefined()
      expect(typeof textShape.key).toBe("function")
      expect(typeof textShape.migrateFrom).toBe("function")
    })

    it("should support .key() for custom storage key", () => {
      const shape = Shape.text().key("_v2_title")

      expect(shape._storageKey).toBe("_v2_title")
      expect(shape._type).toBe("text")
    })

    it("should support .migrateFrom() for migration definitions", () => {
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
          transform: (v1Data: string[]) =>
            v1Data.map(text => ({ type: "text", content: text })),
        })

      expect(shape._storageKey).toBe("_v2_messages")
      expect(shape._migrations).toHaveLength(1)
      expect(shape._migrations?.[0].sourceKey).toBe("_v1_messages")
    })

    it("should support chained migrations (V1 -> V2 -> V3)", () => {
      // V2 shape: { title: string, done: boolean }
      const taskV2Shape = Shape.plain.object({
        title: Shape.plain.string(),
        done: Shape.plain.boolean(),
      })

      // V1 shape: string (just the task text)
      const taskV1Shape = Shape.plain.string()

      // V3 shape with migrations
      const shape = Shape.map({
        title: Shape.plain.string(),
        status: Shape.plain.string("todo", "done", "archived"),
        assignee: Shape.plain.string(),
      })
        .key("task_v3")
        .migrateFrom({
          key: "task_v2",
          sourceShape: taskV2Shape,
          transform: (v2Data: { title: string; done: boolean }) => ({
            title: v2Data.title,
            status: v2Data.done ? "done" : "todo",
            assignee: "unassigned",
          }),
        })
        .migrateFrom({
          key: "task_v1",
          sourceShape: taskV1Shape,
          transform: (v1Data: string) => ({
            title: v1Data,
            status: "todo" as const,
            assignee: "unassigned",
          }),
        })

      expect(shape._storageKey).toBe("task_v3")
      expect(shape._migrations).toHaveLength(2)
      expect(shape._migrations?.[0].sourceKey).toBe("task_v2")
      expect(shape._migrations?.[1].sourceKey).toBe("task_v1")
    })

    it("should preserve original shape properties", () => {
      const shape = Shape.map({
        name: Shape.plain.string(),
        count: Shape.plain.number(),
      }).key("_v2_data")

      expect(shape._type).toBe("map")
      expect(shape.shapes).toBeDefined()
      expect(shape.shapes.name._type).toBe("value")
      expect(shape.shapes.count._type).toBe("value")
    })

    it("should preserve migration methods through .placeholder()", () => {
      const shape = Shape.counter().key("_v2_count").placeholder(10)

      expect(shape._storageKey).toBe("_v2_count")
      expect(shape._placeholder).toBe(10)
      expect(typeof shape.key).toBe("function")
      expect(typeof shape.migrateFrom).toBe("function")
    })

    it("should work with all container types", () => {
      // Test list
      const listShape = Shape.list(Shape.text()).key("_v2_list")
      expect(listShape._storageKey).toBe("_v2_list")

      // Test map
      const mapShape = Shape.map({ name: Shape.plain.string() }).key("_v2_map")
      expect(mapShape._storageKey).toBe("_v2_map")

      // Test record
      const recordShape = Shape.record(Shape.plain.number()).key("_v2_record")
      expect(recordShape._storageKey).toBe("_v2_record")

      // Test movableList
      const movableListShape = Shape.movableList(Shape.text()).key(
        "_v2_movable",
      )
      expect(movableListShape._storageKey).toBe("_v2_movable")

      // Test counter
      const counterShape = Shape.counter().key("_v2_counter")
      expect(counterShape._storageKey).toBe("_v2_counter")

      // Test text
      const textShape = Shape.text().key("_v2_text")
      expect(textShape._storageKey).toBe("_v2_text")

      // Test tree
      const treeShape = Shape.tree(
        Shape.map({ name: Shape.plain.string() }),
      ).key("_v2_tree")
      expect(treeShape._storageKey).toBe("_v2_tree")
    })
  })

  describe("getStorageKey", () => {
    it("should return the custom storage key if set", () => {
      const shape = Shape.text().key("_v2_title")
      expect(getStorageKey(shape, "title")).toBe("_v2_title")
    })

    it("should return the logical key if no custom key is set", () => {
      const shape = Shape.text()
      expect(getStorageKey(shape, "title")).toBe("title")
    })
  })

  describe("getMigrations", () => {
    it("should return migrations if defined", () => {
      const shape = Shape.text()
        .key("_v2_title")
        .migrateFrom({
          key: "_v1_title",
          sourceShape: Shape.plain.string(),
          transform: (v1: string) => v1,
        })

      const migrations = getMigrations(shape)
      expect(migrations).toHaveLength(1)
      expect(migrations?.[0].sourceKey).toBe("_v1_title")
    })

    it("should return undefined for shapes without migrations", () => {
      const shape = Shape.text()
      expect(getMigrations(shape)).toBeUndefined()
    })
  })

  describe("hasMigrations", () => {
    it("should return true if migrations are defined", () => {
      const shape = Shape.text().migrateFrom({
        key: "_v1_title",
        sourceShape: Shape.plain.string(),
        transform: (v1: string) => v1,
      })

      expect(hasMigrations(shape)).toBe(true)
    })

    it("should return false if no migrations are defined", () => {
      const shape = Shape.text()
      expect(hasMigrations(shape)).toBe(false)
    })
  })

  describe("hasCustomStorageKey", () => {
    it("should return true if custom storage key is set", () => {
      const shape = Shape.text().key("_v2_title")
      expect(hasCustomStorageKey(shape)).toBe(true)
    })

    it("should return false if no custom storage key is set", () => {
      const shape = Shape.text()
      expect(hasCustomStorageKey(shape)).toBe(false)
    })
  })

  describe("Migration transform functions", () => {
    it("should correctly transform V1 string to V2 object", () => {
      const shape = Shape.map({
        title: Shape.plain.string(),
        done: Shape.plain.boolean(),
      }).migrateFrom({
        key: "task_v1",
        sourceShape: Shape.plain.string(),
        transform: (v1Data: string) => ({
          title: v1Data,
          done: false,
        }),
      })

      const migrations = getMigrations(shape)
      if (!migrations) throw new Error("Expected migrations to be defined")
      const transform = migrations[0].transform

      expect(transform("Buy milk")).toEqual({
        title: "Buy milk",
        done: false,
      })
    })

    it("should correctly transform V2 object to V3 object", () => {
      const v2Shape = Shape.plain.object({
        title: Shape.plain.string(),
        done: Shape.plain.boolean(),
      })

      const shape = Shape.map({
        title: Shape.plain.string(),
        status: Shape.plain.string("todo", "done", "archived"),
        assignee: Shape.plain.string(),
      }).migrateFrom({
        key: "task_v2",
        sourceShape: v2Shape,
        transform: (v2Data: { title: string; done: boolean }) => ({
          title: v2Data.title,
          status: v2Data.done ? ("done" as const) : ("todo" as const),
          assignee: "unassigned",
        }),
      })

      const migrations = getMigrations(shape)
      if (!migrations) throw new Error("Expected migrations to be defined")
      const transform = migrations[0].transform

      expect(transform({ title: "Buy milk", done: true })).toEqual({
        title: "Buy milk",
        status: "done",
        assignee: "unassigned",
      })

      expect(transform({ title: "Walk dog", done: false })).toEqual({
        title: "Walk dog",
        status: "todo",
        assignee: "unassigned",
      })
    })

    it("should handle list transformations", () => {
      const shape = Shape.list(
        Shape.map({
          type: Shape.plain.string(),
          content: Shape.plain.string(),
        }),
      ).migrateFrom({
        key: "_v1_messages",
        sourceShape: Shape.list(Shape.text()),
        transform: (v1Data: string[]) =>
          v1Data.map(text => ({ type: "text", content: text })),
      })

      const migrations = getMigrations(shape)
      if (!migrations) throw new Error("Expected migrations to be defined")
      const transform = migrations[0].transform

      expect(transform(["Hello", "World"])).toEqual([
        { type: "text", content: "Hello" },
        { type: "text", content: "World" },
      ])
    })
  })
})
