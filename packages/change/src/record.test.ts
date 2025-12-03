import { describe, expect, it } from "vitest"
import { Shape, TypedDoc } from "./index.js"

describe("Record Types", () => {
  describe("Shape.record (Container)", () => {
    it("should handle record of counters", () => {
      const schema = Shape.doc({
        scores: Shape.record(Shape.counter()),
      })

      const doc = new TypedDoc(schema, { scores: {} })

      doc.change(draft => {
        draft.scores.getOrCreateNode("alice").increment(10)
        draft.scores.getOrCreateNode("bob").increment(5)
      })

      expect(doc.value.scores).toEqual({
        alice: 10,
        bob: 5,
      })

      doc.change(draft => {
        draft.scores.getOrCreateNode("alice").increment(5)
        draft.scores.delete("bob")
      })

      expect(doc.value.scores).toEqual({
        alice: 15,
      })
    })

    it("should handle record of text", () => {
      const schema = Shape.doc({
        notes: Shape.record(Shape.text()),
      })

      const doc = new TypedDoc(schema, { notes: {} })

      doc.change(draft => {
        draft.notes.getOrCreateNode("todo").insert(0, "Buy milk")
        draft.notes.getOrCreateNode("reminders").insert(0, "Call mom")
      })

      expect(doc.value.notes).toEqual({
        todo: "Buy milk",
        reminders: "Call mom",
      })
    })

    it("should handle record of lists", () => {
      const schema = Shape.doc({
        groups: Shape.record(Shape.list(Shape.plain.string())),
      })

      const doc = new TypedDoc(schema, { groups: {} })

      doc.change(draft => {
        const groupA = draft.groups.getOrCreateNode("groupA")
        groupA.push("alice")
        groupA.push("bob")

        const groupB = draft.groups.getOrCreateNode("groupB")
        groupB.push("charlie")
      })

      expect(doc.value.groups).toEqual({
        groupA: ["alice", "bob"],
        groupB: ["charlie"],
      })
    })
  })

  describe("Shape.plain.record (Value)", () => {
    it("should handle record of plain strings", () => {
      const schema = Shape.doc({
        wrapper: Shape.map({
          config: Shape.plain.record(Shape.plain.string()),
        }),
      })

      const doc = new TypedDoc(schema, { wrapper: { config: {} } })

      doc.change(draft => {
        draft.wrapper.config.theme = "dark"
        draft.wrapper.config.lang = "en"
      })

      expect(doc.value.wrapper.config).toEqual({
        theme: "dark",
        lang: "en",
      })

      doc.change(draft => {
        delete draft.wrapper.config.theme
        draft.wrapper.config.lang = "fr"
      })

      expect(doc.value.wrapper.config).toEqual({
        lang: "fr",
      })
    })

    it("should handle record of plain numbers", () => {
      const schema = Shape.doc({
        wrapper: Shape.map({
          stats: Shape.plain.record(Shape.plain.number()),
        }),
      })

      // Empty state must use empty record - add initial data via change()
      const doc = new TypedDoc(schema, { wrapper: { stats: {} } })

      doc.change(draft => {
        draft.wrapper.stats.visits = 100
        draft.wrapper.stats.clicks = 50
      })

      expect(doc.value.wrapper.stats).toEqual({
        visits: 100,
        clicks: 50,
      })
    })

    it("should handle nested records", () => {
      const schema = Shape.doc({
        wrapper: Shape.map({
          settings: Shape.plain.record(
            Shape.plain.record(Shape.plain.boolean()),
          ),
        }),
      })

      const doc = new TypedDoc(schema, { wrapper: { settings: {} } })

      doc.change(draft => {
        draft.wrapper.settings.ui = {
          darkMode: true,
          sidebar: false,
        }
        draft.wrapper.settings.notifications = {
          email: true,
          push: true,
        }
      })

      expect(doc.value.wrapper.settings).toEqual({
        ui: {
          darkMode: true,
          sidebar: false,
        },
        notifications: {
          email: true,
          push: true,
        },
      })
    })
  })

  describe("Mixed Usage", () => {
    it("should handle record of maps", () => {
      const schema = Shape.doc({
        users: Shape.record(
          Shape.map({
            name: Shape.plain.string(),
            age: Shape.plain.number(),
          }),
        ),
      })

      const doc = new TypedDoc(schema, { users: {} })

      doc.change(draft => {
        const alice = draft.users.getOrCreateNode("u1")
        alice.name = "Alice"
        alice.age = 30

        const bob = draft.users.getOrCreateNode("u2")
        bob.name = "Bob"
        bob.age = 25
      })

      expect(doc.value.users).toEqual({
        u1: { name: "Alice", age: 30 },
        u2: { name: "Bob", age: 25 },
      })
    })
  })
})
