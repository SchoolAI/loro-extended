import { LoroDoc } from "loro-crdt"
import { describe, expect, it } from "vitest"

/**
 * Test to understand VersionVector.compare() behavior
 *
 * According to loro-abbrev.md:
 * - compare() returns a number or undefined
 * - If they are concurrent, return undefined
 *
 * We need to verify:
 * 1. What does compare() return for empty vs non-empty versions?
 * 2. What does compare() return for concurrent versions?
 * 3. Should we send snapshot or update for concurrent versions?
 */
describe("VersionVector.compare() behavior", () => {
  it("should return 1 when our version is ahead", () => {
    const doc1 = new LoroDoc()
    doc1.setPeerId("1")
    const doc2 = new LoroDoc()
    doc2.setPeerId("2")

    // doc1 has changes, doc2 is empty
    doc1.getText("text").insert(0, "hello")

    const ourVersion = doc1.version()
    const theirVersion = doc2.version()

    const comparison = ourVersion.compare(theirVersion)
    expect(comparison).toBe(1)
  })

  it("should return 0 when versions are equal", () => {
    const doc1 = new LoroDoc()
    doc1.setPeerId("1")
    doc1.getText("text").insert(0, "hello")

    const version1 = doc1.version()
    const version2 = doc1.version()

    const comparison = version1.compare(version2)
    expect(comparison).toBe(0)
  })

  it("should return -1 when our version is behind", () => {
    const doc1 = new LoroDoc()
    doc1.setPeerId("1")
    const doc2 = new LoroDoc()
    doc2.setPeerId("2")

    // doc2 has changes, doc1 is empty
    doc2.getText("text").insert(0, "hello")

    const ourVersion = doc1.version()
    const theirVersion = doc2.version()

    const comparison = ourVersion.compare(theirVersion)
    expect(comparison).toBe(-1)
  })

  it("should return undefined for concurrent versions", () => {
    const doc1 = new LoroDoc()
    doc1.setPeerId("1")
    const doc2 = new LoroDoc()
    doc2.setPeerId("2")

    // Both docs make independent changes
    doc1.getText("text").insert(0, "hello from doc1")
    doc2.getText("text").insert(0, "hello from doc2")

    const version1 = doc1.version()
    const version2 = doc2.version()

    const comparison = version1.compare(version2)
    expect(comparison).toBeUndefined()
  })

  it("should handle empty version vector", () => {
    const doc1 = new LoroDoc()
    doc1.setPeerId("1")
    doc1.getText("text").insert(0, "hello")

    const ourVersion = doc1.version()
    const emptyVersion = new LoroDoc().version()

    const comparison = ourVersion.compare(emptyVersion)
    expect(comparison).toBe(1)
    expect(emptyVersion.length()).toBe(0)
  })

  it("should test what to send for concurrent versions", () => {
    // This test explores what we should send when versions are concurrent
    const doc1 = new LoroDoc()
    doc1.setPeerId("1")
    const doc2 = new LoroDoc()
    doc2.setPeerId("2")

    // Both docs make independent changes
    doc1.getText("text").insert(0, "A")
    doc2.getText("text").insert(0, "B")

    const version1 = doc1.version()
    const version2 = doc2.version()

    const comparison = version1.compare(version2)
    expect(comparison).toBeUndefined()

    // Try exporting update from concurrent version
    const updateData = doc1.export({ mode: "update", from: version2 })

    // Try exporting snapshot
    const snapshotData = doc1.export({ mode: "snapshot" })

    // Import the update into doc2 and see what happens
    doc2.import(updateData)

    // Both should have both changes due to CRDT merge
    expect(doc2.getText("text").toString()).toContain("A")
    expect(doc2.getText("text").toString()).toContain("B")
  })

  it("should verify update mode works for concurrent versions", () => {
    // The key question: can we use update mode when versions are concurrent?
    const doc1 = new LoroDoc()
    doc1.setPeerId("1")
    const doc2 = new LoroDoc()
    doc2.setPeerId("2")

    // Make concurrent changes
    doc1.getText("text").insert(0, "from-1")
    doc2.getText("text").insert(0, "from-2")

    const version1 = doc1.version()
    const version2 = doc2.version()

    // Versions are concurrent
    expect(version1.compare(version2)).toBeUndefined()

    // Export update from doc1's perspective of doc2's version
    const update = doc1.export({ mode: "update", from: version2 })

    // This should work - update mode should handle concurrent versions
    doc2.import(update)

    // After import, doc2 should have both changes
    const text = doc2.getText("text").toString()
    expect(text).toContain("from-1")
    expect(text).toContain("from-2")
  })
})
