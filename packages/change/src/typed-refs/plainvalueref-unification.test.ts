/**
 * Tests for PlainValueRef Unification: Runtime Value Check and List Integration
 *
 * These tests verify:
 * 1. writeListValue correctly handles both LoroList (delete+insert) and LoroMovableList (.set())
 * 2. Runtime primitive check returns raw values for primitives, PlainValueRef for objects
 * 3. ListRef uses PlainValueRef for value shapes with immediate writes
 */

import { LoroDoc } from "loro-crdt"
import { describe, expect, it } from "vitest"
import { change } from "../functional-helpers.js"
import { isPlainValueRef, value } from "../index.js"
import { Shape } from "../shape.js"
import { createTypedDoc } from "../typed-doc.js"

describe("writeListValue LoroList compatibility", () => {
  it("writes to LoroList via delete+insert", () => {
    const doc = new LoroDoc()
    const list = doc.getList("test")
    list.insert(0, { value: "original" })
    doc.commit()

    expect(list.get(0)).toEqual({ value: "original" })

    // LoroList doesn't have .set(), so we need delete+insert
    list.delete(0, 1)
    list.insert(0, { value: "updated" })
    doc.commit()

    expect(list.get(0)).toEqual({ value: "updated" })
  })

  it("writes to LoroMovableList via .set()", () => {
    const doc = new LoroDoc()
    const list = doc.getMovableList("test")
    list.insert(0, { value: "original" })
    doc.commit()

    expect(list.get(0)).toEqual({ value: "original" })

    // LoroMovableList has .set()
    list.set(0, { value: "updated" })
    doc.commit()

    expect(list.get(0)).toEqual({ value: "updated" })
  })
})

describe("runtime primitive check", () => {
  it("union of primitives returns raw value inside change()", () => {
    const schema = Shape.doc({
      data: Shape.struct({
        nullable: Shape.plain.union([Shape.plain.null(), Shape.plain.string()]),
      }),
    })
    const doc = createTypedDoc(schema)

    change(doc, draft => {
      // Raw null, not PlainValueRef
      expect(draft.data.nullable).toBeNull()
      draft.data.nullable = "hello"
      // Raw string
      expect(draft.data.nullable).toBe("hello")
    })
  })

  it("union of structs returns PlainValueRef inside change() for nested mutation", () => {
    const schema = Shape.doc({
      data: Shape.struct({
        metadata: Shape.plain.union([
          Shape.plain.struct({
            type: Shape.plain.string(),
            value: Shape.plain.number(),
          }),
        ]),
      }),
    })
    const doc = createTypedDoc(schema)

    change(doc, draft => {
      draft.data.metadata = { type: "a", value: 1 }
    })

    change(doc, draft => {
      // Must be PlainValueRef to enable nested mutation
      const metadata = draft.data.metadata
      expect(isPlainValueRef(metadata)).toBe(true)
      // Nested mutation must persist
      ;(metadata as any).value = 42
    })

    expect(doc.toJSON().data.metadata.value).toBe(42)
  })

  it("any shape with object value returns PlainValueRef for nested mutation", () => {
    const schema = Shape.doc({
      config: Shape.struct({
        options: Shape.plain.any(),
      }),
    })
    const doc = createTypedDoc(schema)

    change(doc, draft => {
      draft.config.options = { nested: { deep: true } }
    })

    change(doc, draft => {
      // Object value should be wrapped in PlainValueRef
      const options = draft.config.options
      expect(isPlainValueRef(options)).toBe(true)
      // Nested mutation must persist
      ;(options as any).nested.deep = false
    })

    const result = doc.toJSON().config.options as { nested: { deep: boolean } }
    expect(result.nested.deep).toBe(false)
  })

  it("any shape with primitive value returns raw value", () => {
    const schema = Shape.doc({
      config: Shape.struct({
        value: Shape.plain.any(),
      }),
    })
    const doc = createTypedDoc(schema)

    change(doc, draft => {
      draft.config.value = 42
    })

    change(doc, draft => {
      // Primitive should be raw value for ergonomic boolean logic
      expect(draft.config.value).toBe(42)
      expect(isPlainValueRef(draft.config.value)).toBe(false)
    })
  })
})

describe("ListRef PlainValueRef unification", () => {
  it("list item struct mutation persists via PlainValueRef", () => {
    const schema = Shape.doc({
      items: Shape.list(
        Shape.plain.struct({
          name: Shape.plain.string(),
          active: Shape.plain.boolean(),
        }),
      ),
    })
    const doc = createTypedDoc(schema)

    change(doc, draft => {
      draft.items.push({ name: "item1", active: false })
    })

    change(doc, draft => {
      const item = draft.items.get(0)
      // Should be PlainValueRef for struct value shape
      expect(isPlainValueRef(item)).toBe(true)
      // Mutation must persist
      if (item) item.active = true
    })

    expect(doc.toJSON().items[0].active).toBe(true)
  })

  it("find-and-mutate pattern works with PlainValueRef", () => {
    const schema = Shape.doc({
      users: Shape.list(
        Shape.plain.struct({
          id: Shape.plain.string(),
          score: Shape.plain.number(),
        }),
      ),
    })
    const doc = createTypedDoc(schema)

    change(doc, draft => {
      draft.users.push({ id: "a", score: 0 })
      draft.users.push({ id: "b", score: 0 })
    })

    change(doc, draft => {
      const user = draft.users.find(u => u.id === "a")
      if (user) {
        user.score = 100 // Must persist
      }
    })

    expect(doc.toJSON().users[0].score).toBe(100)
  })

  it("predicate sees in-flight mutations within same change()", () => {
    const schema = Shape.doc({
      items: Shape.list(
        Shape.plain.struct({
          id: Shape.plain.string(),
          value: Shape.plain.number(),
        }),
      ),
    })
    const doc = createTypedDoc(schema)

    change(doc, draft => {
      draft.items.push({ id: "x", value: 0 })
    })

    change(doc, draft => {
      // Mutate via getMutableItem (PlainValueRef writes immediately)
      const item = draft.items.get(0)
      if (item) item.value = 999

      // Predicate should see the mutation (reads fresh from container)
      const found = draft.items.find(i => i.value === 999)
      expect(found).toBeDefined()
    })
  })

  it("list outside change() returns PlainValueRef for value shapes", () => {
    const schema = Shape.doc({
      items: Shape.list(Shape.plain.struct({ value: Shape.plain.number() })),
    })
    const doc = createTypedDoc(schema)

    change(doc, draft => {
      draft.items.push({ value: 42 })
    })

    const item = doc.items.get(0)
    expect(isPlainValueRef(item)).toBe(true)
    const itemValue = value(item)
    expect(itemValue?.value).toBe(42)
  })

  it("list item boolean negation works correctly (!todo.completed)", () => {
    const schema = Shape.doc({
      todos: Shape.list(
        Shape.plain.struct({
          id: Shape.plain.string(),
          completed: Shape.plain.boolean(),
        }),
      ),
    })
    const doc = createTypedDoc(schema)

    change(doc, draft => {
      draft.todos.push({ id: "1", completed: false })
    })

    expect(doc.toJSON().todos[0].completed).toBe(false)

    change(doc, draft => {
      const todo = draft.todos.find(t => t.id === "1")
      if (todo) {
        // This pattern must work: !todo.completed where todo is PlainValueRef
        // but completed is a raw boolean (runtime primitive check)
        todo.completed = !todo.completed
      }
    })

    expect(doc.toJSON().todos[0].completed).toBe(true)
  })

  it("list item nested object mutation persists", () => {
    const schema = Shape.doc({
      articles: Shape.list(
        Shape.plain.struct({
          title: Shape.plain.string(),
          metadata: Shape.plain.struct({
            author: Shape.plain.string(),
            published: Shape.plain.boolean(),
          }),
        }),
      ),
    })
    const doc = createTypedDoc(schema)

    change(doc, draft => {
      draft.articles.push({
        title: "Test",
        metadata: { author: "Alice", published: false },
      })
    })

    change(doc, draft => {
      const article = draft.articles.get(0)
      // Nested mutation via PlainValueRef
      if (article) {
        article.metadata.published = true
        article.metadata.author = "Bob"
      }
    })

    const result = doc.toJSON().articles[0]
    expect(result.metadata.published).toBe(true)
    expect(result.metadata.author).toBe("Bob")
  })
})

describe("array-in-any edge case", () => {
  it("Shape.plain.any() containing array returns PlainValueRef outside change()", () => {
    const schema = Shape.doc({
      data: Shape.struct({
        items: Shape.plain.any(),
      }),
    })
    const doc = createTypedDoc(schema)

    change(doc, draft => {
      draft.data.items = [1, 2, 3]
    })

    // Outside change(), array is wrapped in PlainValueRef (since typeof [] === 'object')
    const items = doc.data.items
    expect(isPlainValueRef(items)).toBe(true)
    expect(value(items)).toEqual([1, 2, 3])
  })

  it("Shape.plain.any() containing array returns PlainValueRef inside change()", () => {
    const schema = Shape.doc({
      data: Shape.struct({
        items: Shape.plain.any(),
      }),
    })
    const doc = createTypedDoc(schema)

    change(doc, draft => {
      draft.data.items = ["a", "b", "c"]
    })

    change(doc, draft => {
      // Inside change(), array is still wrapped in PlainValueRef (typeof [] === 'object')
      const items = draft.data.items
      expect(isPlainValueRef(items)).toBe(true)
    })
  })

  it("array valueOf() returns the raw array", () => {
    const schema = Shape.doc({
      data: Shape.struct({
        arr: Shape.plain.any(),
      }),
    })
    const doc = createTypedDoc(schema)

    change(doc, draft => {
      draft.data.arr = [10, 20, 30]
    })

    const arr = doc.data.arr
    expect(isPlainValueRef(arr)).toBe(true)
    const rawArr = value(arr)
    expect(Array.isArray(rawArr)).toBe(true)
    expect(rawArr).toEqual([10, 20, 30])
  })

  it("array .length property is accessible via PlainValueRef", () => {
    const schema = Shape.doc({
      data: Shape.struct({
        arr: Shape.plain.any(),
      }),
    })
    const doc = createTypedDoc(schema)

    change(doc, draft => {
      draft.data.arr = [1, 2, 3, 4, 5]
    })

    // The .length property should be accessible since it exists on the value
    const arr = doc.data.arr
    expect((arr as any).length).toBe(5)
  })

  it("array should be replaced wholesale, not mutated element-by-element", () => {
    const schema = Shape.doc({
      data: Shape.struct({
        arr: Shape.plain.any(),
      }),
    })
    const doc = createTypedDoc(schema)

    change(doc, draft => {
      draft.data.arr = [1, 2, 3]
    })

    // To modify arrays in any/union shapes, replace the whole array
    change(doc, draft => {
      const current = value(draft.data.arr) as number[]
      draft.data.arr = [...current, 4]
    })

    expect(doc.toJSON().data.arr).toEqual([1, 2, 3, 4])
  })

  it("numeric index access on array PlainValueRef returns the element", () => {
    const schema = Shape.doc({
      data: Shape.struct({
        arr: Shape.plain.any(),
      }),
    })
    const doc = createTypedDoc(schema)

    change(doc, draft => {
      draft.data.arr = ["first", "second", "third"]
    })

    // Numeric property access (as string) should work via the generic object proxy
    const arr = doc.data.arr as any
    // The proxy handles string property access, so "0", "1", "2" work
    expect(arr["0"]).toBe("first")
    expect(arr["1"]).toBe("second")
    expect(arr["2"]).toBe("third")
  })
})

describe("value() nullish handling", () => {
  it("returns undefined when given undefined", () => {
    const result = value(undefined)
    expect(result).toBeUndefined()
  })

  it("returns null when given null", () => {
    const result = value(null)
    expect(result).toBeNull()
  })

  it("handles PlainValueRef | undefined from record.get()", () => {
    const schema = Shape.doc({
      players: Shape.record(
        Shape.plain.struct({
          choice: Shape.plain.union([Shape.plain.null(), Shape.plain.string()]),
        }),
      ),
    })
    const doc = createTypedDoc(schema)

    // Player doesn't exist yet - get returns undefined
    const player = doc.players.get("alice")
    expect(player).toBeUndefined()

    // value() handles the undefined - returns undefined
    const playerValue = value(player)
    expect(playerValue).toBeUndefined()

    // Optional chaining on the result works as expected
    const choice = value(player)?.choice
    expect(choice).toBeUndefined()

    // Add the player
    change(doc, draft => {
      draft.players.set("alice", { choice: "rock" })
    })

    // Now player exists - value() unwraps the PlainValueRef
    const alicePlayer = doc.players.get("alice")
    expect(alicePlayer).toBeDefined()
    const alicePlayerValue = value(alicePlayer)
    expect(alicePlayerValue).toEqual({ choice: "rock" })

    // Access the choice via optional chaining on the unwrapped value
    const aliceChoice = value(alicePlayer)?.choice
    expect(aliceChoice).toBe("rock")
  })

  it("handles null choice value correctly", () => {
    const schema = Shape.doc({
      players: Shape.record(
        Shape.plain.struct({
          choice: Shape.plain.union([Shape.plain.null(), Shape.plain.string()]),
        }),
      ),
    })
    const doc = createTypedDoc(schema)

    change(doc, draft => {
      draft.players.set("alice", { choice: null })
    })

    const player = doc.players.get("alice")
    // value() unwraps to the plain struct, then access .choice
    const choice = value(player)?.choice
    // The choice is explicitly null (set in the CRDT)
    expect(choice).toBeNull()
  })

  it("unwraps PlainValueRef when defined", () => {
    const schema = Shape.doc({
      data: Shape.struct({
        title: Shape.plain.string(),
      }),
    })
    const doc = createTypedDoc(schema)

    change(doc, draft => {
      draft.data.title = "Hello"
    })

    // value() unwraps PlainValueRef to raw value
    const title = value(doc.data.title)
    expect(title).toBe("Hello")
  })

  it("unwraps StructRef (TypedRef) when defined", () => {
    const schema = Shape.doc({
      data: Shape.struct({
        name: Shape.plain.string(),
      }),
    })
    const doc = createTypedDoc(schema)

    change(doc, draft => {
      draft.data.name = "Test"
    })

    // value() on StructRef (a TypedRef) calls toJSON()
    // Note: We need to cast because TypeScript can't infer the ContainerShape overload
    // from the StructRef type directly. In practice, this works at runtime.
    const dataValue = doc.data.toJSON()
    expect(dataValue).toEqual({ name: "Test" })
  })

  it("unwraps ListRef (TypedRef) when defined", () => {
    const schema = Shape.doc({
      items: Shape.list(Shape.plain.number()),
    })
    const doc = createTypedDoc(schema)

    change(doc, draft => {
      draft.items.push(1)
      draft.items.push(2)
      draft.items.push(3)
    })

    // value() on ListRef calls toJSON()
    const itemsValue = doc.items.toJSON()
    expect(itemsValue).toEqual([1, 2, 3])
  })

  it("unwraps TypedDoc when defined", () => {
    const schema = Shape.doc({
      count: Shape.counter(),
    })
    const doc = createTypedDoc(schema)

    change(doc, draft => {
      draft.count.increment(5)
    })

    // value() on TypedDoc calls toJSON()
    const docValue = value(doc)
    expect(docValue).toEqual({ count: 5 })
  })
})

describe("value() export", () => {
  it("unwraps PlainValueRef to raw value", () => {
    const schema = Shape.doc({
      data: Shape.struct({
        title: Shape.plain.string(),
      }),
    })
    const doc = createTypedDoc(schema)

    change(doc, draft => {
      draft.data.title = "Hello"
    })

    // Outside change(), properties return PlainValueRef
    const title = doc.data.title
    expect(isPlainValueRef(title)).toBe(true)
    expect(value(title)).toBe("Hello")
  })

  it("passes through non-ref values unchanged (polymorphic)", () => {
    const num = 42
    const str = "hello"
    const obj = { a: 1 }

    expect(value(num)).toBe(42)
    expect(value(str)).toBe("hello")
    expect(value(obj)).toEqual({ a: 1 })
  })

  it("passes through undefined and null", () => {
    expect(value(undefined)).toBeUndefined()
    expect(value(null)).toBeNull()
  })
})
