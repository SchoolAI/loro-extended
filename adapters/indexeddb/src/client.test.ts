import "fake-indexeddb/auto"
import type { StorageKey } from "@loro-extended/repo"
import { IDBFactory } from "fake-indexeddb"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { IndexedDBStorageAdapter } from "./client.js"

describe("IndexedDBStorageAdapter", () => {
  let adapter: IndexedDBStorageAdapter

  beforeEach(() => {
    // Reset IndexedDB to a fresh state before each test
    // This replaces the global indexedDB with a new instance
    globalThis.indexedDB = new IDBFactory()
    adapter = new IndexedDBStorageAdapter()
  })

  afterEach(() => {
    // Reset again after each test for clean state
    globalThis.indexedDB = new IDBFactory()
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

    it("should handle large data", async () => {
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
      const key1: StorageKey = ["docA"]
      const key2: StorageKey = ["docB"]
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
      const key1: StorageKey = ["docA"]
      const key2: StorageKey = ["docB"]
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
        const key: StorageKey = [`doc${i}`]
        const data = new TextEncoder().encode(`data${i}`)
        promises.push(adapter.save(key, data))
      }

      await Promise.all(promises)

      for (let i = 0; i < 10; i++) {
        const key: StorageKey = [`doc${i}`]
        const expected = new TextEncoder().encode(`data${i}`)
        const loaded = await adapter.load(key)
        expect(loaded).toEqual(expected)
      }
    })

    it("should handle concurrent saves to the same key", async () => {
      const key: StorageKey = ["sharedDoc"]
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
})
