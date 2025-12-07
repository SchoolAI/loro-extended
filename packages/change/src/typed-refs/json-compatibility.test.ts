import { describe, expect, it } from "vitest"
import { Shape } from "../shape.js"
import { createTypedDoc } from "../typed-doc.js"

const MessageSchema = Shape.map({
  id: Shape.plain.string(),
  content: Shape.text(),
  timestamp: Shape.plain.number(),
})

const ChatSchema = Shape.doc({
  messages: Shape.list(MessageSchema),
  meta: Shape.map({
    title: Shape.plain.string(),
    count: Shape.counter(),
  }),
  tags: Shape.movableList(Shape.plain.string()),
  settings: Shape.record(Shape.plain.boolean()),
  // Tree support might be limited in current implementation
  // tree: Shape.tree(Shape.map({ val: Shape.plain.number() }))
})

describe("JSON Compatibility", () => {
  it("should support JSON.stringify on the whole doc", () => {
    const doc = createTypedDoc(ChatSchema)

    doc.change((root: any) => {
      root.meta.title = "My Chat"
      root.meta.count.increment(5)

      root.messages.push({
        id: "1",
        content: "Hello",
        timestamp: 123,
      })

      root.tags.push("work")
      root.tags.push("important")

      root.settings.set("notifications", true)
      root.settings.set("sound", false)
    })

    const json = JSON.stringify(doc.value)
    const parsed = JSON.parse(json)

    expect(parsed).toEqual({
      messages: [
        {
          id: "1",
          content: "Hello",
          timestamp: 123,
        },
      ],
      meta: {
        title: "My Chat",
        count: 5,
      },
      tags: ["work", "important"],
      settings: {
        notifications: true,
        sound: false,
      },
    })
  })

  it("should support Object.keys and Object.entries", () => {
    const doc = createTypedDoc(ChatSchema)
    doc.change((root: any) => {
      root.meta.title = "Test"
    })

    const keys = Object.keys(doc.value)
    expect(keys).toContain("messages")
    expect(keys).toContain("meta")
    expect(keys).toContain("tags")
    expect(keys).toContain("settings")

    const entries = Object.entries(doc.value.meta)
    const entryMap = new Map(entries)
    expect(entryMap.get("title")).toBe("Test")
    expect(entryMap.get("count")).toBeDefined()
  })

  it("should support JSON.stringify on nested structures", () => {
    const doc = createTypedDoc(ChatSchema)
    doc.change((root: any) => {
      root.messages.push({ id: "1", content: "A", timestamp: 1 })
    })

    const messagesJson = JSON.stringify(doc.value.messages)
    expect(JSON.parse(messagesJson)).toEqual([
      { id: "1", content: "A", timestamp: 1 },
    ])
  })

  it("should support MovableList", () => {
    const doc = createTypedDoc(ChatSchema)
    doc.change((root: any) => {
      root.tags.push("a")
      root.tags.push("b")
      root.tags.move(0, 1) // move 'a' to index 1
    })

    // After move: ["b", "a"]
    const json = JSON.stringify(doc.value.tags)
    expect(JSON.parse(json)).toEqual(["b", "a"])
  })

  it("should support Record", () => {
    const doc = createTypedDoc(ChatSchema)
    doc.change((root: any) => {
      root.settings.set("dark_mode", true)
    })

    const json = JSON.stringify(doc.value.settings)
    expect(JSON.parse(json)).toEqual({ dark_mode: true })
  })

  it("should support Readonly vs Mutable consistency", () => {
    const doc = createTypedDoc(ChatSchema)
    let mutableJson = ""

    doc.change((root: any) => {
      root.meta.title = "Draft"
      mutableJson = JSON.stringify(root)
    })

    const readonlyJson = JSON.stringify(doc.value)
    expect(readonlyJson).toBe(mutableJson)
  })

  it("should handle placeholders", () => {
    const doc = createTypedDoc(ChatSchema)
    // No changes made

    const json = JSON.stringify(doc.value)
    const parsed = JSON.parse(json)

    expect(parsed.meta.title).toBe("") // Default string placeholder
    expect(parsed.meta.count).toBe(0) // Default counter placeholder
    expect(parsed.messages).toEqual([])
  })

  it("should support Array methods on Lists", () => {
    const doc = createTypedDoc(ChatSchema)
    doc.change((root: any) => {
      root.messages.push({ id: "1", content: "A", timestamp: 10 })
      root.messages.push({ id: "2", content: "B", timestamp: 20 })
    })

    const mapped = doc.value.messages.map(m => ({ id: m.id, txt: m.content }))
    expect(JSON.stringify(mapped)).toBe(
      '[{"id":"1","txt":"A"},{"id":"2","txt":"B"}]',
    )

    const filtered = doc.value.messages.filter(m => m.timestamp > 15)
    expect(filtered).toHaveLength(1)
    expect(filtered[0].id).toBe("2")
    // filtered returns MutableItems (TypedRefs), so JSON.stringify should work on them
    expect(JSON.stringify(filtered)).toBe(
      '[{"id":"2","content":"B","timestamp":20}]',
    )
  })

  it("should support Object.values", () => {
    const doc = createTypedDoc(ChatSchema)
    doc.change((root: any) => {
      root.settings.set("a", true)
      root.settings.set("b", false)
    })

    const values = Object.values(doc.value.settings)
    expect(values).toContain(true)
    expect(values).toContain(false)
    expect(values).toHaveLength(2)
  })
})
