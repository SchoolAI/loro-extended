import { createTypedDoc, loro, Shape } from "@loro-extended/change"
import { LoroDoc } from "loro-crdt"
import { describe, expect, it } from "vitest"
import { filterAll, filterNone } from "./filters.js"
import { createLens, parseCommitInfo } from "./lens.js"

// Test schema
const TestSchema = Shape.doc({
  counter: Shape.counter(),
  text: Shape.text(),
  data: Shape.record(Shape.plain.string()),
})

describe("createLens", () => {
  describe("basic functionality", () => {
    it("creates a lens with doc and source", () => {
      const source = createTypedDoc(TestSchema)
      const lens = createLens(source)

      expect(lens.worldview).toBeDefined()
      expect(lens.world).toBe(source)
      expect(lens.change).toBeInstanceOf(Function)
      expect(lens.dispose).toBeInstanceOf(Function)

      lens.dispose()
    })

    it("doc starts with same state as source", () => {
      const source = createTypedDoc(TestSchema)
      source.change(d => {
        d.counter.increment(5)
        d.text.insert(0, "Hello")
        d.data.set("key", "value")
      })

      const lens = createLens(source)

      expect(lens.worldview.counter.value).toBe(5)
      expect(lens.worldview.text.toString()).toBe("Hello")
      expect(lens.worldview.data.get("key")).toBe("value")

      lens.dispose()
    })

    it("doc has same peer ID as source", () => {
      const source = createTypedDoc(TestSchema)
      const lens = createLens(source)

      const sourcePeerId = loro(source).doc.peerId
      const docPeerId = loro(lens.worldview).doc.peerId

      expect(docPeerId).toBe(sourcePeerId)

      lens.dispose()
    })
  })

  describe("local changes via change()", () => {
    it("applies changes to doc", () => {
      const source = createTypedDoc(TestSchema)
      const lens = createLens(source)

      lens.change(d => {
        d.counter.increment(10)
        d.text.insert(0, "World")
      })

      expect(lens.worldview.counter.value).toBe(10)
      expect(lens.worldview.text.toString()).toBe("World")

      lens.dispose()
    })

    it("propagates changes to source via applyDiff", () => {
      const source = createTypedDoc(TestSchema)
      const lens = createLens(source)

      lens.change(d => {
        d.counter.increment(10)
        d.text.insert(0, "World")
      })

      // Source should have the changes
      expect(source.counter.value).toBe(10)
      expect(source.text.toString()).toBe("World")

      lens.dispose()
    })

    it("local changes bypass filter", () => {
      const source = createTypedDoc(TestSchema)
      const lens = createLens(source, { filter: filterAll }) // Reject all external

      // Local change should still work
      lens.change(d => {
        d.counter.increment(5)
      })

      expect(lens.worldview.counter.value).toBe(5)
      expect(source.counter.value).toBe(5)

      lens.dispose()
    })

    it("handles no-op changes gracefully", () => {
      const source = createTypedDoc(TestSchema)
      const lens = createLens(source)

      // This should not throw
      lens.change(() => {
        // No changes
      })

      expect(lens.worldview.counter.value).toBe(0)

      lens.dispose()
    })

    it("propagates commit messages from worldview to world", () => {
      const world = createTypedDoc(TestSchema)
      const lens = createLens(world)

      const worldLoroDoc = loro(world).doc
      const frontiersBefore = worldLoroDoc.frontiers()

      const commitMessage = "client-identity-message"
      lens.change(
        d => {
          d.counter.increment(1)
        },
        { commitMessage },
      )

      const frontiersAfter = worldLoroDoc.frontiers()
      const spans = worldLoroDoc.findIdSpansBetween(
        frontiersBefore,
        frontiersAfter,
      )
      const changes = spans.forward.flatMap(span =>
        worldLoroDoc.exportJsonInIdSpan({
          peer: span.peer,
          counter: span.counter,
          length: span.length,
        }),
      )

      expect(changes).toHaveLength(1)
      expect(changes[0].msg).toBe(commitMessage)

      lens.dispose()
    })

    it("serializes object commit messages to JSON", () => {
      const source = createTypedDoc(TestSchema)
      const lens = createLens(source)

      const sourceLoroDoc = loro(source).doc
      const frontiersBefore = sourceLoroDoc.frontiers()

      const commitMessage = { playerId: "alice", action: "move" }
      lens.change(
        d => {
          d.counter.increment(1)
        },
        { commitMessage },
      )

      const frontiersAfter = sourceLoroDoc.frontiers()
      const spans = sourceLoroDoc.findIdSpansBetween(
        frontiersBefore,
        frontiersAfter,
      )
      const changes = spans.forward.flatMap(span =>
        sourceLoroDoc.exportJsonInIdSpan({
          peer: span.peer,
          counter: span.counter,
          length: span.length,
        }),
      )

      expect(changes).toHaveLength(1)
      expect(changes[0].msg).toBe(JSON.stringify(commitMessage))

      lens.dispose()
    })

    it("propagates commit messages through chained lenses", () => {
      const source = createTypedDoc(TestSchema)
      const lens1 = createLens(source)
      const lens2 = createLens(lens1.worldview)

      const sourceLoroDoc = loro(source).doc
      const frontiersBefore = sourceLoroDoc.frontiers()

      const commitMessage = "chained-message"
      lens2.change(
        d => {
          d.counter.increment(1)
        },
        { commitMessage },
      )

      const frontiersAfter = sourceLoroDoc.frontiers()
      const spans = sourceLoroDoc.findIdSpansBetween(
        frontiersBefore,
        frontiersAfter,
      )
      const changes = spans.forward.flatMap(span =>
        sourceLoroDoc.exportJsonInIdSpan({
          peer: span.peer,
          counter: span.counter,
          length: span.length,
        }),
      )

      expect(changes).toHaveLength(1)
      expect(changes[0].msg).toBe(commitMessage)

      // Verify the change propagated through the chain
      expect(source.counter.value).toBe(1)
      expect(lens1.worldview.counter.value).toBe(1)
      expect(lens2.worldview.counter.value).toBe(1)

      lens2.dispose()
      lens1.dispose()
    })

    it("propagates commit messages through three-level chain", () => {
      const source = createTypedDoc(TestSchema)
      const lens1 = createLens(source)
      const lens2 = createLens(lens1.worldview)
      const lens3 = createLens(lens2.worldview)

      const sourceLoroDoc = loro(source).doc
      const frontiersBefore = sourceLoroDoc.frontiers()

      const commitMessage = { level: 3, action: "deep-change" }
      lens3.change(
        d => {
          d.counter.increment(1)
        },
        { commitMessage },
      )

      const frontiersAfter = sourceLoroDoc.frontiers()
      const spans = sourceLoroDoc.findIdSpansBetween(
        frontiersBefore,
        frontiersAfter,
      )
      const changes = spans.forward.flatMap(span =>
        sourceLoroDoc.exportJsonInIdSpan({
          peer: span.peer,
          counter: span.counter,
          length: span.length,
        }),
      )

      expect(changes).toHaveLength(1)
      expect(changes[0].msg).toBe(JSON.stringify(commitMessage))

      // Verify the change propagated through the entire chain
      expect(source.counter.value).toBe(1)
      expect(lens1.worldview.counter.value).toBe(1)
      expect(lens2.worldview.counter.value).toBe(1)
      expect(lens3.worldview.counter.value).toBe(1)

      lens3.dispose()
      lens2.dispose()
      lens1.dispose()
    })
  })

  describe("filtering external imports", () => {
    it("accepts all commits when filter returns true", () => {
      const source = createTypedDoc(TestSchema)
      const lens = createLens(source, { filter: filterNone })

      // Simulate external import to source
      const externalDoc = new LoroDoc()
      externalDoc.setPeerId("999")
      externalDoc.getCounter("counter").increment(7)
      externalDoc.commit()

      const bytes = externalDoc.export({ mode: "update" })
      loro(source).doc.import(bytes)

      // Should reach doc
      expect(lens.worldview.counter.value).toBe(7)

      lens.dispose()
    })

    it("rejects all commits when filter returns false", () => {
      const source = createTypedDoc(TestSchema)
      const lens = createLens(source, { filter: filterAll })

      // Simulate external import to source
      const externalDoc = new LoroDoc()
      externalDoc.setPeerId("999")
      externalDoc.getCounter("counter").increment(7)
      externalDoc.commit()

      const bytes = externalDoc.export({ mode: "update" })
      loro(source).doc.import(bytes)

      // Source has it, but doc should not
      expect(source.counter.value).toBe(7)
      expect(lens.worldview.counter.value).toBe(0)

      lens.dispose()
    })

    it("filters based on commit message content", () => {
      const source = createTypedDoc(TestSchema)
      const lens = createLens(source, {
        filter: info => {
          const msg = info.message as { allowed?: boolean } | undefined
          return msg?.allowed === true
        },
      })

      // Create external doc with allowed message
      const allowedDoc = new LoroDoc()
      allowedDoc.setPeerId("111")
      allowedDoc.getCounter("counter").increment(5)
      allowedDoc.commit({ message: JSON.stringify({ allowed: true }) })

      // Create external doc with disallowed message
      const disallowedDoc = new LoroDoc()
      disallowedDoc.setPeerId("222")
      disallowedDoc.getCounter("counter").increment(10)
      disallowedDoc.commit({ message: JSON.stringify({ allowed: false }) })

      // Import allowed
      loro(source).doc.import(allowedDoc.export({ mode: "update" }))
      expect(lens.worldview.counter.value).toBe(5)

      // Import disallowed
      loro(source).doc.import(disallowedDoc.export({ mode: "update" }))
      // Doc should still be 5 (disallowed was rejected)
      expect(lens.worldview.counter.value).toBe(5)
      // But source has both
      expect(source.counter.value).toBe(15)

      lens.dispose()
    })

    it("maintains causal consistency - rejects subsequent commits from rejected peer", () => {
      const source = createTypedDoc(TestSchema)
      let callCount = 0
      const lens = createLens(source, {
        filter: info => {
          callCount++
          // Reject the first commit from peer 333
          if (info.peerId === "333" && callCount === 1) {
            return false
          }
          return true
        },
      })

      // Create external doc with multiple commits from same peer
      const externalDoc = new LoroDoc()
      externalDoc.setPeerId("333")

      // First commit (will be rejected)
      externalDoc.getCounter("counter").increment(1)
      externalDoc.commit()

      // Second commit (should also be rejected due to causal consistency)
      externalDoc.getCounter("counter").increment(2)
      externalDoc.commit()

      // Third commit (should also be rejected)
      externalDoc.getCounter("counter").increment(3)
      externalDoc.commit()

      const bytes = externalDoc.export({ mode: "update" })
      loro(source).doc.import(bytes)

      // Source has all changes (1+2+3=6)
      expect(source.counter.value).toBe(6)
      // Doc should have none (first was rejected, subsequent skipped)
      expect(lens.worldview.counter.value).toBe(0)

      lens.dispose()
    })

    it("accepts commits from different peers independently", () => {
      const source = createTypedDoc(TestSchema)
      const lens = createLens(source, {
        filter: info => {
          // Reject peer 333, accept peer 444
          return info.peerId !== "333"
        },
      })

      // Create commits from peer 333 (rejected)
      const rejectedDoc = new LoroDoc()
      rejectedDoc.setPeerId("333")
      rejectedDoc.getCounter("counter").increment(10)
      rejectedDoc.commit()

      // Create commits from peer 444 (accepted)
      const acceptedDoc = new LoroDoc()
      acceptedDoc.setPeerId("444")
      acceptedDoc.getCounter("counter").increment(5)
      acceptedDoc.commit()

      // Import both
      loro(source).doc.import(rejectedDoc.export({ mode: "update" }))
      loro(source).doc.import(acceptedDoc.export({ mode: "update" }))

      // Source has both (10+5=15)
      expect(source.counter.value).toBe(15)
      // Doc only has accepted (5)
      expect(lens.worldview.counter.value).toBe(5)

      lens.dispose()
    })
  })

  describe("dispose", () => {
    it("stops processing after dispose", () => {
      const source = createTypedDoc(TestSchema)
      const lens = createLens(source)

      lens.dispose()

      // Changes after dispose should be no-ops
      lens.change(d => {
        d.counter.increment(10)
      })

      expect(lens.worldview.counter.value).toBe(0)
      expect(source.counter.value).toBe(0)
    })

    it("unsubscribes from source", () => {
      const source = createTypedDoc(TestSchema)
      const lens = createLens(source, { filter: filterNone })

      lens.dispose()

      // External import after dispose should not reach doc
      const externalDoc = new LoroDoc()
      externalDoc.setPeerId("999")
      externalDoc.getCounter("counter").increment(7)
      externalDoc.commit()

      loro(source).doc.import(externalDoc.export({ mode: "update" }))

      // Source has it
      expect(source.counter.value).toBe(7)
      // Doc should not (subscription was removed)
      expect(lens.worldview.counter.value).toBe(0)
    })

    it("can be called multiple times safely", () => {
      const source = createTypedDoc(TestSchema)
      const lens = createLens(source)

      // Should not throw
      lens.dispose()
      lens.dispose()
      lens.dispose()
    })
  })

  describe("concurrent operations", () => {
    it("handles local change during external import processing", () => {
      const source = createTypedDoc(TestSchema)
      const lens = createLens(source)

      // Make a local change
      lens.change(d => {
        d.counter.increment(5)
      })

      // Simulate external import
      const externalDoc = new LoroDoc()
      externalDoc.setPeerId("999")
      externalDoc.getCounter("counter").increment(3)
      externalDoc.commit()

      loro(source).doc.import(externalDoc.export({ mode: "update" }))

      // Both should be present
      expect(lens.worldview.counter.value).toBe(8)
      expect(source.counter.value).toBe(8)

      lens.dispose()
    })
  })

  describe("filter API with CommitInfo", () => {
    it("provides parsed commit info to filter", () => {
      const source = createTypedDoc(TestSchema)
      const receivedInfos: Array<{
        peerId: string
        counter: number
        message: unknown
      }> = []

      const lens = createLens(source, {
        filter: info => {
          receivedInfos.push({
            peerId: info.peerId,
            counter: info.counter,
            message: info.message,
          })
          return true
        },
      })

      // Create external doc with JSON message
      const externalDoc = new LoroDoc()
      externalDoc.setPeerId("12345")
      externalDoc.getCounter("counter").increment(5)
      externalDoc.commit({
        message: JSON.stringify({ role: "admin", userId: "abc" }),
      })

      loro(source).doc.import(externalDoc.export({ mode: "update" }))

      // Verify the filter received parsed info
      expect(receivedInfos.length).toBe(1)
      expect(receivedInfos[0].peerId).toBe("12345")
      expect(receivedInfos[0].counter).toBe(0)
      expect(receivedInfos[0].message).toEqual({ role: "admin", userId: "abc" })

      lens.dispose()
    })

    it("handles unparseable messages gracefully", () => {
      const source = createTypedDoc(TestSchema)
      let receivedMessage: unknown = "not-set"

      const lens = createLens(source, {
        filter: info => {
          receivedMessage = info.message
          return true
        },
      })

      // Create external doc with non-JSON message
      const externalDoc = new LoroDoc()
      externalDoc.setPeerId("999")
      externalDoc.getCounter("counter").increment(3)
      externalDoc.commit({ message: "not valid json" })

      loro(source).doc.import(externalDoc.export({ mode: "update" }))

      // Message should be undefined (not parseable)
      expect(receivedMessage).toBeUndefined()

      lens.dispose()
    })

    it("filters by peer ID", () => {
      const source = createTypedDoc(TestSchema)
      const lens = createLens(source, {
        filter: info => info.peerId === "111",
      })

      // Create trusted peer doc (peer 111)
      const trustedDoc = new LoroDoc()
      trustedDoc.setPeerId("111")
      trustedDoc.getCounter("counter").increment(10)
      trustedDoc.commit()

      // Create untrusted peer doc (peer 222)
      const untrustedDoc = new LoroDoc()
      untrustedDoc.setPeerId("222")
      untrustedDoc.getCounter("counter").increment(20)
      untrustedDoc.commit()

      loro(source).doc.import(trustedDoc.export({ mode: "update" }))
      loro(source).doc.import(untrustedDoc.export({ mode: "update" }))

      // Only trusted peer's changes should reach doc
      expect(lens.worldview.counter.value).toBe(10)
      expect(source.counter.value).toBe(30)

      lens.dispose()
    })

    it("filters by message content", () => {
      const source = createTypedDoc(TestSchema)
      const lens = createLens(source, {
        filter: info => {
          const msg = info.message as { allowed?: boolean } | undefined
          return msg?.allowed === true
        },
      })

      // Create allowed doc
      const allowedDoc = new LoroDoc()
      allowedDoc.setPeerId("111")
      allowedDoc.getCounter("counter").increment(5)
      allowedDoc.commit({ message: JSON.stringify({ allowed: true }) })

      // Create disallowed doc
      const disallowedDoc = new LoroDoc()
      disallowedDoc.setPeerId("222")
      disallowedDoc.getCounter("counter").increment(10)
      disallowedDoc.commit({ message: JSON.stringify({ allowed: false }) })

      loro(source).doc.import(allowedDoc.export({ mode: "update" }))
      loro(source).doc.import(disallowedDoc.export({ mode: "update" }))

      // Only allowed changes should reach doc
      expect(lens.worldview.counter.value).toBe(5)
      expect(source.counter.value).toBe(15)

      lens.dispose()
    })
  })

  describe("parseCommitInfo", () => {
    it("parses commit ID correctly", () => {
      const commit = {
        id: "42@12345" as `${number}@${number}`,
        timestamp: 1234567890,
        msg: JSON.stringify({ test: true }),
        deps: [] as `${number}@${number}`[],
        lamport: 1,
        ops: [],
      }

      const info = parseCommitInfo(commit)

      expect(info.peerId).toBe("12345")
      expect(info.counter).toBe(42)
      expect(info.timestamp).toBe(1234567890)
      expect(info.message).toEqual({ test: true })
      expect(info.raw).toBe(commit)
    })

    it("handles missing message", () => {
      const commit = {
        id: "0@999" as `${number}@${number}`,
        timestamp: 0,
        msg: null,
        deps: [] as `${number}@${number}`[],
        lamport: 0,
        ops: [],
      }

      const info = parseCommitInfo(commit)

      expect(info.message).toBeUndefined()
    })

    it("handles invalid JSON message", () => {
      const commit = {
        id: "0@999" as `${number}@${number}`,
        timestamp: 0,
        msg: "not json",
        deps: [] as `${number}@${number}`[],
        lamport: 0,
        ops: [],
      }

      const info = parseCommitInfo(commit)

      expect(info.message).toBeUndefined()
    })
  })
})
