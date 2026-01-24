import { describe, expect, it } from "vitest"
import { change } from "../functional-helpers.js"
import { createTypedDoc, loro, Shape } from "../index.js"

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

  describe("RecordRef values() and entries() methods", () => {
    it("should return properly typed values for value-shaped records", () => {
      const schema = Shape.doc({
        scores: Shape.record(Shape.plain.number()),
      })

      const doc = createTypedDoc(schema)

      change(doc, draft => {
        draft.scores.alice = 100
        draft.scores.bob = 50
      })

      const values = doc.scores.values()
      expect(values).toEqual([100, 50])

      // Type check: values should be number[]
      const _typeCheck: number[] = values
    })

    it("should return properly typed entries for value-shaped records", () => {
      const schema = Shape.doc({
        scores: Shape.record(Shape.plain.number()),
      })

      const doc = createTypedDoc(schema)

      change(doc, draft => {
        draft.scores.alice = 100
        draft.scores.bob = 50
      })

      const entries = doc.scores.entries()
      expect(entries).toEqual([
        ["alice", 100],
        ["bob", 50],
      ])

      // Type check: entries should be [string, number][]
      const _typeCheck: [string, number][] = entries
    })

    it("should return properly typed refs for container-shaped records", () => {
      const schema = Shape.doc({
        players: Shape.record(
          Shape.struct({
            name: Shape.plain.string(),
            score: Shape.plain.number(),
          }),
        ),
      })

      const doc = createTypedDoc(schema)

      change(doc, draft => {
        draft.players.alice = { name: "Alice", score: 100 }
        draft.players.bob = { name: "Bob", score: 50 }
      })

      const values = doc.players.values()
      expect(values.length).toBe(2)
      // Values should be StructRefs that we can access properties on
      expect(values[0].name).toBe("Alice")
      expect(values[0].score).toBe(100)
      expect(values[1].name).toBe("Bob")
      expect(values[1].score).toBe(50)
    })

    it("should return properly typed entries for container-shaped records", () => {
      const schema = Shape.doc({
        players: Shape.record(
          Shape.struct({
            name: Shape.plain.string(),
            score: Shape.plain.number(),
          }),
        ),
      })

      const doc = createTypedDoc(schema)

      change(doc, draft => {
        draft.players.alice = { name: "Alice", score: 100 }
        draft.players.bob = { name: "Bob", score: 50 }
      })

      const entries = doc.players.entries()
      expect(entries.length).toBe(2)
      expect(entries[0][0]).toBe("alice")
      expect(entries[0][1].name).toBe("Alice")
      expect(entries[1][0]).toBe("bob")
      expect(entries[1][1].name).toBe("Bob")
    })

    it("should return empty arrays for empty records", () => {
      const schema = Shape.doc({
        scores: Shape.record(Shape.plain.number()),
      })

      const doc = createTypedDoc(schema)

      expect(doc.scores.values()).toEqual([])
      expect(doc.scores.entries()).toEqual([])
    })
  })

  describe("RecordRef bulk update methods", () => {
    describe("replace()", () => {
      it("should clear all entries when replacing with empty object", () => {
        const schema = Shape.doc({
          scores: Shape.record(Shape.plain.number()),
        })

        const doc = createTypedDoc(schema)

        change(doc, draft => {
          draft.scores.alice = 100
          draft.scores.bob = 50
        })

        expect(doc.toJSON().scores).toEqual({ alice: 100, bob: 50 })

        change(doc, draft => {
          draft.scores.replace({})
        })

        expect(doc.toJSON().scores).toEqual({})
      })

      it("should add new entries", () => {
        const schema = Shape.doc({
          scores: Shape.record(Shape.plain.number()),
        })

        const doc = createTypedDoc(schema)

        change(doc, draft => {
          draft.scores.replace({
            alice: 100,
            bob: 50,
          })
        })

        expect(doc.toJSON().scores).toEqual({ alice: 100, bob: 50 })
      })

      it("should update existing entries", () => {
        const schema = Shape.doc({
          scores: Shape.record(Shape.plain.number()),
        })

        const doc = createTypedDoc(schema)

        change(doc, draft => {
          draft.scores.alice = 100
          draft.scores.bob = 50
        })

        change(doc, draft => {
          draft.scores.replace({
            alice: 200,
            bob: 75,
          })
        })

        expect(doc.toJSON().scores).toEqual({ alice: 200, bob: 75 })
      })

      it("should remove entries not in the new object", () => {
        const schema = Shape.doc({
          scores: Shape.record(Shape.plain.number()),
        })

        const doc = createTypedDoc(schema)

        change(doc, draft => {
          draft.scores.alice = 100
          draft.scores.bob = 50
          draft.scores.charlie = 25
        })

        change(doc, draft => {
          draft.scores.replace({
            alice: 150,
            // bob and charlie are removed
          })
        })

        expect(doc.toJSON().scores).toEqual({ alice: 150 })
      })

      it("should handle nested struct values", () => {
        const schema = Shape.doc({
          players: Shape.record(
            Shape.struct({
              name: Shape.plain.string(),
              score: Shape.plain.number(),
            }),
          ),
        })

        const doc = createTypedDoc(schema)

        change(doc, draft => {
          draft.players.replace({
            alice: { name: "Alice", score: 100 },
            bob: { name: "Bob", score: 50 },
          })
        })

        expect(doc.toJSON().players).toEqual({
          alice: { name: "Alice", score: 100 },
          bob: { name: "Bob", score: 50 },
        })
      })

      it("should batch all operations into a single commit", () => {
        const schema = Shape.doc({
          scores: Shape.record(Shape.plain.number()),
        })

        const doc = createTypedDoc(schema)

        change(doc, draft => {
          draft.scores.alice = 100
          draft.scores.bob = 50
        })

        // Track subscription calls
        let subscriptionCount = 0
        const unsub = loro(doc.scores).subscribe(() => {
          subscriptionCount++
        })

        change(doc, draft => {
          draft.scores.replace({
            charlie: 75,
            dave: 25,
          })
        })

        // Should only have one subscription notification for the batched operation
        expect(subscriptionCount).toBe(1)
        unsub()
      })
    })

    describe("merge()", () => {
      it("should add new entries", () => {
        const schema = Shape.doc({
          scores: Shape.record(Shape.plain.number()),
        })

        const doc = createTypedDoc(schema)

        change(doc, draft => {
          draft.scores.merge({
            alice: 100,
            bob: 50,
          })
        })

        expect(doc.toJSON().scores).toEqual({ alice: 100, bob: 50 })
      })

      it("should update existing entries", () => {
        const schema = Shape.doc({
          scores: Shape.record(Shape.plain.number()),
        })

        const doc = createTypedDoc(schema)

        change(doc, draft => {
          draft.scores.alice = 100
          draft.scores.bob = 50
        })

        change(doc, draft => {
          draft.scores.merge({
            alice: 200,
          })
        })

        expect(doc.toJSON().scores).toEqual({ alice: 200, bob: 50 })
      })

      it("should NOT remove entries not in the new object", () => {
        const schema = Shape.doc({
          scores: Shape.record(Shape.plain.number()),
        })

        const doc = createTypedDoc(schema)

        change(doc, draft => {
          draft.scores.alice = 100
          draft.scores.bob = 50
        })

        change(doc, draft => {
          draft.scores.merge({
            charlie: 75,
          })
        })

        expect(doc.toJSON().scores).toEqual({
          alice: 100,
          bob: 50,
          charlie: 75,
        })
      })

      it("should handle nested struct values", () => {
        const schema = Shape.doc({
          players: Shape.record(
            Shape.struct({
              name: Shape.plain.string(),
              score: Shape.plain.number(),
            }),
          ),
        })

        const doc = createTypedDoc(schema)

        change(doc, draft => {
          draft.players.alice = { name: "Alice", score: 100 }
        })

        change(doc, draft => {
          draft.players.merge({
            bob: { name: "Bob", score: 50 },
          })
        })

        expect(doc.toJSON().players).toEqual({
          alice: { name: "Alice", score: 100 },
          bob: { name: "Bob", score: 50 },
        })
      })

      it("should batch all operations into a single commit", () => {
        const schema = Shape.doc({
          scores: Shape.record(Shape.plain.number()),
        })

        const doc = createTypedDoc(schema)

        // Track subscription calls
        let subscriptionCount = 0
        const unsub = loro(doc.scores).subscribe(() => {
          subscriptionCount++
        })

        change(doc, draft => {
          draft.scores.merge({
            alice: 100,
            bob: 50,
            charlie: 25,
          })
        })

        // Should only have one subscription notification for the batched operation
        expect(subscriptionCount).toBe(1)
        unsub()
      })
    })

    describe("clear()", () => {
      it("should remove all entries", () => {
        const schema = Shape.doc({
          scores: Shape.record(Shape.plain.number()),
        })

        const doc = createTypedDoc(schema)

        change(doc, draft => {
          draft.scores.alice = 100
          draft.scores.bob = 50
          draft.scores.charlie = 25
        })

        expect(doc.toJSON().scores).toEqual({
          alice: 100,
          bob: 50,
          charlie: 25,
        })

        change(doc, draft => {
          draft.scores.clear()
        })

        expect(doc.toJSON().scores).toEqual({})
      })

      it("should be a no-op on empty record", () => {
        const schema = Shape.doc({
          scores: Shape.record(Shape.plain.number()),
        })

        const doc = createTypedDoc(schema)

        expect(doc.toJSON().scores).toEqual({})

        // Should not throw
        change(doc, draft => {
          draft.scores.clear()
        })

        expect(doc.toJSON().scores).toEqual({})
      })

      it("should batch all operations into a single commit", () => {
        const schema = Shape.doc({
          scores: Shape.record(Shape.plain.number()),
        })

        const doc = createTypedDoc(schema)

        change(doc, draft => {
          draft.scores.alice = 100
          draft.scores.bob = 50
          draft.scores.charlie = 25
        })

        // Track subscription calls
        let subscriptionCount = 0
        const unsub = loro(doc.scores).subscribe(() => {
          subscriptionCount++
        })

        change(doc, draft => {
          draft.scores.clear()
        })

        // Should only have one subscription notification for the batched operation
        expect(subscriptionCount).toBe(1)
        unsub()
      })
    })

    describe("container-valued records", () => {
      it("should work with replace() on record of structs", () => {
        const schema = Shape.doc({
          players: Shape.record(
            Shape.struct({
              name: Shape.plain.string(),
              score: Shape.counter(),
            }),
          ),
        })

        const doc = createTypedDoc(schema)

        change(doc, draft => {
          draft.players.alice = { name: "Alice", score: 100 }
          draft.players.bob = { name: "Bob", score: 50 }
        })

        change(doc, draft => {
          draft.players.replace({
            charlie: { name: "Charlie", score: 75 },
          })
        })

        expect(doc.toJSON().players).toEqual({
          charlie: { name: "Charlie", score: 75 },
        })
      })

      it("should work with merge() on record of structs", () => {
        const schema = Shape.doc({
          players: Shape.record(
            Shape.struct({
              name: Shape.plain.string(),
              score: Shape.counter(),
            }),
          ),
        })

        const doc = createTypedDoc(schema)

        change(doc, draft => {
          draft.players.alice = { name: "Alice", score: 100 }
        })

        change(doc, draft => {
          draft.players.merge({
            bob: { name: "Bob", score: 50 },
          })
        })

        expect(doc.toJSON().players).toEqual({
          alice: { name: "Alice", score: 100 },
          bob: { name: "Bob", score: 50 },
        })
      })

      it("should work with clear() on record of structs", () => {
        const schema = Shape.doc({
          players: Shape.record(
            Shape.struct({
              name: Shape.plain.string(),
              score: Shape.counter(),
            }),
          ),
        })

        const doc = createTypedDoc(schema)

        change(doc, draft => {
          draft.players.alice = { name: "Alice", score: 100 }
          draft.players.bob = { name: "Bob", score: 50 }
        })

        change(doc, draft => {
          draft.players.clear()
        })

        expect(doc.toJSON().players).toEqual({})
      })
    })
  })
})
