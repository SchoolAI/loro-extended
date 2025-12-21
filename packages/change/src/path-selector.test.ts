import { describe, expect, it } from "vitest"
import { createPathBuilder } from "./path-builder.js"
import { compileToJsonPath, hasWildcard } from "./path-compiler.js"
import { evaluatePathOnValue } from "./path-evaluator.js"
import { Shape } from "./shape.js"

describe("Path Selector DSL", () => {
  const docShape = Shape.doc({
    books: Shape.list(
      Shape.struct({
        title: Shape.text(),
        price: Shape.plain.number(),
        author: Shape.struct({
          name: Shape.plain.string(),
        }),
      }),
    ),
    config: Shape.struct({
      theme: Shape.plain.string(),
    }),
    users: Shape.record(
      Shape.struct({
        name: Shape.plain.string(),
        score: Shape.counter(),
      }),
    ),
  })

  describe("createPathBuilder", () => {
    it("should create a path builder for a doc shape", () => {
      const builder = createPathBuilder(docShape)
      expect(builder).toBeDefined()
      expect(builder.books).toBeDefined()
      expect(builder.config).toBeDefined()
      expect(builder.users).toBeDefined()
    })

    it("should create path segments for simple property access", () => {
      const builder = createPathBuilder(docShape)
      const selector = builder.config.theme
      expect(selector.__segments).toEqual([
        { type: "property", key: "config" },
        { type: "property", key: "theme" },
      ])
    })

    it("should create path segments for $each on lists", () => {
      const builder = createPathBuilder(docShape)
      const selector = builder.books.$each.title
      expect(selector.__segments).toEqual([
        { type: "property", key: "books" },
        { type: "each" },
        { type: "property", key: "title" },
      ])
    })

    it("should create path segments for $at on lists", () => {
      const builder = createPathBuilder(docShape)
      const selector = builder.books.$at(0).title
      expect(selector.__segments).toEqual([
        { type: "property", key: "books" },
        { type: "index", index: 0 },
        { type: "property", key: "title" },
      ])
    })

    it("should create path segments for $first and $last", () => {
      const builder = createPathBuilder(docShape)

      const firstSelector = builder.books.$first.title
      expect(firstSelector.__segments).toEqual([
        { type: "property", key: "books" },
        { type: "index", index: 0 },
        { type: "property", key: "title" },
      ])

      const lastSelector = builder.books.$last.title
      expect(lastSelector.__segments).toEqual([
        { type: "property", key: "books" },
        { type: "index", index: -1 },
        { type: "property", key: "title" },
      ])
    })

    it("should create path segments for $each on records", () => {
      const builder = createPathBuilder(docShape)
      const selector = builder.users.$each.name
      expect(selector.__segments).toEqual([
        { type: "property", key: "users" },
        { type: "each" },
        { type: "property", key: "name" },
      ])
    })

    it("should create path segments for $key on records", () => {
      const builder = createPathBuilder(docShape)
      const selector = builder.users.$key("alice").name
      expect(selector.__segments).toEqual([
        { type: "property", key: "users" },
        { type: "key", key: "alice" },
        { type: "property", key: "name" },
      ])
    })

    it("should support nested struct access", () => {
      const builder = createPathBuilder(docShape)
      const selector = builder.books.$each.author.name
      expect(selector.__segments).toEqual([
        { type: "property", key: "books" },
        { type: "each" },
        { type: "property", key: "author" },
        { type: "property", key: "name" },
      ])
    })
  })

  describe("compileToJsonPath", () => {
    it("should compile simple property path", () => {
      const segments = [
        { type: "property" as const, key: "config" },
        { type: "property" as const, key: "theme" },
      ]
      expect(compileToJsonPath(segments)).toBe("$.config.theme")
    })

    it("should compile path with wildcard", () => {
      const segments = [
        { type: "property" as const, key: "books" },
        { type: "each" as const },
        { type: "property" as const, key: "title" },
      ]
      expect(compileToJsonPath(segments)).toBe("$.books[*].title")
    })

    it("should compile path with index", () => {
      const segments = [
        { type: "property" as const, key: "books" },
        { type: "index" as const, index: 0 },
        { type: "property" as const, key: "title" },
      ]
      expect(compileToJsonPath(segments)).toBe("$.books[0].title")
    })

    it("should compile path with negative index", () => {
      const segments = [
        { type: "property" as const, key: "books" },
        { type: "index" as const, index: -1 },
        { type: "property" as const, key: "title" },
      ]
      expect(compileToJsonPath(segments)).toBe("$.books[-1].title")
    })

    it("should compile path with key", () => {
      const segments = [
        { type: "property" as const, key: "users" },
        { type: "key" as const, key: "alice" },
        { type: "property" as const, key: "name" },
      ]
      expect(compileToJsonPath(segments)).toBe('$.users["alice"].name')
    })

    it("should use bracket notation for special characters", () => {
      const segments = [{ type: "property" as const, key: "my-key" }]
      expect(compileToJsonPath(segments)).toBe('$["my-key"]')
    })
  })

  describe("hasWildcard", () => {
    it("should return true for paths with $each", () => {
      const segments = [
        { type: "property" as const, key: "books" },
        { type: "each" as const },
        { type: "property" as const, key: "title" },
      ]
      expect(hasWildcard(segments)).toBe(true)
    })

    it("should return false for paths without $each", () => {
      const segments = [
        { type: "property" as const, key: "config" },
        { type: "property" as const, key: "theme" },
      ]
      expect(hasWildcard(segments)).toBe(false)
    })

    it("should return false for paths with index", () => {
      const segments = [
        { type: "property" as const, key: "books" },
        { type: "index" as const, index: 0 },
        { type: "property" as const, key: "title" },
      ]
      expect(hasWildcard(segments)).toBe(false)
    })
  })

  describe("evaluatePathOnValue", () => {
    const testData = {
      books: [
        { title: "Book 1", price: 10, author: { name: "Author 1" } },
        { title: "Book 2", price: 20, author: { name: "Author 2" } },
        { title: "Book 3", price: 30, author: { name: "Author 3" } },
      ],
      config: { theme: "dark" },
      users: {
        alice: { name: "Alice", score: 100 },
        bob: { name: "Bob", score: 200 },
      },
    }

    it("should evaluate simple property path", () => {
      const segments = [
        { type: "property" as const, key: "config" },
        { type: "property" as const, key: "theme" },
      ]
      expect(evaluatePathOnValue(testData, segments)).toBe("dark")
    })

    it("should evaluate path with wildcard on array", () => {
      const segments = [
        { type: "property" as const, key: "books" },
        { type: "each" as const },
        { type: "property" as const, key: "title" },
      ]
      expect(evaluatePathOnValue(testData, segments)).toEqual([
        "Book 1",
        "Book 2",
        "Book 3",
      ])
    })

    it("should evaluate path with positive index", () => {
      const segments = [
        { type: "property" as const, key: "books" },
        { type: "index" as const, index: 1 },
        { type: "property" as const, key: "title" },
      ]
      expect(evaluatePathOnValue(testData, segments)).toBe("Book 2")
    })

    it("should evaluate path with negative index", () => {
      const segments = [
        { type: "property" as const, key: "books" },
        { type: "index" as const, index: -1 },
        { type: "property" as const, key: "title" },
      ]
      expect(evaluatePathOnValue(testData, segments)).toBe("Book 3")

      const segments2 = [
        { type: "property" as const, key: "books" },
        { type: "index" as const, index: -2 },
        { type: "property" as const, key: "title" },
      ]
      expect(evaluatePathOnValue(testData, segments2)).toBe("Book 2")
    })

    it("should evaluate path with key on record", () => {
      const segments = [
        { type: "property" as const, key: "users" },
        { type: "key" as const, key: "alice" },
        { type: "property" as const, key: "name" },
      ]
      expect(evaluatePathOnValue(testData, segments)).toBe("Alice")
    })

    it("should evaluate path with wildcard on record", () => {
      const segments = [
        { type: "property" as const, key: "users" },
        { type: "each" as const },
        { type: "property" as const, key: "name" },
      ]
      const result = evaluatePathOnValue(testData, segments) as string[]
      expect(result).toContain("Alice")
      expect(result).toContain("Bob")
    })

    it("should evaluate nested path through wildcard", () => {
      const segments = [
        { type: "property" as const, key: "books" },
        { type: "each" as const },
        { type: "property" as const, key: "author" },
        { type: "property" as const, key: "name" },
      ]
      expect(evaluatePathOnValue(testData, segments)).toEqual([
        "Author 1",
        "Author 2",
        "Author 3",
      ])
    })

    it("should return undefined for missing property", () => {
      const segments = [{ type: "property" as const, key: "nonexistent" }]
      expect(evaluatePathOnValue(testData, segments)).toBeUndefined()
    })

    it("should return undefined for out-of-bounds index", () => {
      const segments = [
        { type: "property" as const, key: "books" },
        { type: "index" as const, index: 10 },
        { type: "property" as const, key: "title" },
      ]
      expect(evaluatePathOnValue(testData, segments)).toBeUndefined()
    })

    it("should return undefined for out-of-bounds negative index", () => {
      const segments = [
        { type: "property" as const, key: "books" },
        { type: "index" as const, index: -10 },
        { type: "property" as const, key: "title" },
      ]
      expect(evaluatePathOnValue(testData, segments)).toBeUndefined()
    })

    it("should return empty array for wildcard on empty array", () => {
      const segments = [
        { type: "property" as const, key: "books" },
        { type: "each" as const },
        { type: "property" as const, key: "title" },
      ]
      expect(evaluatePathOnValue({ books: [] }, segments)).toEqual([])
    })
  })
})
