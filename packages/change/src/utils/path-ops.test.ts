import { describe, expect, it } from "vitest"
import { deepClone, getAtPath, setAtPath, transformAtPath } from "./path-ops.js"

describe("path-ops", () => {
  describe("getAtPath", () => {
    it("returns value at shallow path", () => {
      expect(getAtPath({ a: 1 }, ["a"])).toBe(1)
    })

    it("returns value at deep path", () => {
      expect(getAtPath({ a: { b: { c: 2 } } }, ["a", "b", "c"])).toBe(2)
    })

    it("returns undefined for missing path", () => {
      expect(getAtPath({ a: 1 }, ["b"])).toBeUndefined()
    })

    it("returns undefined when traversing null", () => {
      expect(getAtPath({ a: null }, ["a", "b"])).toBeUndefined()
    })

    it("returns undefined when traversing undefined", () => {
      expect(getAtPath({ a: undefined }, ["a", "b"])).toBeUndefined()
    })

    it("returns the object itself for empty path", () => {
      const obj = { a: 1 }
      expect(getAtPath(obj, [])).toBe(obj)
    })

    it("handles array values", () => {
      expect(getAtPath({ a: [1, 2, 3] }, ["a"])).toEqual([1, 2, 3])
    })

    it("returns undefined for non-object at path", () => {
      expect(getAtPath({ a: 1 }, ["a", "b"])).toBeUndefined()
    })

    it("handles null root object", () => {
      expect(getAtPath(null, ["a"])).toBeUndefined()
    })

    it("handles undefined root object", () => {
      expect(getAtPath(undefined, ["a"])).toBeUndefined()
    })
  })

  describe("setAtPath", () => {
    it("sets value at shallow path", () => {
      const result = setAtPath({ a: 1 }, ["a"], 2)
      expect(result).toEqual({ a: 2 })
    })

    it("sets value at deep path", () => {
      const result = setAtPath({ a: { b: 1 } }, ["a", "b"], 2)
      expect(result).toEqual({ a: { b: 2 } })
    })

    it("creates intermediate objects", () => {
      const result = setAtPath({}, ["a", "b", "c"], 1)
      expect(result).toEqual({ a: { b: { c: 1 } } })
    })

    it("does not mutate original", () => {
      const original = { a: { b: 1 } }
      setAtPath(original, ["a", "b"], 2)
      expect(original.a.b).toBe(1)
    })

    it("returns value directly for empty path", () => {
      expect(setAtPath({ a: 1 }, [], "newValue")).toBe("newValue")
    })

    it("handles null intermediate values by replacing with object", () => {
      const result = setAtPath({ a: null }, ["a", "b"], 1)
      expect(result).toEqual({ a: { b: 1 } })
    })

    it("handles undefined intermediate values by creating object", () => {
      const result = setAtPath({ a: undefined }, ["a", "b"], 1)
      expect(result).toEqual({ a: { b: 1 } })
    })

    it("handles null root object", () => {
      const result = setAtPath(null, ["a"], 1)
      expect(result).toEqual({ a: 1 })
    })

    it("handles undefined root object", () => {
      const result = setAtPath(undefined, ["a"], 1)
      expect(result).toEqual({ a: 1 })
    })

    it("preserves sibling properties", () => {
      const result = setAtPath({ a: 1, b: 2 }, ["a"], 3)
      expect(result).toEqual({ a: 3, b: 2 })
    })

    it("preserves nested sibling properties", () => {
      const result = setAtPath({ a: { b: 1, c: 2 } }, ["a", "b"], 3)
      expect(result).toEqual({ a: { b: 3, c: 2 } })
    })

    it("can set nested objects as values", () => {
      const result = setAtPath({}, ["a"], { b: { c: 1 } })
      expect(result).toEqual({ a: { b: { c: 1 } } })
    })

    it("can set arrays as values", () => {
      const result = setAtPath({}, ["a"], [1, 2, 3])
      expect(result).toEqual({ a: [1, 2, 3] })
    })

    it("replaces primitive with object when needed for path", () => {
      const result = setAtPath({ a: 42 }, ["a", "b"], 1)
      expect(result).toEqual({ a: { b: 1 } })
    })
  })

  describe("transformAtPath", () => {
    it("applies transform at shallow path", () => {
      const result = transformAtPath({ a: { value: 1 } }, ["a"], obj => ({
        ...obj,
        value: (obj as { value: number }).value + 1,
      }))
      expect(result).toEqual({ a: { value: 2 } })
    })

    it("applies transform at deep path", () => {
      const result = transformAtPath(
        { a: { b: { c: 1 } } },
        ["a", "b"],
        obj => ({
          ...obj,
          c: (obj as { c: number }).c * 2,
        }),
      )
      expect(result).toEqual({ a: { b: { c: 2 } } })
    })

    it("applies transform at root with empty path", () => {
      const result = transformAtPath({ x: 1 }, [], obj => ({ ...obj, y: 2 }))
      expect(result).toEqual({ x: 1, y: 2 })
    })

    it("does not mutate original object", () => {
      const original = { a: { b: 1 } }
      transformAtPath(original, ["a"], obj => ({ ...obj, c: 2 }))
      expect(original).toEqual({ a: { b: 1 } })
    })

    it("creates intermediate objects for missing paths", () => {
      const result = transformAtPath(
        {} as Record<string, unknown>,
        ["a", "b"],
        obj => ({
          ...obj,
          c: 1,
        }),
      )
      expect(result).toEqual({ a: { b: { c: 1 } } })
    })

    it("can delete a key using transform", () => {
      const result = transformAtPath({ a: { b: 1, c: 2 } }, ["a"], obj => {
        const { b: _, ...rest } = obj as { b: number; c: number }
        return rest
      })
      expect(result).toEqual({ a: { c: 2 } })
    })

    it("can add a key using transform", () => {
      const result = transformAtPath({ a: { existing: 1 } }, ["a"], obj => ({
        ...obj,
        newKey: "new",
      }))
      expect(result).toEqual({ a: { existing: 1, newKey: "new" } })
    })

    it("preserves sibling properties via structural sharing", () => {
      const original = { a: { nested: 1 }, b: { other: 2 } }
      const result = transformAtPath(original, ["a"], obj => ({
        ...obj,
        nested: 999,
      }))
      expect(result).toEqual({ a: { nested: 999 }, b: { other: 2 } })
      // Structural sharing: b should be the same reference
      expect(result.b).toBe(original.b)
    })

    it("handles null intermediate value by replacing with empty object", () => {
      const result = transformAtPath(
        { a: null } as unknown as Record<string, unknown>,
        ["a", "b"],
        obj => ({ ...obj, c: 1 }),
      )
      expect(result).toEqual({ a: { b: { c: 1 } } })
    })

    it("handles undefined intermediate value by replacing with empty object", () => {
      const result = transformAtPath(
        { a: undefined } as unknown as Record<string, unknown>,
        ["a", "b"],
        obj => ({ ...obj, c: 1 }),
      )
      expect(result).toEqual({ a: { b: { c: 1 } } })
    })

    it("can replace entire value at path", () => {
      const result = transformAtPath({ a: { old: "data" } }, ["a"], () => ({
        completely: "new",
      }))
      expect(result).toEqual({ a: { completely: "new" } })
    })
  })

  describe("deepClone", () => {
    it("clones nested objects", () => {
      const original = { a: { b: [1, 2, 3] } }
      const cloned = deepClone(original)
      cloned.a.b.push(4)
      expect(original.a.b).toEqual([1, 2, 3])
    })

    it("returns primitive values directly", () => {
      expect(deepClone(42)).toBe(42)
      expect(deepClone("hello")).toBe("hello")
      expect(deepClone(true)).toBe(true)
      expect(deepClone(null)).toBe(null)
    })

    it("clones arrays", () => {
      const original = [1, 2, { a: 3 }]
      const cloned = deepClone(original)
      ;(cloned[2] as { a: number }).a = 4
      expect((original[2] as { a: number }).a).toBe(3)
    })

    it("handles deeply nested structures", () => {
      const original = { a: { b: { c: { d: { e: 1 } } } } }
      const cloned = deepClone(original)
      cloned.a.b.c.d.e = 2
      expect(original.a.b.c.d.e).toBe(1)
    })

    it("clones empty objects", () => {
      const original = {}
      const cloned = deepClone(original)
      expect(cloned).toEqual({})
      expect(cloned).not.toBe(original)
    })

    it("clones empty arrays", () => {
      const original: unknown[] = []
      const cloned = deepClone(original)
      expect(cloned).toEqual([])
      expect(cloned).not.toBe(original)
    })

    it("handles mixed nested structures", () => {
      const original = {
        array: [1, { nested: true }],
        object: { key: [1, 2, 3] },
      }
      const cloned = deepClone(original)
      ;(cloned.array[1] as { nested: boolean }).nested = false
      cloned.object.key.push(4)
      expect((original.array[1] as { nested: boolean }).nested).toBe(true)
      expect(original.object.key).toEqual([1, 2, 3])
    })
  })
})
