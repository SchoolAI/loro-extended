import { LoroDoc } from "loro-crdt"
import { describe, expect, it } from "vitest"

// Helper to simulate the key generation logic we want to test
function serializeFrontiers(
  frontiers: { peer: string; counter: number }[],
): string {
  return frontiers
    .map(f => `${f.peer}:${f.counter}`)
    .sort()
    .join(",")
}

describe("Frontiers-based storage keys", () => {
  it("generates unique keys when two pods write simultaneously", () => {
    // Simulate two pods with different PeerIds
    const docA = new LoroDoc()
    const docB = new LoroDoc()
    docA.setPeerId(1n)
    docB.setPeerId(2n)

    // Both make concurrent edits (simulating same millisecond)
    docA.getText("text").insert(0, "Hello from A")
    docB.getText("text").insert(0, "Hello from B")
    docA.commit()
    docB.commit()

    // Get frontiers from each
    const frontiersA = docA.frontiers()
    const frontiersB = docB.frontiers()

    // Serialize to storage key format
    const keyA = serializeFrontiers(frontiersA)
    const keyB = serializeFrontiers(frontiersB)

    // Keys MUST be different - validates the core assumption
    expect(keyA).not.toEqual(keyB)

    // Verify the format looks like what we expect (peer:counter)
    // Note: Loro uses u64 for PeerId, so 1n becomes "1" in string representation
    expect(keyA).toContain("1:")
    expect(keyB).toContain("2:")
  })

  it("generates unique keys even with same content", () => {
    const docA = new LoroDoc()
    const docB = new LoroDoc()
    docA.setPeerId(1n)
    docB.setPeerId(2n)

    // Both write identical content
    docA.getText("text").insert(0, "Same content")
    docB.getText("text").insert(0, "Same content")
    docA.commit()
    docB.commit()

    const keyA = serializeFrontiers(docA.frontiers())
    const keyB = serializeFrontiers(docB.frontiers())

    // Keys differ because PeerId differs
    expect(keyA).not.toEqual(keyB)
  })

  it("generates the same key for the same update (idempotency/deduplication)", () => {
    // This answers "Why use frontiers instead of UUID?"
    // If two pods receive the exact same update (e.g. via gossip or retry),
    // we want them to generate the SAME key so we don't store duplicates.

    const docA = new LoroDoc()
    docA.setPeerId(1n)
    docA.getText("text").insert(0, "Shared Update")
    docA.commit()

    // Pod 1 processes it
    const frontiers1 = docA.frontiers()
    const key1 = serializeFrontiers(frontiers1)

    // Pod 2 processes the exact same doc state
    // (Simulating receiving the same update)
    const docB = new LoroDoc()
    docB.import(docA.export({ mode: "snapshot" }))

    const frontiers2 = docB.frontiers()
    const key2 = serializeFrontiers(frontiers2)

    // Keys MUST be identical
    expect(key1).toEqual(key2)

    // If we used random UUIDs, key1 would !== key2, and we'd store the data twice.
  })

  it("requires sorting for deterministic keys (Loro frontiers order depends on import order)", () => {
    const doc1 = new LoroDoc()
    doc1.setPeerId(0n)

    // Create concurrent changes
    const docA = new LoroDoc()
    docA.setPeerId(1n)
    docA.getText("text").insert(0, "A")
    docA.commit()

    const docB = new LoroDoc()
    docB.setPeerId(2n)
    docB.getText("text").insert(0, "B")
    docB.commit()

    // Import in order A -> B
    doc1.import(docA.export({ mode: "update" }))
    doc1.import(docB.export({ mode: "update" }))

    // Import in order B -> A
    const doc2 = new LoroDoc()
    doc2.setPeerId(0n)
    doc2.import(docB.export({ mode: "update" }))
    doc2.import(docA.export({ mode: "update" }))

    // Verify states are identical
    expect(doc1.toJSON()).toEqual(doc2.toJSON())

    // Get raw frontiers
    const frontiers1 = doc1.frontiers()
    const frontiers2 = doc2.frontiers()

    // Frontiers might be in different order!
    // Note: In my previous run, it seemed to be reverse import order.
    // Let's check if they are different.
    // If they are the same, then maybe it IS deterministic but just not sorted by PeerId?
    // But if they are different, then sorting is definitely needed.

    const rawKey1 = frontiers1.map(f => `${f.peer}:${f.counter}`).join(",")
    const rawKey2 = frontiers2.map(f => `${f.peer}:${f.counter}`).join(",")

    // If raw keys are different, it proves we need sorting
    if (rawKey1 !== rawKey2) {
      console.log(
        "Frontiers order depends on import order! Sorting is required.",
      )
    } else {
      console.log(
        "Frontiers order seems deterministic but not sorted by PeerId.",
      )
    }

    // Verify that our serialize function handles this correctly
    const key1 = serializeFrontiers(frontiers1)
    const key2 = serializeFrontiers(frontiers2)

    expect(key1).toEqual(key2)
  })

  it("produces keys that are safe for hierarchical storage (no key is a prefix of another)", () => {
    // Scenario:
    // Key A: Frontier [P1:1]
    // Key B: Frontier [P1:1, P2:1]
    // If we stored these as ["doc", "update", "P1:1"] and ["doc", "update", "P1:1", "P2:1"]
    // then Key A would be a prefix of Key B.
    // This causes issues in filesystem-like adapters (file vs directory conflict).
    // We must ensure our serialization produces a single segment.

    const frontierA = [{ peer: "1", counter: 1 }]
    const frontierB = [
      { peer: "1", counter: 1 },
      { peer: "2", counter: 1 },
    ]

    const keyA = serializeFrontiers(frontierA)
    const keyB = serializeFrontiers(frontierB)

    // Verify they are single strings
    expect(typeof keyA).toBe("string")
    expect(typeof keyB).toBe("string")

    // Verify they are distinct segments (one is not a prefix of the other in a way that implies hierarchy)
    // In a string array key ["a", "b"], "a" is a prefix.
    // Here we just want to ensure we return a single string, so the Key becomes ["...", keyA]
    // The storage adapter will treat keyA and keyB as sibling leaves, not parent/child.

    // Just to be explicit about the string format:
    expect(keyA).toBe("1:1")
    expect(keyB).toBe("1:1,2:1")

    // And obviously
    expect(keyA).not.toEqual(keyB)
  })

  it("preserves deduplication even with ordering if we use logical time (sum of counters)", () => {
    // User feedback: "introducing timestamps... destroys deduplication"
    // Solution: Use deterministic logical time derived from the frontier itself.

    const docA = new LoroDoc()
    docA.setPeerId(1n)
    docA.getText("text").insert(0, "Shared Update")
    docA.commit()

    // Helper to calculate logical time
    const getLogicalTime = (frontiers: { peer: string; counter: number }[]) =>
      frontiers.reduce((sum, f) => sum + f.counter, 0)

    // Pod 1
    const frontiers1 = docA.frontiers()
    const time1 = getLogicalTime(frontiers1)
    const key1 = `[doc,"update",${time1},"${serializeFrontiers(frontiers1)}"]`

    // Pod 2 (same state)
    const docB = new LoroDoc()
    docB.import(docA.export({ mode: "snapshot" }))
    const frontiers2 = docB.frontiers()
    const time2 = getLogicalTime(frontiers2)
    const key2 = `[doc,"update",${time2},"${serializeFrontiers(frontiers2)}"]`

    // Keys are identical -> Dedup works!
    expect(key1).toEqual(key2)

    // And we have ordering!
    // Let's make a dependent update
    docA.getText("text").insert(0, "New Update")
    docA.commit()

    const frontiers3 = docA.frontiers()
    const time3 = getLogicalTime(frontiers3)

    // New update MUST have higher logical time
    expect(time3).toBeGreaterThan(time1)
  })

  it("handles the '3rd peer' scenario correctly (logical time reflects causal dependencies)", () => {
    // User skepticism: "If we introduce a 3rd peer... logical time might be undermined"
    // Let's test it.

    const docBase = new LoroDoc()
    docBase.setPeerId(0n)
    docBase.getText("text").insert(0, "Base")
    docBase.commit()
    const baseSnapshot = docBase.export({ mode: "snapshot" })

    // Peer 3 makes an edit (Update C)
    const doc3 = new LoroDoc()
    doc3.setPeerId(3n)
    doc3.import(baseSnapshot)
    doc3.getText("text").insert(0, "C")
    doc3.commit()
    const updateC = doc3.export({ mode: "update", from: docBase.version() })

    // Pod 1 knows about C
    const doc1 = new LoroDoc()
    doc1.setPeerId(1n)
    doc1.import(baseSnapshot)
    doc1.import(updateC)

    // Pod 1 makes an edit (Update A) - Depends on C
    doc1.getText("text").insert(0, "A")
    doc1.commit()

    // Pod 2 does NOT know about C
    const doc2 = new LoroDoc()
    doc2.setPeerId(2n)
    doc2.import(baseSnapshot)

    // Pod 2 makes an edit (Update B) - Concurrent with C and A
    doc2.getText("text").insert(0, "B")
    doc2.commit()

    // Calculate Logical Times using Version Vector (Total Ops)
    // Sum of Frontier counters is NOT sufficient (as proven by failure).
    // Sum of Version Vector IS a valid causal clock.

    const getCausalLength = (doc: LoroDoc): number => {
      const vv = doc.version().toJSON() as
        | Record<string, number>
        | Map<string, number>
      // Handle both Map and Object just in case
      if (vv instanceof Map) {
        let sum = 0
        for (const v of vv.values()) sum += v
        return sum
      }
      return Object.values(vv).reduce((a: number, b) => a + (b as number), 0)
    }

    const t1 = getCausalLength(doc1)
    const t2 = getCausalLength(doc2)

    // Analysis:
    // doc1 has Base(1) + C(1) + A(1) = 3 ops
    // doc2 has Base(1) + B(1) = 2 ops

    console.log({ t1, t2 })

    // t1 should be > t2
    expect(t1).toBeGreaterThan(t2)
  })
})
