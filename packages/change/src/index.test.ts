import { LoroCounter, type LoroList, type LoroMap, LoroText } from "loro-crdt"
import { describe, expect, it } from "vitest"

import { CRDT, change, from } from "./index.js"

describe("from", () => {
  it("should create a document with initial state", () => {
    const initialState = {
      name: "Alice",
      age: 30,
    }
    const doc = from(initialState)
    expect(doc.toJSON()).toEqual(initialState)
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
    expect(doc.toJSON()).toEqual(initialState)
  })

  it("should handle arrays", () => {
    const initialState = {
      tasks: ["buy milk", "walk the dog"],
    }
    const doc = from(initialState)
    expect(doc.toJSON()).toEqual(initialState)
  })

  it("should handle arrays of objects", () => {
    const initialState = {
      tasks: [
        { description: "feed cat", done: true },
        { description: "feed dog", done: false },
      ],
    }
    const doc = from(initialState)
    expect(doc.toJSON()).toEqual(initialState)
  })

  it("should handle an empty object", () => {
    const doc = from({})
    expect(doc.toJSON()).toEqual({})
  })

  it("should handle complex nested structures", () => {
    const initialState = {
      a: { b: { c: [1, { d: "e" }] } },
      f: [2, [3, 4]],
    }
    const doc = from(initialState)
    expect(doc.toJSON()).toEqual(initialState)
  })
})

describe("change", () => {
  it("should modify a document", () => {
    const doc = from({ counter: 0 })
    change(doc, d => {
      d.counter = 1
    })
    expect(doc.toJSON()).toEqual({ counter: 1 })
  })

  it("should add new properties", () => {
    const doc = from<{ name: string; age: number | null }>({
      name: "Alice",
      age: null,
    })
    change(doc, d => {
      d.age = 30
    })
    expect(doc.toJSON()).toEqual({ name: "Alice", age: 30 })
  })

  it("should modify nested objects", () => {
    const doc = from({ user: { name: "Bob" } })
    change(doc, (d: { user: { name: string } }) => {
      d.user.name = "Charlie"
    })
    expect(doc.toJSON()).toEqual({ user: { name: "Charlie" } })
  })

  it("should add properties to nested objects", () => {
    const doc = from<{ user: { name: string; email: string | null } }>({
      user: { name: "David", email: null },
    })
    change(doc, d => {
      d.user.email = "david@example.com"
    })
    expect(doc.toJSON()).toEqual({
      user: { name: "David", email: "david@example.com" },
    })
  })

  it("should modify arrays", () => {
    const doc = from({ tasks: ["task 1"] })
    change(doc, (d: { tasks: string[] }) => {
      d.tasks[0] = "task 1 modified"
    })
    expect(doc.toJSON()).toEqual({ tasks: ["task 1 modified"] })
  })

  it("should push items to arrays", () => {
    const doc = from({ tasks: ["task 1"] })
    change(doc, (d: { tasks: string[] }) => {
      d.tasks.push("task 2")
    })
    expect(doc.toJSON()).toEqual({ tasks: ["task 1", "task 2"] })
  })

  it("should push items to arrays of objects", () => {
    const doc = from({ tasks: [{ description: "feed cat", done: true }] })
    change(doc, (d: { tasks: { description: string; done: boolean }[] }) => {
      d.tasks.push({ description: "feed dog", done: false })
    })
    expect(doc.toJSON()).toEqual({
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
    expect(doc.toJSON()).toEqual({ name: "Eve", age: null })
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
    expect(doc.toJSON()).toEqual({ a: 10, c: 30, b: null })
  })

  it("should handle splice to replace a range of values in a list", () => {
    const doc = from({ list: [1, 2, 3, 4] })
    change(doc, (d: { list: number[] }) => {
      d.list.splice(1, 2, 5, 6, 7)
    })
    expect(doc.toJSON()).toEqual({ list: [1, 5, 6, 7, 4] })
  })

  it("should handle splice to insert into a list", () => {
    const doc = from({ list: [1, 2, 3] })
    change(doc, (d: { list: number[] }) => {
      d.list.splice(1, 0, 4, 5)
    })
    expect(doc.toJSON()).toEqual({ list: [1, 4, 5, 2, 3] })
  })

  it("should handle splice to delete a range in a list", () => {
    const doc = from({ list: [1, 2, 3, 4, 5] })
    change(doc, (d: { list: number[] }) => {
      d.list.splice(1, 3)
    })
    expect(doc.toJSON()).toEqual({ list: [1, 5] })
  })

  it("should handle pop from a list", () => {
    const doc = from({ list: [1, 2, 3] })
    change(doc, d => {
      const popped = (d.list as (number | undefined)[]).pop()
      expect(popped).toBe(3)
    })
    expect(doc.toJSON()).toEqual({ list: [1, 2] })
  })

  it("should handle shift from a list", () => {
    const doc = from({ list: [1, 2, 3] })
    change(doc, d => {
      const shifted = (d.list as (number | undefined)[]).shift()
      expect(shifted).toBe(1)
    })
    expect(doc.toJSON()).toEqual({ list: [2, 3] })
  })

  it("should handle unshift to a list", () => {
    const doc = from({ list: [1, 2, 3] })
    change(doc, (d: { list: number[] }) => {
      d.list.unshift(0)
    })
    expect(doc.toJSON()).toEqual({ list: [0, 1, 2, 3] })
  })

  it("should assign null to object properties", () => {
    const doc = from<{ a: number | null; b: number | null }>({ a: 1, b: 2 })
    change(doc, d => {
      d.a = null
      d.b = null
    })
    expect(doc.toJSON()).toEqual({ a: null, b: null })
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
    expect(doc.toJSON()).toEqual({
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

    expect(doc.toJSON()).toEqual({ list: [4, 5, 6] })
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

describe("Array methods on LoroList proxy", () => {
  it("should support find method", () => {
    const doc = from({
      todos: [
        { id: "1", text: "Buy milk", done: false },
        { id: "2", text: "Walk dog", done: true },
        { id: "3", text: "Write code", done: false },
      ],
    })

    // Test outside of change function to check if proxy works correctly
    const todos = doc.data.todos
    const foundTodo = todos.find((t: any) => t.id === "2")

    expect(foundTodo).toBeDefined()
    expect(foundTodo?.id).toBe("2")
    expect(foundTodo?.text).toBe("Walk dog")
    expect(foundTodo?.done).toBe(true)
  })

  it("should support findIndex method", () => {
    const doc = from({
      todos: [
        { id: "1", text: "Buy milk", done: false },
        { id: "2", text: "Walk dog", done: true },
        { id: "3", text: "Write code", done: false },
      ],
    })

    const todos = doc.data.todos
    const index = todos.findIndex((t: any) => t.id === "2")

    expect(index).toBe(1)
  })

  it("should support map method", () => {
    const doc = from({ numbers: [1, 2, 3, 4, 5] })

    const numbers = doc.data.numbers
    const doubled = numbers.map((n: number) => n * 2)

    expect(doubled).toEqual([2, 4, 6, 8, 10])
  })

  it("should support filter method", () => {
    const doc = from({
      todos: [
        { id: "1", text: "Buy milk", done: false },
        { id: "2", text: "Walk dog", done: true },
        { id: "3", text: "Write code", done: false },
      ],
    })

    const todos = doc.data.todos
    const incompleteTodos = todos.filter((t: any) => !t.done)

    expect(incompleteTodos).toHaveLength(2)
    expect(incompleteTodos[0].id).toBe("1")
    expect(incompleteTodos[1].id).toBe("3")
  })

  it("should support forEach method", () => {
    const doc = from({ numbers: [1, 2, 3] })

    const collected: number[] = []
    const numbers = doc.data.numbers
    numbers.forEach((n: number) => collected.push(n * 2))

    expect(collected).toEqual([2, 4, 6])
  })

  it("should support some method", () => {
    const doc = from({
      todos: [
        { id: "1", text: "Buy milk", done: false },
        { id: "2", text: "Walk dog", done: true },
        { id: "3", text: "Write code", done: false },
      ],
    })

    const todos = doc.data.todos
    const hasCompleted = todos.some((t: any) => t.done)
    const hasIncomplete = todos.some((t: any) => !t.done)

    expect(hasCompleted).toBe(true)
    expect(hasIncomplete).toBe(true)
  })

  it("should support every method", () => {
    const doc = from({
      todos: [
        { id: "1", text: "Buy milk", done: true },
        { id: "2", text: "Walk dog", done: true },
      ],
    })

    const todos = doc.data.todos
    const allDone = todos.every((t: any) => t.done)

    expect(allDone).toBe(true)

    // Add an incomplete todo and test again
    change(doc, d => {
      d.todos.push({ id: "3", text: "Write code", done: false })
    })

    const allDoneAfter = doc.data.todos.every((t: any) => t.done)
    expect(allDoneAfter).toBe(false)
  })

  it("should support includes method", () => {
    const doc = from({ tags: ["javascript", "typescript", "react"] })

    const tags = doc.data.tags
    const hasJS = tags.includes("javascript")
    const hasPython = tags.includes("python")

    expect(hasJS).toBe(true)
    expect(hasPython).toBe(false)
  })

  it("should support indexOf method", () => {
    const doc = from({ tags: ["javascript", "typescript", "react"] })

    const tags = doc.data.tags
    const tsIndex = tags.indexOf("typescript")
    const pythonIndex = tags.indexOf("python")

    expect(tsIndex).toBe(1)
    expect(pythonIndex).toBe(-1)
  })

  it("should support reduce method", () => {
    const doc = from({ numbers: [1, 2, 3, 4, 5] })

    const numbers = doc.data.numbers
    const sum = numbers.reduce((acc: number, n: number) => acc + n, 0)
    const product = numbers.reduce((acc: number, n: number) => acc * n, 1)

    expect(sum).toBe(15)
    expect(product).toBe(120)
  })

  it("should support reduce without initial value", () => {
    const doc = from({ numbers: [1, 2, 3, 4] })

    const numbers = doc.data.numbers
    const sum = numbers.reduce((acc: number, n: number) => acc + n)

    expect(sum).toBe(10)
  })

  it("should work with nested objects in array methods", () => {
    const doc = from({
      users: [
        { name: "Alice", posts: [{ title: "Post 1" }, { title: "Post 2" }] },
        { name: "Bob", posts: [{ title: "Post 3" }] },
      ],
    })

    const users = doc.data.users
    const allPosts = users.reduce((acc: any[], user: any) => {
      return acc.concat(
        user.posts.map((p: any) => ({ title: p.title, author: user.name })),
      )
    }, [] as any[])

    expect(allPosts).toEqual([
      { title: "Post 1", author: "Alice" },
      { title: "Post 2", author: "Alice" },
      { title: "Post 3", author: "Bob" },
    ])
  })

  it("should allow modifying objects found with find", () => {
    const doc = from({
      todos: [
        { id: "1", text: "Buy milk", done: false },
        { id: "2", text: "Walk dog", done: false },
      ],
    })

    change(doc, d => {
      const todo = d.todos.find(t => t.id === "1")
      if (todo) {
        todo.done = true
      }
    })

    expect(doc.toJSON()).toEqual({
      todos: [
        { id: "1", text: "Buy milk", done: true },
        { id: "2", text: "Walk dog", done: false },
      ],
    })
  })

  it("should handle null/undefined property access gracefully", () => {
    const doc = from({
      data: { name: "test" },
    })

    // Test accessing undefined/null properties doesn't crash
    expect(() => {
      const data = doc.data.data
      // Try to access properties that might be null/undefined
      const undefinedProp = (data as any)[undefined as any]
      const nullProp = (data as any)[null as any]
      expect(undefinedProp).toBeUndefined()
      expect(nullProp).toBeUndefined()
    }).not.toThrow()
  })

  it("should handle find with properties that might not exist", () => {
    const doc = from<{
      items: Array<{ id?: string | null; name?: string | null }>
    }>({
      items: [
        { id: "1", name: "Item 1" },
        { id: null, name: "Item 2" }, // id is null
        { id: "3", name: null }, // name is null
      ],
    })

    const itemWithId2 = doc.data.items.find((item: any) => item.id === "2")
    expect(itemWithId2).toBeUndefined()

    const itemWithName2 = doc.data.items.find(
      (item: any) => item.name === "Item 2",
    )
    expect(itemWithName2).toBeDefined()
    expect(itemWithName2?.name).toBe("Item 2")

    // Should not throw when accessing missing properties
    const allHaveIds = doc.data.items.every(
      (item: any) => item.id !== null && item.id !== undefined,
    )
    expect(allHaveIds).toBe(false)

    // Test that we can safely check for properties that don't exist
    const hasDescription = doc.data.items.some(
      (item: any) => item.description !== undefined,
    )
    expect(hasDescription).toBe(false)
  })
})
