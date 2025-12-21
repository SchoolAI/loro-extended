import { LoroDoc } from "loro-crdt"
import { describe, expect, it, vi } from "vitest"
import { change } from "../functional-helpers.js"
import { Shape } from "../shape.js"
import { createTypedDoc } from "../typed-doc.js"
import type { Mutable } from "../types.js"

const MessageSchema = Shape.struct({
  id: Shape.plain.string(),
  content: Shape.text(),
  timestamp: Shape.plain.number(),
})

const ChatSchema = Shape.doc({
  messages: Shape.list(MessageSchema),
  meta: Shape.struct({
    title: Shape.plain.string(),
    count: Shape.counter(),
  }),
  tags: Shape.movableList(Shape.plain.string()),
  settings: Shape.record(Shape.plain.boolean()),
  // Tree support might be limited in current implementation
  // tree: Shape.tree(Shape.struct({ val: Shape.plain.number() }))
})

describe("JSON Compatibility", () => {
  it("should support JSON.stringify on the whole doc", () => {
    const doc = createTypedDoc(ChatSchema)

    change(doc, (root: any) => {
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

    // Use doc.toJSON() to get plain JSON, then stringify
    const json = JSON.stringify(doc.toJSON())
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
    change(doc, (root: any) => {
      root.meta.title = "Test"
    })

    // With the new proxy API, Object.keys works directly on doc
    const keys = Object.keys(doc)
    expect(keys).toContain("messages")
    expect(keys).toContain("meta")
    expect(keys).toContain("tags")
    expect(keys).toContain("settings")

    const entries = Object.entries(doc.meta)
    const entryMap = new Map(entries)
    expect(entryMap.get("title")).toBe("Test")
    expect(entryMap.get("count")).toBeDefined()
  })

  it("should support JSON.stringify on nested structures", () => {
    const doc = createTypedDoc(ChatSchema)
    change(doc, (root: any) => {
      root.messages.push({ id: "1", content: "A", timestamp: 1 })
    })

    const messagesJson = JSON.stringify(doc.messages)
    expect(JSON.parse(messagesJson)).toEqual([
      { id: "1", content: "A", timestamp: 1 },
    ])
  })

  it("should support MovableList", () => {
    const doc = createTypedDoc(ChatSchema)
    change(doc, (root: any) => {
      root.tags.push("a")
      root.tags.push("b")
      root.tags.move(0, 1) // move 'a' to index 1
    })

    // After move: ["b", "a"]
    const json = JSON.stringify(doc.tags)
    expect(JSON.parse(json)).toEqual(["b", "a"])
  })

  it("should support Record", () => {
    const doc = createTypedDoc(ChatSchema)
    change(doc, (root: any) => {
      root.settings.set("dark_mode", true)
    })

    const json = JSON.stringify(doc.settings)
    expect(JSON.parse(json)).toEqual({ dark_mode: true })
  })

  it("should support Readonly vs Mutable consistency", () => {
    const doc = createTypedDoc(ChatSchema)
    let mutableJson = ""

    change(doc, (root: any) => {
      root.meta.title = "Draft"
      mutableJson = JSON.stringify(root)
    })

    // With the new API, use doc.toJSON() for serialization
    const readonlyJson = JSON.stringify(doc.toJSON())
    expect(readonlyJson).toBe(mutableJson)
  })

  it("should handle placeholders", () => {
    const doc = createTypedDoc(ChatSchema)
    // No changes made

    // Use doc.toJSON() to get plain JSON with placeholders
    const json = JSON.stringify(doc.toJSON())
    const parsed = JSON.parse(json)

    expect(parsed.meta.title).toBe("") // Default string placeholder
    expect(parsed.meta.count).toBe(0) // Default counter placeholder
    expect(parsed.messages).toEqual([])
  })

  it("should support Array methods on Lists", () => {
    const doc = createTypedDoc(ChatSchema)
    change(doc, (root: any) => {
      root.messages.push({ id: "1", content: "A", timestamp: 10 })
      root.messages.push({ id: "2", content: "B", timestamp: 20 })
    })

    const mapped = doc.messages.map(m => ({ id: m.id, txt: m.content }))
    expect(JSON.stringify(mapped)).toBe(
      '[{"id":"1","txt":"A"},{"id":"2","txt":"B"}]',
    )

    const filtered = doc.messages.filter(m => m.timestamp > 15)
    expect(filtered).toHaveLength(1)
    expect(filtered[0].id).toBe("2")
    // filtered returns MutableItems (TypedRefs), so JSON.stringify should work on them
    expect(JSON.stringify(filtered)).toBe(
      '[{"id":"2","content":"B","timestamp":20}]',
    )
  })

  it("should support Object.values", () => {
    const doc = createTypedDoc(ChatSchema)
    change(doc, (root: any) => {
      root.settings.set("a", true)
      root.settings.set("b", false)
    })

    const values = Object.values(doc.settings)
    expect(values).toContain(true)
    expect(values).toContain(false)
    expect(values).toHaveLength(2)
  })

  it("should be efficient (not access unrelated parts)", () => {
    const loroDoc = new LoroDoc()
    const doc = createTypedDoc(ChatSchema, loroDoc)

    change(doc, (root: any) => {
      root.messages.push({ id: "1", content: "A", timestamp: 1 })
      root.meta.title = "Test"
    })

    // Spy on LoroDoc methods
    const getMapSpy = vi.spyOn(loroDoc, "getMap")
    const getListSpy = vi.spyOn(loroDoc, "getList")

    // Access messages and call toJSON
    const messagesJson = doc.messages.toJSON()

    expect(messagesJson).toHaveLength(1)

    // Should have accessed "messages" list
    expect(getListSpy).toHaveBeenCalledWith("messages")

    // Should NOT have accessed "meta" map
    expect(getMapSpy).not.toHaveBeenCalledWith("meta")

    // Should NOT have accessed "settings" map (record)
    expect(getMapSpy).not.toHaveBeenCalledWith("settings")
  })

  it("should allow calling toJSON() directly on refs", () => {
    const doc = createTypedDoc(ChatSchema)
    change(doc, (root: any) => {
      root.meta.title = "Direct"
      root.meta.count.increment(10)
      root.messages.push({ id: "1", content: "A", timestamp: 1 })
      root.settings.set("opt", true)
    })

    // DocRef
    expect(doc.toJSON()).toEqual(
      expect.objectContaining({
        meta: expect.objectContaining({ title: "Direct" }),
      }),
    )

    // MapRef
    expect(doc.meta.toJSON()).toEqual({
      title: "Direct",
      count: 10,
    })

    // ListRef
    expect(doc.messages.toJSON()).toEqual([
      { id: "1", content: "A", timestamp: 1 },
    ])

    // RecordRef
    expect(doc.settings.toJSON()).toEqual({
      opt: true,
    })

    change(doc, (root: any) => {
      // Inside change, these are mutable refs
      expect(root.meta.toJSON()).toEqual({ title: "Direct", count: 10 })
      expect(root.messages.toJSON()).toEqual([
        { id: "1", content: "A", timestamp: 1 },
      ])

      // CounterRef
      expect(root.meta.count.toJSON()).toBe(10)

      // TextRef (inside message)
      // root.messages[0] is a MapRef. content is TextRef.
      expect(root.messages[0].content.toJSON()).toBe("A")
    })
  })

  it("should expose toJSON() in Mutable type signature", () => {
    const doc = createTypedDoc(ChatSchema)

    // This test verifies that TypeScript sees toJSON() on Mutable types
    // If this compiles, the type fix is working correctly
    change(doc, (root: Mutable<typeof ChatSchema>) => {
      root.meta.title = "Type Test"
      root.messages.push({ id: "1", content: "Hello", timestamp: 123 })

      // These should all compile without errors - toJSON() is visible on the type
      const metaJson: { title: string; count: number } = root.meta.toJSON()
      const messagesJson: Array<{
        id: string
        content: string
        timestamp: number
      }> = root.messages.toJSON()
      const countJson: number = root.meta.count.toJSON()

      expect(metaJson).toEqual({ title: "Type Test", count: 0 })
      expect(messagesJson).toEqual([
        { id: "1", content: "Hello", timestamp: 123 },
      ])
      expect(countJson).toBe(0)
    })
  })
})
