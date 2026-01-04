import { describe, expect, it } from "vitest"
import { change } from "../functional-helpers.js"
import { createTypedDoc, Shape } from "../index.js"

describe("Record Types", () => {
  describe("Shape.record (Container)", () => {
    it("should handle record of counters", () => {
      const schema = Shape.doc({
        scores: Shape.record(Shape.counter()),
      })

      const doc = createTypedDoc(schema)

      change(doc, draft => {
        // Use get() to access container refs - it creates if not exists
        draft.scores.get("alice")?.increment(10)
        draft.scores.get("bob")?.increment(5)
      })

      expect(doc.toJSON().scores).toEqual({
        alice: 10,
        bob: 5,
      })

      change(doc, draft => {
        draft.scores.get("alice")?.increment(5)
        draft.scores.delete("bob")
      })

      expect(doc.toJSON().scores).toEqual({
        alice: 15,
      })
    })

    it("should handle record of text", () => {
      const schema = Shape.doc({
        notes: Shape.record(Shape.text()),
      })

      const doc = createTypedDoc(schema)

      change(doc, draft => {
        draft.notes.get("todo")?.insert(0, "Buy milk")
        draft.notes.get("reminders")?.insert(0, "Call mom")
      })

      expect(doc.toJSON().notes).toEqual({
        todo: "Buy milk",
        reminders: "Call mom",
      })
    })

    it("should handle record of lists", () => {
      const schema = Shape.doc({
        groups: Shape.record(Shape.list(Shape.plain.string())),
      })

      const doc = createTypedDoc(schema)

      change(doc, draft => {
        const groupA = draft.groups.get("groupA")
        groupA?.push("alice")
        groupA?.push("bob")

        const groupB = draft.groups.get("groupB")
        groupB?.push("charlie")
      })

      expect(doc.toJSON().groups).toEqual({
        groupA: ["alice", "bob"],
        groupB: ["charlie"],
      })
    })
  })

  describe("Shape.plain.record (Value)", () => {
    it("should handle record of plain strings", () => {
      const schema = Shape.doc({
        wrapper: Shape.struct({
          config: Shape.plain.record(Shape.plain.string()),
        }),
      })

      const doc = createTypedDoc(schema)

      change(doc, draft => {
        draft.wrapper.config.theme = "dark"
        draft.wrapper.config.lang = "en"
      })

      expect(doc.toJSON().wrapper.config).toEqual({
        theme: "dark",
        lang: "en",
      })

      change(doc, draft => {
        delete draft.wrapper.config.theme
        draft.wrapper.config.lang = "fr"
      })

      expect(doc.toJSON().wrapper.config).toEqual({
        lang: "fr",
      })
    })

    it("should handle record of plain numbers", () => {
      const schema = Shape.doc({
        wrapper: Shape.struct({
          stats: Shape.plain.record(Shape.plain.number()),
        }),
      })

      const doc = createTypedDoc(schema)

      change(doc, draft => {
        draft.wrapper.stats.visits = 100
        draft.wrapper.stats.clicks = 50
      })

      expect(doc.toJSON().wrapper.stats).toEqual({
        visits: 100,
        clicks: 50,
      })
    })

    it("should handle nested records", () => {
      const schema = Shape.doc({
        wrapper: Shape.struct({
          settings: Shape.plain.record(
            Shape.plain.record(Shape.plain.boolean()),
          ),
        }),
      })

      const doc = createTypedDoc(schema)

      change(doc, draft => {
        draft.wrapper.settings.ui = {
          darkMode: true,
          sidebar: false,
        }
        draft.wrapper.settings.notifications = {
          email: true,
          push: true,
        }
      })

      expect(doc.toJSON().wrapper.settings).toEqual({
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
          Shape.struct({
            name: Shape.plain.string(),
            age: Shape.plain.number(),
          }),
        ),
      })

      const doc = createTypedDoc(schema)

      change(doc, draft => {
        const alice = draft.users.get("u1")
        if (alice) {
          alice.name = "Alice"
          alice.age = 30
        }

        const bob = draft.users.get("u2")
        if (bob) {
          bob.name = "Bob"
          bob.age = 25
        }
      })

      expect(doc.toJSON().users).toEqual({
        u1: { name: "Alice", age: 30 },
        u2: { name: "Bob", age: 25 },
      })
    })

    it("should allow setting a plain object for a record with map values", () => {
      const schema = Shape.doc({
        participants: Shape.record(
          Shape.struct({
            id: Shape.plain.string(),
            role: Shape.plain.string(),
            name: Shape.plain.string(),
            color: Shape.plain.string(),
          }),
        ),
      })

      const doc = createTypedDoc(schema)

      change(doc, draft => {
        draft.participants["student-1"] = {
          id: "student-1",
          role: "student",
          name: "Alice",
          color: "indigo",
        }
      })

      expect(doc.toJSON().participants["student-1"]).toEqual({
        id: "student-1",
        role: "student",
        name: "Alice",
        color: "indigo",
      })
    })

    it("should allow setting a plain object for a record with nested map values", () => {
      const schema = Shape.doc({
        data: Shape.record(
          Shape.struct({
            info: Shape.struct({
              name: Shape.plain.string(),
            }),
          }),
        ),
      })

      const doc = createTypedDoc(schema)

      change(doc, draft => {
        draft.data["item-1"] = {
          info: {
            name: "Item 1",
          },
        }
      })

      expect(doc.toJSON().data["item-1"]).toEqual({
        info: {
          name: "Item 1",
        },
      })
    })

    it("should allow setting a plain array for a record with list values", () => {
      const schema = Shape.doc({
        histories: Shape.record(Shape.list(Shape.plain.string())),
      })

      const doc = createTypedDoc(schema)

      change(doc, draft => {
        draft.histories.user1 = ["a", "b"]
      })

      expect(doc.toJSON().histories.user1).toEqual(["a", "b"])

      change(doc, draft => {
        // biome-ignore lint/complexity/useLiteralKeys: tests indexed assignment
        draft.histories["user1"] = ["c"]
      })

      // biome-ignore lint/complexity/useLiteralKeys: tests indexed assignment
      expect(doc.toJSON().histories["user1"]).toEqual(["c"])
    })

    it("should allow setting a plain string for a record of text", () => {
      const schema = Shape.doc({
        notes: Shape.record(Shape.text()),
      })

      const doc = createTypedDoc(schema)

      change(doc, draft => {
        draft.notes.set("note-1", "Hello World")
        draft.notes["note-2"] = "Another note"
      })

      expect(doc.toJSON().notes).toEqual({
        "note-1": "Hello World",
        "note-2": "Another note",
      })
    })

    it("should allow setting a plain number for a record of counter", () => {
      const schema = Shape.doc({
        scores: Shape.record(Shape.counter()),
      })

      const doc = createTypedDoc(schema)

      change(doc, draft => {
        draft.scores.set("alice", 100)
        draft.scores.bob = 50
      })

      expect(doc.toJSON().scores).toEqual({
        alice: 100,
        bob: 50,
      })
    })

    it("should allow setting a plain object with text fields for a record of maps", () => {
      const schema = Shape.doc({
        users: Shape.record(
          Shape.struct({
            userId: Shape.plain.string(),
            displayName: Shape.text(),
            email: Shape.plain.string(),
          }),
        ),
      })

      const doc = createTypedDoc(schema)

      change(doc, draft => {
        draft.users.set("user-123", {
          userId: "user-123",
          displayName: "Test User",
          email: "test@example.com",
        })
      })

      expect(doc.toJSON().users["user-123"]).toEqual({
        userId: "user-123",
        displayName: "Test User",
        email: "test@example.com",
      })
    })
  })

  describe("Readonly access to non-existent keys", () => {
    it("should not throw 'placeholder required' when accessing nested map values in a record", () => {
      // This schema mirrors a real-world scenario:
      // preferences: Record<string, { showTip: boolean }>
      const schema = Shape.doc({
        preferences: Shape.record(
          Shape.struct({
            showTip: Shape.plain.boolean(),
          }),
        ),
      })

      const doc = createTypedDoc(schema)

      // First, set a value for a specific peer
      change(doc, d => {
        d.preferences.peer1 = { showTip: true }
      })

      // This should work - accessing an existing key
      expect(doc.preferences.peer1?.showTip).toBe(true)

      // Accessing a non-existent key should NOT throw "placeholder required"
      // It should return undefined so optional chaining works correctly
      expect(() => {
        const result = doc.preferences.nonexistent?.showTip
        return result
      }).not.toThrow()
    })

    it("should return undefined for non-existent record keys in readonly mode", () => {
      const schema = Shape.doc({
        preferences: Shape.record(
          Shape.struct({
            showTip: Shape.plain.boolean(),
          }),
        ),
      })

      const doc = createTypedDoc(schema)

      // Access a key that doesn't exist - should return undefined
      const prefs = doc.preferences.nonexistent
      expect(prefs).toBeUndefined()
    })

    it("should work with the exact user scenario pattern", () => {
      // Exact reproduction of a user's schema and access pattern
      const schema = Shape.doc({
        preferences: Shape.record(
          Shape.struct({
            showTip: Shape.plain.boolean(),
          }),
        ),
      })

      const doc = createTypedDoc(schema)
      const myPeerId = "some-peer-id"

      // This is the exact code pattern from the user's app:
      // doc.preferences[myPeerId]?.showTip !== false
      expect(() => {
        const showTip = doc.preferences[myPeerId]?.showTip
        const result = showTip !== false
        return result
      }).not.toThrow()
    })
  })
})
