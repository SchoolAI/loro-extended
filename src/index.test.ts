import { type LoroDoc, LoroText } from "loro-crdt"
import { describe, expect, it } from "vitest"

import { change, from } from "./index"

type PlainObject = { [key: string]: JSONValue }
type JSONValue = string | number | boolean | null | JSONValue[] | PlainObject

function toJS(doc: LoroDoc): JSONValue {
  const raw = doc.getMap("root").toJSON()

  const clean = (obj: unknown): JSONValue => {
    if (Array.isArray(obj)) {
      return obj.map(clean)
    }
    if (obj instanceof LoroText) {
      return obj.toString()
    }
    if (obj !== null && typeof obj === "object") {
      const newObj: PlainObject = {}
      for (const key in obj as PlainObject) {
        if (
          // biome-ignore lint/suspicious/noPrototypeBuiltins: proxy
          Object.prototype.hasOwnProperty.call(obj, key) &&
          (obj as PlainObject)[key] !== null &&
          (obj as PlainObject)[key] !== undefined
        ) {
          newObj[key] = clean((obj as PlainObject)[key])
        }
      }
      return newObj
    }
    return obj as JSONValue
  }

  return clean(raw)
}

describe("from", () => {
  it("should create a document with initial state", () => {
    const initialState = {
      name: "Alice",
      age: 30,
    }
    const doc = from(initialState)
    expect(toJS(doc)).toEqual(initialState)
  })

  it("should handle nested objects", () => {
    const initialState = {
      user: {
        name: "Bob",
        address: {
          city: "New York",
        },
      },
    }
    const doc = from(initialState)
    expect(toJS(doc)).toEqual(initialState)
  })

  it("should handle arrays", () => {
    const initialState = {
      tasks: ["buy milk", "walk the dog"],
    }
    const doc = from(initialState)
    expect(toJS(doc)).toEqual(initialState)
  })

  it("should handle arrays of objects", () => {
    const initialState = {
      tasks: [
        { description: "feed cat", done: true },
        { description: "feed dog", done: false },
      ],
    }
    const doc = from(initialState)
    expect(toJS(doc)).toEqual(initialState)
  })

  it("should handle an empty object", () => {
    const doc = from({})
    expect(toJS(doc)).toEqual({})
  })

  it("should handle complex nested structures", () => {
    const initialState = {
      a: {
        b: {
          c: [1, { d: "e" }],
        },
      },
      f: [2, [3, 4]],
    }
    const doc = from(initialState)
    expect(toJS(doc)).toEqual(initialState)
  })
})

describe("change", () => {
  it("should modify a document", () => {
    const doc = from({ counter: 0 })
    change(doc, (d: { counter: number }) => {
      d.counter = 1
    })
    expect(toJS(doc)).toEqual({ counter: 1 })
  })

  it("should add new properties", () => {
    const doc = from({ name: "Alice" })
    change(doc, (d: { name: string; age?: number }) => {
      d.age = 30
    })
    expect(toJS(doc)).toEqual({ name: "Alice", age: 30 })
  })

  it("should modify nested objects", () => {
    const doc = from({ user: { name: "Bob" } })
    change(doc, (d: { user: { name: string } }) => {
      d.user.name = "Charlie"
    })
    expect(toJS(doc)).toEqual({ user: { name: "Charlie" } })
  })

  it("should add properties to nested objects", () => {
    const doc = from({ user: { name: "David" } })
    change(doc, (d: { user: { name: string; email?: string } }) => {
      d.user.email = "david@example.com"
    })
    expect(toJS(doc)).toEqual({
      user: { name: "David", email: "david@example.com" },
    })
  })

  it("should modify arrays", () => {
    const doc = from({ tasks: ["task 1"] })
    change(doc, (d: { tasks: string[] }) => {
      d.tasks[0] = "task 1 modified"
    })
    expect(toJS(doc)).toEqual({ tasks: ["task 1 modified"] })
  })

  it("should push items to arrays", () => {
    const doc = from({ tasks: ["task 1"] })
    change(doc, (d: { tasks: string[] }) => {
      d.tasks.push("task 2")
    })
    expect(toJS(doc)).toEqual({ tasks: ["task 1", "task 2"] })
  })

  it("should delete properties", () => {
    const doc = from({ name: "Eve", age: 25 })
    change(doc, (d: { name: string; age?: number }) => {
      delete d.age
    })
    expect(toJS(doc)).toEqual({ name: "Eve" })
  })

  it("should handle multiple changes in one block", () => {
    const doc = from({ a: 1, b: 2 })
    change(doc, (d: { a: number; b?: number; c?: number }) => {
      d.a = 10
      d.c = 30
      delete d.b
    })
    expect(toJS(doc)).toEqual({ a: 10, c: 30 })
  })

  it("should handle splice to replace a range of values in a list", () => {
    const doc = from({ list: [1, 2, 3, 4] })
    change(doc, (d: { list: number[] }) => {
      d.list.splice(1, 2, 5, 6, 7)
    })
    expect(toJS(doc)).toEqual({ list: [1, 5, 6, 7, 4] })
  })

  it("should handle splice to insert into a list", () => {
    const doc = from({ list: [1, 2, 3] })
    change(doc, (d: { list: number[] }) => {
      d.list.splice(1, 0, 4, 5)
    })
    expect(toJS(doc)).toEqual({ list: [1, 4, 5, 2, 3] })
  })

  it("should handle splice to delete a range in a list", () => {
    const doc = from({ list: [1, 2, 3, 4, 5] })
    change(doc, (d: { list: number[] }) => {
      d.list.splice(1, 3)
    })
    expect(toJS(doc)).toEqual({ list: [1, 5] })
  })

  it("should handle pop from a list", () => {
    const doc = from({ list: [1, 2, 3] })
    change(doc, (d: { list: (number | undefined)[] }) => {
      const popped = d.list.pop()
      expect(popped).toBe(3)
    })
    expect(toJS(doc)).toEqual({ list: [1, 2] })
  })

  it("should handle shift from a list", () => {
    const doc = from({ list: [1, 2, 3] })
    change(doc, (d: { list: (number | undefined)[] }) => {
      const shifted = d.list.shift()
      expect(shifted).toBe(1)
    })
    expect(toJS(doc)).toEqual({ list: [2, 3] })
  })

  it("should handle unshift to a list", () => {
    const doc = from({ list: [1, 2, 3] })
    change(doc, (d: { list: number[] }) => {
      d.list.unshift(0)
    })
    expect(toJS(doc)).toEqual({ list: [0, 1, 2, 3] })
  })

  it("should assign null and undefined to object properties", () => {
    const doc = from({ a: 1, b: 2 })
    change(doc, (d: { a: null; b: undefined }) => {
      d.a = null
      d.b = undefined
    })
    expect(toJS(doc)).toEqual({})
  })

  it("should handle complex nested creations and modifications", () => {
    const doc = from({ data: {} })
    change(
      doc,
      (d: {
        data: {
          users?: { name: string; posts: { title: string }[] }[]
          config?: { version: number }
        }
      }) => {
        d.data.users = [{ name: "Alice", posts: [] }]
        d.data.users[0].posts.push({ title: "First Post" })
        d.data.config = { version: 1 }
      },
    )
    expect(toJS(doc)).toEqual({
      data: {
        users: [{ name: "Alice", posts: [{ title: "First Post" }] }],
        config: { version: 1 },
      },
    })
  })

  it("should allow overwriting an array", () => {
    const doc = from({ list: [1, 2, 3] })
    change(doc, (d: { list: number[] }) => {
      d.list = [4, 5, 6]
    })

    expect(toJS(doc)).toEqual({ list: [4, 5, 6] })
  })
})

describe("LoroText handling", () => {
  it("should automatically convert strings to LoroText containers", () => {
    const doc = from({ title: "hello" })
    const map = doc.getMap("root")
    const title = map.get("title") as LoroText
    expect(title).toBeInstanceOf(LoroText)
    expect(title.toString()).toBe("hello")
  })

  it("should update LoroText when a new string is assigned", () => {
    const doc = from({ title: "hello" })
    change(doc, (d: { title: string }) => {
      d.title = "world"
    })

    const map = doc.getMap("root")
    const title = map.get("title") as LoroText
    expect(title).toBeInstanceOf(LoroText)
    expect(title.toString()).toBe("world")
  })

  it("should allow fine-grained edits on string properties", () => {
    const doc = from({ title: "hello" })
    change(doc, (d: { title: LoroText }) => {
      d.title.insert(5, " world")
    })

    const map = doc.getMap("root")
    const title = map.get("title") as LoroText
    expect(title.toString()).toBe("hello world")
  })
})
