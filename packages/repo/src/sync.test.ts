import { createTypedDoc, Shape } from "@loro-extended/change"
import { beforeEach, describe, expect, it } from "vitest"
import { Handle } from "./handle.js"
import { Repo } from "./repo.js"
import { InMemoryStorageAdapter } from "./storage/in-memory-storage-adapter.js"
import { hasSync, sync } from "./sync.js"

// Test schema for typed document tests
const TestSchema = Shape.doc({
  title: Shape.text().placeholder("Untitled"),
  count: Shape.counter(),
})

// Ephemeral store schema
const PresenceSchema = Shape.plain.struct({
  status: Shape.plain.string(),
})

// Different schema for testing schema mismatch
const OtherSchema = Shape.doc({
  name: Shape.text(),
  value: Shape.counter(),
})

// ============================================================================
// Phase 1 Tests: sync() accessor
// ============================================================================

describe("sync() accessor", () => {
  let repo: Repo

  beforeEach(() => {
    repo = new Repo({
      adapters: [new InMemoryStorageAdapter()],
      identity: { name: "test-repo", type: "user" },
    })
  })

  it("retrieves sync ref from doc created by repo.get()", () => {
    const doc = repo.get("test", TestSchema)

    const s = sync(doc)
    expect(s.peerId).toBeDefined()
    expect(s.docId).toBe("test")
    expect(s.readyStates).toBeDefined()
    expect(Array.isArray(s.readyStates)).toBe(true)
  })

  it("throws for doc created without repo", () => {
    const doc = createTypedDoc(TestSchema)

    expect(() => sync(doc)).toThrow(/requires a document from repo.get/)
    expect(hasSync(doc)).toBe(false)
  })

  it("hasSync returns false for docs without sync capabilities", () => {
    const doc = createTypedDoc(TestSchema)
    expect(hasSync(doc)).toBe(false)
  })

  it("hasSync returns true for docs from repo.get()", () => {
    const doc = repo.get("test", TestSchema)
    expect(hasSync(doc)).toBe(true)
  })

  it("provides access to loroDoc", () => {
    const doc = repo.get("test", TestSchema)

    const s = sync(doc)
    expect(s.loroDoc).toBeDefined()
    expect(typeof s.loroDoc.opCount).toBe("function")
  })

  it("provides waitForSync method", async () => {
    const doc = repo.get("test", TestSchema)

    const s = sync(doc)
    expect(typeof s.waitForSync).toBe("function")
    // waitForSync with storage should resolve quickly with InMemoryStorageAdapter
    await s.waitForSync({ kind: "storage" })
  })

  it("provides onReadyStateChange subscription", () => {
    const doc = repo.get("test", TestSchema)

    const s = sync(doc)
    const states: unknown[] = []
    const unsubscribe = s.onReadyStateChange(readyStates => {
      states.push(readyStates)
    })

    expect(typeof unsubscribe).toBe("function")
    unsubscribe()
  })

  it("provides subscribe method for doc changes", () => {
    const doc = repo.get("test", TestSchema)

    const s = sync(doc)
    let callCount = 0
    const unsubscribe = s.subscribe(() => {
      callCount++
    })

    expect(typeof unsubscribe).toBe("function")

    // Make a change
    doc.title.insert(0, "Hello")

    // The subscription should have been called
    expect(callCount).toBeGreaterThan(0)

    unsubscribe()
  })
})

describe("sync() accessor with ephemeral stores", () => {
  let repo: Repo

  beforeEach(() => {
    repo = new Repo({
      adapters: [new InMemoryStorageAdapter()],
      identity: { name: "test-repo", type: "user" },
    })
  })

  it("provides access to ephemeral stores", () => {
    const doc = repo.get("test", TestSchema, { presence: PresenceSchema })

    const s = sync<typeof TestSchema, { presence: typeof PresenceSchema }>(doc)
    expect(s.presence).toBeDefined()
    s.presence.setSelf({ status: "online" })
    expect(s.presence.self).toEqual({ status: "online" })
  })

  it("ephemeral store has all expected methods", () => {
    const doc = repo.get("test", TestSchema, { presence: PresenceSchema })

    const s = sync<typeof TestSchema, { presence: typeof PresenceSchema }>(doc)
    const presence = s.presence

    expect(typeof presence.set).toBe("function")
    expect(typeof presence.get).toBe("function")
    expect(typeof presence.getAll).toBe("function")
    expect(typeof presence.delete).toBe("function")
    expect(typeof presence.setSelf).toBe("function")
    expect(typeof presence.subscribe).toBe("function")
    expect(presence.raw).toBeDefined()
  })

  it("accessing undeclared ephemeral store returns undefined", () => {
    const doc = repo.get("test", TestSchema)

    const s = sync(doc) as { cursors?: unknown }
    // Accessing undeclared ephemeral returns undefined (no throw)
    expect(s.cursors).toBeUndefined()
  })
})

// ============================================================================
// Phase 2 Tests: Repo.get() caching
// ============================================================================

describe("Repo.get() caching", () => {
  let repo: Repo

  beforeEach(() => {
    repo = new Repo({
      adapters: [new InMemoryStorageAdapter()],
      identity: { name: "test-repo", type: "user" },
    })
  })

  it("returns same Doc instance for same docId", () => {
    const doc1 = repo.get("test", TestSchema)
    const doc2 = repo.get("test", TestSchema)

    expect(doc1).toBe(doc2) // Same instance
  })

  it("throws on schema mismatch for same docId", () => {
    repo.get("test", TestSchema)

    expect(() => repo.get("test", OtherSchema)).toThrow(
      /Document 'test' already exists with a different schema/,
    )
  })

  it("throws on ephemeral shape mismatch for same docId", () => {
    repo.get("test", TestSchema)

    expect(() =>
      repo.get("test", TestSchema, { presence: PresenceSchema }),
    ).toThrow(/Document 'test' already exists with different ephemeral stores/)
  })

  it("allows same docId with same schema and ephemeral shapes", () => {
    const doc1 = repo.get("test", TestSchema, {
      presence: PresenceSchema,
    })
    const doc2 = repo.get("test", TestSchema, {
      presence: PresenceSchema,
    })

    expect(doc1).toBe(doc2) // Same instance
  })

  it("clears cache on delete", async () => {
    const doc1 = repo.get("test", TestSchema)
    await repo.delete("test")
    const doc2 = repo.get("test", TestSchema)

    expect(doc1).not.toBe(doc2) // Different instance after delete
  })

  it("clears cache on reset", () => {
    const doc1 = repo.get("test", TestSchema)
    repo.reset()
    const doc2 = repo.get("test", TestSchema)

    expect(doc1).not.toBe(doc2) // Different instance after reset
  })

  it("allows different docIds with different schemas", () => {
    const doc1 = repo.get("doc1", TestSchema)
    const doc2 = repo.get("doc2", OtherSchema)

    expect(doc1).not.toBe(doc2)
    expect(sync(doc1).docId).toBe("doc1")
    expect(sync(doc2).docId).toBe("doc2")
  })

  it("cached doc reflects mutations", () => {
    const doc1 = repo.get("test", TestSchema)
    doc1.title.insert(0, "Hello")

    const doc2 = repo.get("test", TestSchema)
    expect(doc2.toJSON().title).toBe("Hello")
  })
})

// ============================================================================
// Phase 3 Tests: Doc-first API
// ============================================================================

describe("Doc-first API", () => {
  let repo: Repo

  beforeEach(() => {
    repo = new Repo({
      adapters: [new InMemoryStorageAdapter()],
      identity: { name: "test-repo", type: "user" },
    })
  })

  it("repo.get() returns a Doc that can be mutated directly", () => {
    const doc = repo.get("test", TestSchema)

    // Can mutate directly without going through handle.doc
    doc.title.insert(0, "Hello")
    expect(doc.toJSON().title).toBe("Hello")
  })

  it("Doc has toJSON() method", () => {
    const doc = repo.get("test", TestSchema)

    const json = doc.toJSON()
    expect(json).toHaveProperty("title")
    expect(json).toHaveProperty("count")
  })

  it("Doc supports counter operations", () => {
    const doc = repo.get("test", TestSchema)

    doc.count.increment(5)
    expect(doc.toJSON().count).toBe(5)

    doc.count.decrement(2)
    expect(doc.toJSON().count).toBe(3)
  })

  it("sync(doc) provides access to peerId", () => {
    const doc = repo.get("test", TestSchema)

    expect(sync(doc).peerId).toBe(repo.identity.peerId)
  })
})

// ============================================================================
// Legacy Handle API Tests (backward compatibility)
// ============================================================================

describe("Legacy Handle API (getHandle)", () => {
  let repo: Repo

  beforeEach(() => {
    repo = new Repo({
      adapters: [new InMemoryStorageAdapter()],
      identity: { name: "test-repo", type: "user" },
    })
  })

  it("getHandle returns a Handle instance", () => {
    const handle = repo.getHandle("test", TestSchema)
    expect(handle).toBeInstanceOf(Handle)
    expect(handle.doc).toBeDefined()
    expect(handle.docId).toBe("test")
  })

  it("getHandle caches handles", () => {
    const handle1 = repo.getHandle("test", TestSchema)
    const handle2 = repo.getHandle("test", TestSchema)

    expect(handle1).toBe(handle2)
  })

  it("getHandle throws on schema mismatch", () => {
    repo.getHandle("test", TestSchema)

    expect(() => repo.getHandle("test", OtherSchema)).toThrow(
      /Document 'test' already exists with a different schema/,
    )
  })

  it("handle.doc can be mutated", () => {
    const handle = repo.getHandle("test", TestSchema)

    handle.doc.title.insert(0, "Hello")
    expect(handle.doc.toJSON().title).toBe("Hello")
  })

  it("handle provides ephemeral stores directly", () => {
    const handle = repo.getHandle("test", TestSchema, {
      presence: PresenceSchema,
    })

    expect(handle.presence).toBeDefined()
    handle.presence.setSelf({ status: "online" })
    expect(handle.presence.self).toEqual({ status: "online" })
  })
})
