import type { StorageKey } from "@loro-extended/repo"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PostgresStorageAdapter, type QueryInterface } from "./server.js"

/**
 * Mock QueryInterface for testing without a real PostgreSQL database
 */
function createMockClient(): QueryInterface & {
  _data: Map<string, Buffer>
  _queries: Array<{ text: string; values?: unknown[] }>
} {
  const data = new Map<string, Buffer>()
  const queries: Array<{ text: string; values?: unknown[] }> = []

  return {
    _data: data,
    _queries: queries,
    async query(
      text: string,
      values?: unknown[],
    ): Promise<{ rows: Record<string, unknown>[] }> {
      queries.push({ text, values })

      // Handle CREATE TABLE / CREATE INDEX
      if (text.includes("CREATE TABLE") || text.includes("CREATE INDEX")) {
        return { rows: [] }
      }

      // Handle SELECT (load)
      if (
        text.includes("SELECT") &&
        text.includes("WHERE") &&
        text.includes("= $1")
      ) {
        const key = values?.[0] as string
        const value = data.get(key)
        if (value) {
          return { rows: [{ key, data: value }] }
        }
        return { rows: [] }
      }

      // Handle SELECT with LIKE (loadRange)
      if (text.includes("SELECT") && text.includes("LIKE")) {
        const pattern = values?.[0] as string
        const prefix = pattern.replace(/::%$/, "")
        const rows: Record<string, unknown>[] = []
        for (const [key, value] of data.entries()) {
          if (key.startsWith(`${prefix}::`) || key === prefix) {
            rows.push({ key, data: value })
          }
        }
        return { rows }
      }

      // Handle SELECT all (loadRange with empty prefix)
      if (text.includes("SELECT") && !text.includes("WHERE")) {
        const rows: Record<string, unknown>[] = []
        for (const [key, value] of data.entries()) {
          rows.push({ key, data: value })
        }
        return { rows }
      }

      // Handle INSERT (save)
      if (text.includes("INSERT")) {
        const key = values?.[0] as string
        const value = values?.[1] as Buffer
        data.set(key, value)
        return { rows: [] }
      }

      // Handle DELETE with = $1 (remove single)
      if (text.includes("DELETE") && text.includes("= $1")) {
        const key = values?.[0] as string
        data.delete(key)
        return { rows: [] }
      }

      // Handle DELETE with LIKE (removeRange)
      if (text.includes("DELETE") && text.includes("LIKE")) {
        const pattern = values?.[0] as string
        const prefix = pattern.replace(/::%$/, "")
        for (const key of data.keys()) {
          if (key.startsWith(`${prefix}::`) || key === prefix) {
            data.delete(key)
          }
        }
        return { rows: [] }
      }

      // Handle DELETE all (removeRange with empty prefix)
      if (text.includes("DELETE") && !text.includes("WHERE")) {
        data.clear()
        return { rows: [] }
      }

      return { rows: [] }
    },
  }
}

describe("PostgresStorageAdapter", () => {
  let adapter: PostgresStorageAdapter
  let mockClient: ReturnType<typeof createMockClient>

  beforeEach(() => {
    mockClient = createMockClient()
    adapter = new PostgresStorageAdapter({ client: mockClient })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe("Basic CRUD Operations", () => {
    it("should save and load a value", async () => {
      const key: StorageKey = ["testDoc"]
      const data = new TextEncoder().encode("hello world")

      await adapter.save(key, data)
      const loadedData = await adapter.load(key)

      expect(loadedData).toEqual(data)
    })

    it("should return undefined for a non-existent key", async () => {
      const loadedData = await adapter.load(["nonExistent"])
      expect(loadedData).toBeUndefined()
    })

    it("should remove a value", async () => {
      const key: StorageKey = ["testDoc"]
      const data = new TextEncoder().encode("hello world")

      await adapter.save(key, data)
      await adapter.remove(key)
      const loadedData = await adapter.load(key)

      expect(loadedData).toBeUndefined()
    })

    it("should overwrite existing value on save", async () => {
      const key: StorageKey = ["testDoc"]
      const data1 = new TextEncoder().encode("first")
      const data2 = new TextEncoder().encode("second")

      await adapter.save(key, data1)
      await adapter.save(key, data2)
      const loadedData = await adapter.load(key)

      expect(loadedData).toEqual(data2)
    })

    it("should handle empty Uint8Array", async () => {
      const key: StorageKey = ["emptyDoc"]
      const data = new Uint8Array(0)

      await adapter.save(key, data)
      const loadedData = await adapter.load(key)

      expect(loadedData).toEqual(data)
    })

    it("should handle large data", { timeout: 30000 }, async () => {
      const key: StorageKey = ["largeDoc"]
      // Create 1MB of data
      const data = new Uint8Array(1024 * 1024)
      for (let i = 0; i < data.length; i++) {
        data[i] = i % 256
      }

      await adapter.save(key, data)
      const loadedData = await adapter.load(key)

      expect(loadedData).toEqual(data)
    })
  })

  describe("Key Serialization", () => {
    it("should handle single-segment keys", async () => {
      const key: StorageKey = ["doc1"]
      const data = new TextEncoder().encode("data")

      await adapter.save(key, data)
      const loadedData = await adapter.load(key)

      expect(loadedData).toEqual(data)
    })

    it("should handle multi-segment keys", async () => {
      const key: StorageKey = ["doc1", "update", "v1"]
      const data = new TextEncoder().encode("data")

      await adapter.save(key, data)
      const loadedData = await adapter.load(key)

      expect(loadedData).toEqual(data)
    })

    it("should distinguish between different multi-segment keys", async () => {
      const key1: StorageKey = ["doc1", "chunk1"]
      const key2: StorageKey = ["doc1", "chunk2"]
      const data1 = new TextEncoder().encode("data1")
      const data2 = new TextEncoder().encode("data2")

      await adapter.save(key1, data1)
      await adapter.save(key2, data2)

      expect(await adapter.load(key1)).toEqual(data1)
      expect(await adapter.load(key2)).toEqual(data2)
    })
  })

  describe("loadRange", () => {
    it("should load all values with matching prefix", async () => {
      const key1: StorageKey = ["docA", "chunk1"]
      const key2: StorageKey = ["docA", "chunk2"]
      const key3: StorageKey = ["docB", "chunk1"]
      const data1 = new TextEncoder().encode("data1")
      const data2 = new TextEncoder().encode("data2")
      const data3 = new TextEncoder().encode("data3")

      await adapter.save(key1, data1)
      await adapter.save(key2, data2)
      await adapter.save(key3, data3)

      const range = await adapter.loadRange(["docA"])

      expect(range.length).toBe(2)
      expect(range).toContainEqual({ key: ["docA", "chunk1"], data: data1 })
      expect(range).toContainEqual({ key: ["docA", "chunk2"], data: data2 })
    })

    it("should return empty array when no keys match prefix", async () => {
      const key: StorageKey = ["docA", "chunk1"]
      const data = new TextEncoder().encode("data")

      await adapter.save(key, data)

      const range = await adapter.loadRange(["docB"])

      expect(range).toEqual([])
    })

    it("should load all values with empty prefix", async () => {
      const key1: StorageKey = ["docA", "chunk1"]
      const key2: StorageKey = ["docB", "chunk1"]
      const data1 = new TextEncoder().encode("data1")
      const data2 = new TextEncoder().encode("data2")

      await adapter.save(key1, data1)
      await adapter.save(key2, data2)

      const range = await adapter.loadRange([])

      expect(range.length).toBe(2)
    })

    it("should handle deeply nested key prefixes", async () => {
      const key1: StorageKey = ["doc", "update", "2024", "01"]
      const key2: StorageKey = ["doc", "update", "2024", "02"]
      const key3: StorageKey = ["doc", "update", "2023", "12"]
      const data1 = new TextEncoder().encode("data1")
      const data2 = new TextEncoder().encode("data2")
      const data3 = new TextEncoder().encode("data3")

      await adapter.save(key1, data1)
      await adapter.save(key2, data2)
      await adapter.save(key3, data3)

      const range = await adapter.loadRange(["doc", "update", "2024"])

      expect(range.length).toBe(2)
      expect(range).toContainEqual({ key: key1, data: data1 })
      expect(range).toContainEqual({ key: key2, data: data2 })
    })
  })

  describe("removeRange", () => {
    it("should remove all values with matching prefix", async () => {
      const key1: StorageKey = ["docA", "chunk1"]
      const key2: StorageKey = ["docA", "chunk2"]
      const key3: StorageKey = ["docB", "chunk1"]
      const data1 = new TextEncoder().encode("data1")
      const data2 = new TextEncoder().encode("data2")
      const data3 = new TextEncoder().encode("data3")

      await adapter.save(key1, data1)
      await adapter.save(key2, data2)
      await adapter.save(key3, data3)

      await adapter.removeRange(["docA"])

      expect(await adapter.load(key1)).toBeUndefined()
      expect(await adapter.load(key2)).toBeUndefined()
      expect(await adapter.load(key3)).toEqual(data3)
    })

    it("should handle removing non-existent prefix", async () => {
      const key: StorageKey = ["docA", "chunk1"]
      const data = new TextEncoder().encode("data")

      await adapter.save(key, data)

      // Should not throw
      await adapter.removeRange(["docB"])

      // Original data should still exist
      expect(await adapter.load(key)).toEqual(data)
    })

    it("should remove all values with empty prefix", async () => {
      const key1: StorageKey = ["docA", "chunk1"]
      const key2: StorageKey = ["docB", "chunk1"]
      const data1 = new TextEncoder().encode("data1")
      const data2 = new TextEncoder().encode("data2")

      await adapter.save(key1, data1)
      await adapter.save(key2, data2)

      await adapter.removeRange([])

      expect(await adapter.load(key1)).toBeUndefined()
      expect(await adapter.load(key2)).toBeUndefined()
    })
  })

  describe("Edge Cases", () => {
    it("should handle removing a non-existent key", async () => {
      // Should not throw
      await adapter.remove(["nonExistent"])
    })

    it("should handle keys with special characters", async () => {
      const key: StorageKey = ["doc:with:colons", "chunk/with/slashes"]
      const data = new TextEncoder().encode("data")

      await adapter.save(key, data)
      const loadedData = await adapter.load(key)

      expect(loadedData).toEqual(data)
    })

    it("should handle concurrent saves to different keys", async () => {
      const promises: Promise<void>[] = []

      for (let i = 0; i < 10; i++) {
        const key: StorageKey = [`doc${i}`, "chunk"]
        const data = new TextEncoder().encode(`data${i}`)
        promises.push(adapter.save(key, data))
      }

      await Promise.all(promises)

      for (let i = 0; i < 10; i++) {
        const key: StorageKey = [`doc${i}`, "chunk"]
        const expected = new TextEncoder().encode(`data${i}`)
        const loaded = await adapter.load(key)
        expect(loaded).toEqual(expected)
      }
    })

    it("should handle concurrent saves to the same key", async () => {
      const key: StorageKey = ["sharedDoc", "chunk"]
      const promises: Promise<void>[] = []

      for (let i = 0; i < 10; i++) {
        const data = new TextEncoder().encode(`data${i}`)
        promises.push(adapter.save(key, data))
      }

      await Promise.all(promises)

      // One of the values should have won
      const loaded = await adapter.load(key)
      expect(loaded).toBeDefined()
    })
  })

  describe("Configuration", () => {
    it("should use custom table name", async () => {
      const customClient = createMockClient()
      const customAdapter = new PostgresStorageAdapter({
        client: customClient,
        tableName: "custom_table",
      })

      await customAdapter.save(["test"], new TextEncoder().encode("data"))

      // Check that queries use the custom table name
      const createTableQuery = customClient._queries.find(q =>
        q.text.includes("CREATE TABLE"),
      )
      expect(createTableQuery?.text).toContain("custom_table")
    })

    it("should use custom column names", async () => {
      const customClient = createMockClient()
      const customAdapter = new PostgresStorageAdapter({
        client: customClient,
        keyColumn: "storage_key",
        dataColumn: "blob",
      })

      await customAdapter.save(["test"], new TextEncoder().encode("data"))

      // Check that queries use the custom column names
      const createTableQuery = customClient._queries.find(q =>
        q.text.includes("CREATE TABLE"),
      )
      expect(createTableQuery?.text).toContain("storage_key")
      expect(createTableQuery?.text).toContain("blob")
    })

    it("should skip table creation when createTable is false", async () => {
      const customClient = createMockClient()
      const customAdapter = new PostgresStorageAdapter({
        client: customClient,
        createTable: false,
      })

      await customAdapter.save(["test"], new TextEncoder().encode("data"))

      // Check that no CREATE TABLE query was executed
      const createTableQuery = customClient._queries.find(q =>
        q.text.includes("CREATE TABLE"),
      )
      expect(createTableQuery).toBeUndefined()
    })
  })

  describe("SQL Query Generation", () => {
    it("should create table with correct schema", async () => {
      await adapter.save(["test"], new TextEncoder().encode("data"))

      const createTableQuery = mockClient._queries.find(q =>
        q.text.includes("CREATE TABLE"),
      )
      expect(createTableQuery?.text).toContain("loro_storage")
      expect(createTableQuery?.text).toContain("key TEXT PRIMARY KEY")
      expect(createTableQuery?.text).toContain("data BYTEA NOT NULL")
    })

    it("should create index for prefix matching", async () => {
      await adapter.save(["test"], new TextEncoder().encode("data"))

      const createIndexQuery = mockClient._queries.find(q =>
        q.text.includes("CREATE INDEX"),
      )
      expect(createIndexQuery?.text).toContain("text_pattern_ops")
    })

    it("should use UPSERT for save operations", async () => {
      await adapter.save(["test"], new TextEncoder().encode("data"))

      const insertQuery = mockClient._queries.find(q =>
        q.text.includes("INSERT"),
      )
      expect(insertQuery?.text).toContain("ON CONFLICT")
      expect(insertQuery?.text).toContain("DO UPDATE")
    })
  })
})
