/**
 * Tests for PeerID consistency in @loro-extended/repo
 *
 * Issue: LoroDoc PeerID doesn't match Repo identity.peerId
 *
 * The LoroDoc should have its PeerID set to match the Repo's identity.peerId
 * for consistency, debugging, and compatibility with external tools.
 */

import { Shape } from "@loro-extended/change"
import { describe, expect, it } from "vitest"
import { Repo } from "../repo.js"
import { sync } from "../sync.js"

describe("LoroDoc PeerID consistency", () => {
  const DocSchema = Shape.doc({
    content: Shape.text(),
  })

  it("should have LoroDoc PeerID match Repo identity PeerID", () => {
    const repo = new Repo({
      identity: { name: "Test", type: "user", peerId: "12345" as `${number}` },
      adapters: [],
    })

    const doc = repo.get("test-doc", DocSchema)

    // BUG: The LoroDoc's PeerID should match the Repo's identity PeerID
    expect(sync(doc).loroDoc.peerId.toString()).toBe(repo.identity.peerId)

    repo.reset()
  })

  it("should have consistent PeerID across multiple documents", () => {
    const repo = new Repo({
      identity: { name: "Test", type: "user", peerId: "100" as `${number}` },
      adapters: [],
    })

    const doc1 = repo.get("doc-1", DocSchema)
    const doc2 = repo.get("doc-2", DocSchema)

    // Both documents should have the same PeerID (matching the Repo's identity)
    expect(sync(doc1).loroDoc.peerId.toString()).toBe("100")
    expect(sync(doc2).loroDoc.peerId.toString()).toBe("100")

    repo.reset()
  })
})
