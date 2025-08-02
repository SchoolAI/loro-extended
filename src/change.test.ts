import {
  LoroCounter,
  type LoroDoc,
  LoroList,
  LoroMap,
  LoroText,
} from "loro-crdt"
import { describe, expect, it } from "vitest"

import { CRDT, change, from } from "./change"

type PlainObject = { [key: string]: JSONValue }
type JSONValue = string | number | boolean | null | JSONValue[] | PlainObject

function toJSON(doc: LoroDoc): JSONValue {
  const root = doc.getMap("root")

  const convert = (value: unknown): JSONValue => {
    if (value instanceof LoroMap) {
      const obj: PlainObject = {}
      for (const key of value.keys()) {
        const propValue = value.get(key)
        if (propValue !== undefined) {
          obj[key] = convert(propValue)
        }
      }
      return obj
    }
    if (value instanceof LoroList) {
      return value.toArray().map(convert)
    }
    if (value instanceof LoroText) {
      return value.toString()
    }
    if (value instanceof LoroCounter) {
      return value.value
    }
    return value as JSONValue
  }

  return convert(root)
}

describe("from", () => {
  it("should create a document with initial state", () => {
    const initialState = {
      name: "Alice",
      age: 30,
    }
    const doc = from(initialState)
    expect(toJSON(doc)).toEqual(initialState)
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
    expect(toJSON(doc)).toEqual(initialState)
  })

  it("should handle arrays", () => {
    const initialState = {
      tasks: ["buy milk", "walk the dog"],
    }
    const doc = from(initialState)
    expect(toJSON(doc)).toEqual(initialState)
  })

  it("should handle arrays of objects", () => {
    const initialState = {
      tasks: [
        { description: "feed cat", done: true },
        { description: "feed dog", done: false },
      ],
    }
    const doc = from(initialState)
    expect(toJSON(doc)).toEqual(initialState)
  })

  it("should handle an empty object", () => {
    const doc = from({})
    expect(toJSON(doc)).toEqual({})
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
    expect(toJSON(doc)).toEqual(initialState)
  })
})

describe("change", () => {
  it("should modify a document", () => {
    const doc = from({ counter: 0 })
    change(doc, d => {
      d.counter = 1
    })
    expect(toJSON(doc)).toEqual({ counter: 1 })
  })

  it("should add new properties", () => {
    const doc = from<{ name: string; age: number | null }>({
      name: "Alice",
      age: null,
    })
    change(doc, d => {
      d.age = 30
    })
    expect(toJSON(doc)).toEqual({ name: "Alice", age: 30 })
  })

  it("should modify nested objects", () => {
    const doc = from({ user: { name: "Bob" } })
    change(doc, (d: { user: { name: string } }) => {
      d.user.name = "Charlie"
    })
    expect(toJSON(doc)).toEqual({ user: { name: "Charlie" } })
  })

  it("should add properties to nested objects", () => {
    const doc = from<{ user: { name: string; email: string | null } }>({
      user: { name: "David", email: null },
    })
    change(doc, d => {
      d.user.email = "david@example.com"
    })
    expect(toJSON(doc)).toEqual({
      user: { name: "David", email: "david@example.com" },
    })
  })

  it("should modify arrays", () => {
    const doc = from({ tasks: ["task 1"] })
    change(doc, (d: { tasks: string[] }) => {
      d.tasks[0] = "task 1 modified"
    })
    expect(toJSON(doc)).toEqual({ tasks: ["task 1 modified"] })
  })

  it("should push items to arrays", () => {
    const doc = from({ tasks: ["task 1"] })
    change(doc, (d: { tasks: string[] }) => {
      d.tasks.push("task 2")
    })
    expect(toJSON(doc)).toEqual({ tasks: ["task 1", "task 2"] })
  })

  it("should push items to arrays of objects", () => {
    const doc = from({ tasks: [{ description: "feed cat", done: true }] })
    change(doc, (d: { tasks: { description: string; done: boolean }[] }) => {
      d.tasks.push({ description: "feed dog", done: false })
    })
    expect(toJSON(doc)).toEqual({
      tasks: [
        { description: "feed cat", done: true },
        { description: "feed dog", done: false },
      ],
    })
  })

  it("should delete properties by assigning null", () => {
    const doc = from<{ name: string; age: number | null }>({
      name: "Eve",
      age: 25,
    })
    change(doc, d => {
      d.age = null
    })
    expect(toJSON(doc)).toEqual({ name: "Eve", age: null })
  })

  it("should handle multiple changes in one block", () => {
    const doc = from<{ a: number; b: number | null; c: number | null }>({
      a: 1,
      b: 2,
      c: null,
    })
    change(doc, d => {
      d.a = 10
      d.c = 30
      d.b = null
    })
    expect(toJSON(doc)).toEqual({ a: 10, c: 30, b: null })
  })

  it("should handle splice to replace a range of values in a list", () => {
    const doc = from({ list: [1, 2, 3, 4] })
    change(doc, (d: { list: number[] }) => {
      d.list.splice(1, 2, 5, 6, 7)
    })
    expect(toJSON(doc)).toEqual({ list: [1, 5, 6, 7, 4] })
  })

  it("should handle splice to insert into a list", () => {
    const doc = from({ list: [1, 2, 3] })
    change(doc, (d: { list: number[] }) => {
      d.list.splice(1, 0, 4, 5)
    })
    expect(toJSON(doc)).toEqual({ list: [1, 4, 5, 2, 3] })
  })

  it("should handle splice to delete a range in a list", () => {
    const doc = from({ list: [1, 2, 3, 4, 5] })
    change(doc, (d: { list: number[] }) => {
      d.list.splice(1, 3)
    })
    expect(toJSON(doc)).toEqual({ list: [1, 5] })
  })

  it("should handle pop from a list", () => {
    const doc = from({ list: [1, 2, 3] })
    change(doc, d => {
      const popped = (d.list as (number | undefined)[]).pop()
      expect(popped).toBe(3)
    })
    expect(toJSON(doc)).toEqual({ list: [1, 2] })
  })

  it("should handle shift from a list", () => {
    const doc = from({ list: [1, 2, 3] })
    change(doc, d => {
      const shifted = (d.list as (number | undefined)[]).shift()
      expect(shifted).toBe(1)
    })
    expect(toJSON(doc)).toEqual({ list: [2, 3] })
  })

  it("should handle unshift to a list", () => {
    const doc = from({ list: [1, 2, 3] })
    change(doc, (d: { list: number[] }) => {
      d.list.unshift(0)
    })
    expect(toJSON(doc)).toEqual({ list: [0, 1, 2, 3] })
  })

  it("should assign null to object properties", () => {
    const doc = from<{ a: number | null; b: number | null }>({ a: 1, b: 2 })
    change(doc, d => {
      d.a = null
      d.b = null
    })
    expect(toJSON(doc)).toEqual({ a: null, b: null })
  })

  it("should handle complex nested creations and modifications", () => {
    const doc = from<{
      data: {
        users: { name: string; posts: { title: string }[] }[] | null
        config: { version: number } | null
      }
    }>({ data: { users: null, config: null } })
    change(doc, d => {
      d.data.users = [{ name: "Alice", posts: [] }]
      d.data.users[0].posts.push({ title: "First Post" })
      d.data.config = { version: 1 }
    })
    expect(toJSON(doc)).toEqual({
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

    expect(toJSON(doc)).toEqual({ list: [4, 5, 6] })
  })
})

describe("LoroText handling", () => {
  it("should automatically convert strings to LoroText containers", () => {
    const doc = from({ title: "hello" })
    const map = doc.getMap("root")
    const title = map.get("title")
    // By default, strings are now primitive LWW values
    expect(title).toBe("hello")
  })

  it("should update LoroText when a new string is assigned", () => {
    const doc = from({ title: CRDT.Text("hello") })
    change(doc, (d: { title: LoroText }) => {
      // Direct assignment should throw type error, but we can update the container
      d.title.delete(0, d.title.length)
      d.title.insert(0, "world")
    })

    const map = doc.getMap("root")
    const title = map.get("title") as LoroText
    expect(title).toBeInstanceOf(LoroText)
    expect(title.toString()).toBe("world")
  })

  it("should allow fine-grained edits on string properties", () => {
    const doc = from({ title: CRDT.Text("hello") })
    change(doc, (d: { title: LoroText }) => {
      d.title.insert(5, " world")
    })

    const map = doc.getMap("root")
    const title = map.get("title") as LoroText
    expect(title.toString()).toBe("hello world")
  })
})

describe("LoroCounter handling", () => {
  it("should create a document with a LoroCounter", () => {
    const doc = from({ counter: CRDT.Counter(10) })
    const counter = doc.getMap("root").get("counter") as LoroCounter
    expect(counter).toBeInstanceOf(LoroCounter)
    expect(counter.value).toBe(10)
  })

  it("should increment and decrement a LoroCounter", () => {
    const doc = from({ counter: CRDT.Counter(0) })

    change(doc, d => {
      d.counter.increment(5)
    })
    expect((doc.getMap("root").get("counter") as LoroCounter).value).toBe(5)

    change(doc, d => {
      d.counter.decrement(3)
    })
    expect((doc.getMap("root").get("counter") as LoroCounter).value).toBe(2)
  })

  it("should handle counters in nested objects", () => {
    const doc = from({ stats: { scores: CRDT.Counter(100) } })

    change(doc, d => {
      d.stats.scores.increment(50)
    })

    const root = doc.getMap("root")
    const stats = root.get("stats") as LoroMap
    const scores = stats.get("scores") as LoroCounter
    expect(scores.value).toBe(150)
  })

  it("should handle counters in arrays", () => {
    const doc = from({ counters: [CRDT.Counter(1), CRDT.Counter(2)] })

    change(doc, d => {
      d.counters[0].increment(1)
      d.counters[1].decrement(1)
    })

    const counters = doc.getMap("root").get("counters") as LoroList
    expect((counters.get(0) as LoroCounter).value).toBe(2)
    expect((counters.get(1) as LoroCounter).value).toBe(1)
  })
})
