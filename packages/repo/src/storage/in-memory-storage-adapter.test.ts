import { beforeEach, describe, expect, it } from "vitest"

import { InMemoryStorageAdapter } from "./in-memory-storage-adapter.js"
import type { StorageKey } from "./storage-adapter.js"

describe("InMemoryStorageAdapter", () => {
  let adapter: InMemoryStorageAdapter

  beforeEach(() => {
    adapter = new InMemoryStorageAdapter()
  })

  // Test for save and load
  it("should save and load a value", async () => {
    const key: StorageKey = ["testDoc"]
    const data = new TextEncoder().encode("hello world")
    await adapter.save(key, data)
    const loadedData = await adapter.load(key)
    expect(loadedData).toEqual(data)
  })

  // Test for remove
  it("should remove a value", async () => {
    const key: StorageKey = ["testDoc"]
    const data = new TextEncoder().encode("hello world")
    await adapter.save(key, data)
    await adapter.remove(key)
    const loadedData = await adapter.load(key)
    expect(loadedData).toBeUndefined()
  })

  // Test for loadRange
  it("should load a range of values", async () => {
    const key1: StorageKey = ["docA", "chunk1"]
    const data1 = new TextEncoder().encode("data1")
    const key2: StorageKey = ["docA", "chunk2"]
    const data2 = new TextEncoder().encode("data2")
    const key3: StorageKey = ["docB", "chunk1"]
    const data3 = new TextEncoder().encode("data3")

    await adapter.save(key1, data1)
    await adapter.save(key2, data2)
    await adapter.save(key3, data3)

    const range = await adapter.loadRange(["docA"])
    expect(range.length).toBe(2)

    // The order is not guaranteed, so we check for presence
    expect(range).toContainEqual({ key: key1, data: data1 })
    expect(range).toContainEqual({ key: key2, data: data2 })
  })

  // Test for removeRange
  it("should remove a range of values", async () => {
    const key1: StorageKey = ["docA", "chunk1"]
    const data1 = new TextEncoder().encode("data1")
    const key2: StorageKey = ["docA", "chunk2"]
    const data2 = new TextEncoder().encode("data2")
    const key3: StorageKey = ["docB", "chunk1"]
    const data3 = new TextEncoder().encode("data3")

    await adapter.save(key1, data1)
    await adapter.save(key2, data2)
    await adapter.save(key3, data3)

    await adapter.removeRange(["docA"])

    const loaded1 = await adapter.load(key1)
    const loaded2 = await adapter.load(key2)
    const loaded3 = await adapter.load(key3)

    expect(loaded1).toBeUndefined()
    expect(loaded2).toBeUndefined()
    expect(loaded3).toEqual(data3) // docB should still be there
  })

  it("should return undefined for a non-existent key", async () => {
    const loadedData = await adapter.load(["nonExistent"])
    expect(loadedData).toBeUndefined()
  })
})
