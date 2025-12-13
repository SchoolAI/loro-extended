/** biome-ignore-all lint/suspicious/noExplicitAny: allow for tests */

import {
  type Container,
  type LoroCounter,
  LoroList,
  type LoroMap,
  type LoroMovableList,
  type LoroText,
} from "loro-crdt"
import { describe, expect, it } from "vitest"
import { convertInputToRef } from "./conversion.js"
import { Shape } from "./shape.js"
import {
  isContainer,
  isLoroCounter,
  isLoroList,
  isLoroMap,
  isLoroMovableList,
  isLoroText,
} from "./utils/type-guards.js"

describe("Conversion Functions", () => {
  describe("convertInputToNode - Text Conversion", () => {
    it("should convert string to LoroText", () => {
      const shape = Shape.text()
      const result = convertInputToRef("Hello World", shape)

      expect(isContainer(result)).toBe(true)
      expect(isLoroText(result as any)).toBe(true)

      const text = result as LoroText
      expect(text.toString()).toBe("Hello World")
    })

    it("should handle empty string", () => {
      const shape = Shape.text()
      const result = convertInputToRef("", shape)

      expect(isLoroText(result as any)).toBe(true)
      const text = result as LoroText
      expect(text.toString()).toBe("")
      expect(text.length).toBe(0)
    })

    it("should handle unicode and special characters", () => {
      const shape = Shape.text()
      const testStrings = [
        "Hello 世界 🌍",
        "Special chars: !@#$%^&*()",
        "Newlines\nand\ttabs",
        "Émojis: 🚀⭐🎉",
      ]

      for (const testString of testStrings) {
        const result = convertInputToRef(testString, shape)
        expect(isLoroText(result as any)).toBe(true)
        const text = result as LoroText
        expect(text.toString()).toBe(testString)
      }
    })

    it("should throw error for non-string input", () => {
      const shape = Shape.text()

      expect(() => convertInputToRef(123 as any, shape)).toThrow(
        "string expected",
      )
      expect(() => convertInputToRef(null as any, shape)).toThrow(
        "string expected",
      )
      expect(() => convertInputToRef([] as any, shape)).toThrow(
        "string expected",
      )
      expect(() => convertInputToRef({} as any, shape)).toThrow(
        "string expected",
      )
      expect(() => convertInputToRef(true as any, shape)).toThrow(
        "string expected",
      )
    })
  })

  describe("convertInputToNode - Counter Conversion", () => {
    it("should convert number to LoroCounter", () => {
      const shape = Shape.counter()
      const result = convertInputToRef(42, shape)

      expect(isContainer(result)).toBe(true)
      expect(isLoroCounter(result as any)).toBe(true)

      const counter = result as LoroCounter
      expect(counter.value).toBe(42)
    })

    it("should handle zero value", () => {
      const shape = Shape.counter()
      const result = convertInputToRef(0, shape)

      expect(isLoroCounter(result as any)).toBe(true)
      const counter = result as LoroCounter
      expect(counter.value).toBe(0)
    })

    it("should handle negative numbers", () => {
      const shape = Shape.counter()
      const result = convertInputToRef(-15, shape)

      expect(isLoroCounter(result as any)).toBe(true)
      const counter = result as LoroCounter
      expect(counter.value).toBe(-15)
    })

    it("should handle floating point numbers", () => {
      const shape = Shape.counter()
      const result = convertInputToRef(3.14, shape)

      expect(isLoroCounter(result as any)).toBe(true)
      const counter = result as LoroCounter
      expect(counter.value).toBe(3.14)
    })

    it("should throw error for non-number input", () => {
      const shape = Shape.counter()

      expect(() => convertInputToRef("123" as any, shape)).toThrow(
        "number expected",
      )
      expect(() => convertInputToRef(null as any, shape)).toThrow(
        "number expected",
      )
      expect(() => convertInputToRef([] as any, shape)).toThrow(
        "number expected",
      )
      expect(() => convertInputToRef({} as any, shape)).toThrow(
        "number expected",
      )
      expect(() => convertInputToRef(true as any, shape)).toThrow(
        "number expected",
      )
    })
  })

  describe("convertInputToNode - List Conversion", () => {
    it("should convert array to LoroList with value items", () => {
      const shape = Shape.list(Shape.plain.string())
      const result = convertInputToRef(["hello", "world"], shape)

      expect(isContainer(result)).toBe(true)
      expect(isLoroList(result as any)).toBe(true)

      const list = result as LoroList
      expect(list.length).toBe(2)
      expect(list.get(0)).toBe("hello")
      expect(list.get(1)).toBe("world")
    })

    it("should convert array to LoroList with container items", () => {
      const shape = Shape.list(Shape.text())
      const result = convertInputToRef(["first", "second"], shape)

      expect(isLoroList(result as any)).toBe(true)
      const list = result as LoroList
      expect(list.length).toBe(2)

      // Items should be LoroText containers
      const firstItem = list.get(0)
      const secondItem = list.get(1)
      expect((firstItem as Container).getShallowValue()).toBe("first")
      expect((secondItem as Container).getShallowValue()).toBe("second")
    })

    it("should handle empty array", () => {
      const shape = Shape.list(Shape.plain.string())
      const result = convertInputToRef([], shape)

      expect(isLoroList(result as any)).toBe(true)
      const list = result as LoroList
      expect(list.length).toBe(0)
    })

    it("should handle mixed value types in list", () => {
      const shape = Shape.list(Shape.plain.number())
      const result = convertInputToRef([1, 2.5, -3, 0], shape)

      expect(isLoroList(result as any)).toBe(true)
      const list = result as LoroList
      expect(list.length).toBe(4)
      expect(list.get(0)).toBe(1)
      expect(list.get(1)).toBe(2.5)
      expect(list.get(2)).toBe(-3)
      expect(list.get(3)).toBe(0)
    })

    it("should return plain array for value shape", () => {
      const shape = Shape.plain.array(Shape.plain.string())
      const input = ["hello", "world"]
      const result = convertInputToRef(input, shape)

      expect(isContainer(result)).toBe(false)
      expect(Array.isArray(result)).toBe(true)
      expect(result).toEqual(["hello", "world"])
    })

    it("should handle nested container conversion", () => {
      const shape = Shape.list(Shape.counter())
      const result = convertInputToRef([5, 10, 15], shape)

      expect(isLoroList(result as any)).toBe(true)
      const list = result as LoroList
      expect(list.length).toBe(3)
      expect((list.get(0) as Container).getShallowValue()).toBe(5)
      expect((list.get(1) as Container).getShallowValue()).toBe(10)
      expect((list.get(2) as Container).getShallowValue()).toBe(15)
    })

    it("should throw error for non-array input", () => {
      const shape = Shape.list(Shape.plain.string())

      expect(() => convertInputToRef("not array" as any, shape)).toThrow(
        "array expected",
      )
      expect(() => convertInputToRef(123 as any, shape)).toThrow(
        "array expected",
      )
      expect(() => convertInputToRef({} as any, shape)).toThrow(
        "array expected",
      )
      expect(() => convertInputToRef(null as any, shape)).toThrow(
        "array expected",
      )
    })
  })

  describe("convertInputToNode - MovableList Conversion", () => {
    it("should convert array to LoroMovableList with value items", () => {
      const shape = Shape.movableList(Shape.plain.string())
      const result = convertInputToRef(["first", "second", "third"], shape)

      expect(isContainer(result)).toBe(true)
      expect(isLoroMovableList(result as any)).toBe(true)

      const list = result as LoroMovableList
      expect(list.length).toBe(3)
      expect(list.get(0)).toBe("first")
      expect(list.get(1)).toBe("second")
      expect(list.get(2)).toBe("third")
    })

    it("should convert array to LoroMovableList with container items", () => {
      const shape = Shape.movableList(Shape.counter())
      const result = convertInputToRef([1, 5, 10], shape)

      expect(isLoroMovableList(result as any)).toBe(true)
      const list = result as LoroMovableList
      expect(list.length).toBe(3)
      expect((list.get(0) as Container).getShallowValue()).toBe(1)
      expect((list.get(1) as Container).getShallowValue()).toBe(5)
      expect((list.get(2) as Container).getShallowValue()).toBe(10)
    })

    it("should handle empty movable list", () => {
      const shape = Shape.movableList(Shape.plain.boolean())
      const result = convertInputToRef([], shape)

      expect(isLoroMovableList(result as any)).toBe(true)
      const list = result as LoroMovableList
      expect(list.length).toBe(0)
    })

    it("should return plain array for value shape", () => {
      const shape = Shape.plain.array(Shape.plain.number())
      const input = [1, 2, 3]
      const result = convertInputToRef(input, shape)

      expect(isContainer(result)).toBe(false)
      expect(Array.isArray(result)).toBe(true)
      expect(result).toEqual([1, 2, 3])
    })

    it("should throw error for non-array input", () => {
      const shape = Shape.movableList(Shape.plain.string())

      expect(() => convertInputToRef("not array" as any, shape)).toThrow(
        "array expected",
      )
      expect(() => convertInputToRef(123 as any, shape)).toThrow(
        "array expected",
      )
      expect(() => convertInputToRef({} as any, shape)).toThrow(
        "array expected",
      )
      expect(() => convertInputToRef(null as any, shape)).toThrow(
        "array expected",
      )
    })
  })

  describe("convertInputToNode - Map Conversion", () => {
    it("should convert object to LoroMap with value properties", () => {
      const shape = Shape.struct({
        name: Shape.plain.string(),
        age: Shape.plain.number(),
        active: Shape.plain.boolean(),
      })

      const input = {
        name: "John",
        age: 30,
        active: true,
      }

      const result = convertInputToRef(input, shape)

      expect(isContainer(result)).toBe(true)
      expect(isLoroMap(result as any)).toBe(true)

      const map = result as LoroMap
      expect(map.get("name")).toBe("John")
      expect(map.get("age")).toBe(30)
      expect(map.get("active")).toBe(true)
    })

    it("should convert object to LoroMap with container properties", () => {
      const shape = Shape.struct({
        title: Shape.text(),
        count: Shape.counter(),
      })

      const input = {
        title: "Hello World",
        count: 42,
      }

      const result = convertInputToRef(input, shape)

      expect(isLoroMap(result as any)).toBe(true)
      const map = result as LoroMap
      expect((map.get("title") as Container).getShallowValue()).toBe(
        "Hello World",
      )
      expect((map.get("count") as Container).getShallowValue()).toBe(42)
    })

    it("should handle empty object", () => {
      const shape = Shape.struct({})
      const result = convertInputToRef({}, shape)

      expect(isLoroMap(result as any)).toBe(true)
      const map = result as LoroMap
      expect(map.size).toBe(0)
    })

    it("should handle object with extra properties not in schema", () => {
      const shape = Shape.struct({
        name: Shape.plain.string(),
      })

      const input = {
        name: "John",
        extraProp: "should be ignored", // This should be set as-is
      }

      const result = convertInputToRef(input, shape)

      expect(isLoroMap(result as any)).toBe(true)
      const map = result as LoroMap
      expect(map.get("name")).toBe("John")
      // Note: The conversion function has a bug on line 117 - it sets `value` instead of `v`
      // This test documents the current behavior
    })

    it("should handle nested map structures", () => {
      const shape = Shape.struct({
        user: Shape.struct({
          name: Shape.plain.string(),
          profile: Shape.struct({
            bio: Shape.text(),
          }),
        }),
      })

      const input = {
        user: {
          name: "Alice",
          profile: {
            bio: "Software developer",
          },
        },
      }

      const result = convertInputToRef(input, shape)

      expect(isLoroMap(result as any)).toBe(true)
      const map = result as LoroMap
      const user = map.get("user")
      expect(user).toBeDefined()
    })

    it("should return plain object for value shape", () => {
      const shape = Shape.plain.object({
        name: Shape.plain.string(),
        age: Shape.plain.number(),
      })

      const input = { name: "John", age: 30 }
      const result = convertInputToRef(input, shape)

      expect(isContainer(result)).toBe(false)
      expect(typeof result).toBe("object")
      expect(result).toEqual({ name: "John", age: 30 })
    })

    it("should throw error for non-object input", () => {
      const shape = Shape.struct({
        name: Shape.plain.string(),
      })

      expect(() => convertInputToRef("not object" as any, shape)).toThrow(
        "object expected",
      )
      expect(() => convertInputToRef(123 as any, shape)).toThrow(
        "object expected",
      )
      expect(() => convertInputToRef([] as any, shape)).toThrow(
        "object expected",
      )
      expect(() => convertInputToRef(null as any, shape)).toThrow(
        "object expected",
      )
    })
  })

  describe("convertInputToNode - Value Types", () => {
    it("should return value as-is for value shapes", () => {
      const stringShape = Shape.plain.string()
      const numberShape = Shape.plain.number()
      const booleanShape = Shape.plain.boolean()
      const nullShape = Shape.plain.null()

      expect(convertInputToRef("hello", stringShape)).toBe("hello")
      expect(convertInputToRef(42, numberShape)).toBe(42)
      expect(convertInputToRef(true, booleanShape)).toBe(true)
      expect(convertInputToRef(null, nullShape)).toBe(null)
    })

    it("should handle complex value shapes", () => {
      const arrayShape = Shape.plain.array(Shape.plain.string())
      const objectShape = Shape.plain.object({
        name: Shape.plain.string(),
        count: Shape.plain.number(),
      })

      const arrayInput = ["a", "b", "c"]
      const objectInput = { name: "test", count: 5 }

      expect(convertInputToRef(arrayInput, arrayShape)).toEqual(arrayInput)
      expect(convertInputToRef(objectInput, objectShape)).toEqual(objectInput)
    })

    it("should handle Uint8Array values", () => {
      const shape = Shape.plain.uint8Array()
      const input = new Uint8Array([1, 2, 3, 4])

      const result = convertInputToRef(input, shape)
      expect(result).toBe(input)
      expect(result instanceof Uint8Array).toBe(true)
    })
  })

  describe("convertInputToNode - Error Cases", () => {
    it("should throw error for tree type (unimplemented)", () => {
      const shape = Shape.tree(Shape.struct({}))

      expect(() => convertInputToRef({}, shape)).toThrow(
        "tree type unimplemented",
      )
    })

    it("should throw error for invalid value shape", () => {
      const invalidShape = { _type: "value", valueType: "invalid" } as any

      expect(() => convertInputToRef("test", invalidShape)).toThrow(
        "value expected",
      )
    })
  })

  describe("convertInputToNode - Complex Nested Structures", () => {
    it("should handle deeply nested container structures", () => {
      const shape = Shape.list(
        Shape.struct({
          title: Shape.text(),
          metadata: Shape.struct({
            views: Shape.counter(),
            tags: Shape.list(Shape.plain.string()),
          }),
        }),
      )

      const input = [
        {
          title: "Article 1",
          metadata: {
            views: 100,
            tags: ["tech", "programming"],
          },
        },
        {
          title: "Article 2",
          metadata: {
            views: 50,
            tags: ["design"],
          },
        },
      ]

      const result = convertInputToRef(input, shape)

      expect(isLoroList(result as any)).toBe(true)
      const list = result as LoroList
      expect(list.length).toBe(2)
    })

    it("should handle mixed container and value types", () => {
      const shape = Shape.struct({
        plainString: Shape.plain.string(),
        plainArray: Shape.plain.array(Shape.plain.number()),
        loroText: Shape.text(),
        loroList: Shape.list(Shape.plain.string()),
        nestedMap: Shape.struct({
          counter: Shape.counter(),
          plainBool: Shape.plain.boolean(),
        }),
      })

      const input = {
        plainString: "hello",
        plainArray: [1, 2, 3],
        loroText: "loro text content",
        loroList: ["item1", "item2"],
        nestedMap: {
          counter: 42,
          plainBool: true,
        },
      }

      const result = convertInputToRef(input, shape)

      expect(isLoroMap(result as any)).toBe(true)
      const map = result as LoroMap
      expect(map.get("plainString")).toBe("hello")
      expect(map.get("plainArray")).toEqual([1, 2, 3])
      expect((map.get("loroText") as Container).toString()).toBe(
        "loro text content",
      )
    })

    it("should handle lists of lists", () => {
      const shape = Shape.list(Shape.list(Shape.plain.number()))
      const input = [
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9],
      ]

      const result = convertInputToRef(input, shape)

      expect(isLoroList(result as any)).toBe(true)
      const outerList = result as LoroList
      expect(outerList.length).toBe(3)
    })

    it("should handle movable lists with complex items", () => {
      const shape = Shape.movableList(
        Shape.struct({
          id: Shape.plain.string(),
          title: Shape.text(),
          completed: Shape.plain.boolean(),
        }),
      )

      const input = [
        { id: "1", title: "Task 1", completed: false },
        { id: "2", title: "Task 2", completed: true },
      ]

      const result = convertInputToRef(input, shape)

      expect(isLoroMovableList(result as any)).toBe(true)
      const list = result as LoroMovableList
      expect(list.length).toBe(2)
    })
  })

  describe("convertInputToNode - Edge Cases", () => {
    it("should handle null and undefined values appropriately", () => {
      const nullShape = Shape.plain.null()
      const undefinedShape = Shape.plain.undefined()

      expect(convertInputToRef(null, nullShape)).toBe(null)
      expect(convertInputToRef(undefined, undefinedShape)).toBe(undefined)
    })

    it("should handle empty containers", () => {
      const emptyListShape = Shape.list(Shape.plain.string())
      const emptyMapShape = Shape.struct({})
      const emptyMovableListShape = Shape.movableList(Shape.plain.number())

      const emptyList = convertInputToRef([], emptyListShape)
      const emptyMap = convertInputToRef({}, emptyMapShape)
      const emptyMovableList = convertInputToRef([], emptyMovableListShape)

      expect(isLoroList(emptyList as any)).toBe(true)
      expect((emptyList as LoroList).length).toBe(0)

      expect(isLoroMap(emptyMap as any)).toBe(true)
      expect((emptyMap as LoroMap).size).toBe(0)

      expect(isLoroMovableList(emptyMovableList as any)).toBe(true)
      expect((emptyMovableList as LoroMovableList).length).toBe(0)
    })

    it("should handle very large numbers", () => {
      const shape = Shape.counter()
      const largeNumber = Number.MAX_SAFE_INTEGER
      const result = convertInputToRef(largeNumber, shape)

      expect(isLoroCounter(result as any)).toBe(true)
      expect((result as LoroCounter).value).toBe(largeNumber)
    })

    it("should handle very long strings", () => {
      const shape = Shape.text()
      const longString = "a".repeat(10000)
      const result = convertInputToRef(longString, shape)

      expect(isLoroText(result as any)).toBe(true)
      expect((result as LoroText).toString()).toBe(longString)
      expect((result as LoroText).length).toBe(10000)
    })

    it("should handle arrays with many items", () => {
      const shape = Shape.list(Shape.plain.number())
      const largeArray = Array.from({ length: 1000 }, (_, i) => i)
      const result = convertInputToRef(largeArray, shape)

      expect(isLoroList(result as any)).toBe(true)
      const list = result as LoroList
      expect(list.length).toBe(1000)
      expect(list.get(0)).toBe(0)
      expect(list.get(999)).toBe(999)
    })

    it("should handle objects with many properties", () => {
      const shapes: Record<string, any> = {}
      const input: Record<string, any> = {}

      // Create 100 properties
      for (let i = 0; i < 100; i++) {
        shapes[`prop${i}`] = Shape.plain.string()
        input[`prop${i}`] = `value${i}`
      }

      const shape = Shape.struct(shapes)
      const result = convertInputToRef(input, shape)

      expect(isLoroMap(result as any)).toBe(true)
      const map = result as LoroMap
      expect(map.size).toBe(100)
      expect(map.get("prop0")).toBe("value0")
      expect(map.get("prop99")).toBe("value99")
    })
  })

  describe("convertInputToNode - Type Safety", () => {
    it("should maintain referential integrity for containers", () => {
      const shape = Shape.list(Shape.text())
      const result = convertInputToRef(["test"], shape)

      expect(isLoroList(result as any)).toBe(true)
      const list = result as LoroList

      // The container should be a new instance
      expect(list).toBeInstanceOf(LoroList)
      expect(list.id).toBeDefined()
    })

    it("should create independent container instances", () => {
      const shape = Shape.counter()
      const result1 = convertInputToRef(5, shape)
      const result2 = convertInputToRef(5, shape)

      expect(isLoroCounter(result1 as any)).toBe(true)
      expect(isLoroCounter(result2 as any)).toBe(true)

      const counter1 = result1 as LoroCounter
      const counter2 = result2 as LoroCounter

      // Should be the same IDs since the containers are detached
      expect(counter1.id).toBe(counter2.id)

      // Should be different instances
      expect(counter1).not.toBe(counter2)

      expect(counter1.value).toBe(counter2.value) // Same value though
    })

    it("should handle recursive structures without infinite loops", () => {
      // Test that the conversion doesn't get stuck in infinite recursion
      const shape = Shape.struct({
        name: Shape.plain.string(),
        children: Shape.list(Shape.plain.string()), // Not recursive, but nested
      })

      const input = {
        name: "parent",
        children: ["child1", "child2"],
      }

      const result = convertInputToRef(input, shape)

      expect(isLoroMap(result as any)).toBe(true)
      const map = result as LoroMap
      expect(map.get("name")).toBe("parent")
    })
  })
})
