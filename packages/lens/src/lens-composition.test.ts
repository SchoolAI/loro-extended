import { createTypedDoc, loro, Shape } from "@loro-extended/change"
import { LoroDoc } from "loro-crdt"
import { describe, expect, it } from "vitest"
import { createLens } from "./lens.js"

// Test schema
const TestSchema = Shape.doc({
  counter: Shape.counter(),
  text: Shape.text(),
  data: Shape.record(Shape.plain.string()),
})

describe("lens composition", () => {
  it("chains lenses correctly", () => {
    const source = createTypedDoc(TestSchema)

    // First lens: accept all
    const lens1 = createLens(source)

    // Second lens: chain from first lens's worldview
    const lens2 = createLens(lens1.worldview)

    // Verify chain structure
    expect(lens1.world).toBe(source)
    expect(lens2.world).toBe(lens1.worldview)

    lens2.dispose()
    lens1.dispose()
  })

  it("propagates local changes through chain", () => {
    const source = createTypedDoc(TestSchema)
    const lens1 = createLens(source)
    const lens2 = createLens(lens1.worldview)

    // Change through innermost lens
    lens2.change(d => {
      d.counter.increment(5)
    })

    // Should propagate all the way to source
    expect(lens2.worldview.counter.value).toBe(5)
    expect(lens1.worldview.counter.value).toBe(5)
    expect(source.counter.value).toBe(5)

    lens2.dispose()
    lens1.dispose()
  })

  it("filters apply at each level", () => {
    const source = createTypedDoc(TestSchema)

    // First lens: accept commits from peers starting with "1" only
    const lens1 = createLens(source, {
      filter: info => info.peerId.startsWith("1"),
    })

    // Second lens: accept commits with "allowed" in message
    const lens2 = createLens(lens1.worldview, {
      filter: info => {
        const msg = info.message as { allowed?: boolean } | undefined
        return msg?.allowed === true
      },
    })

    // Create external doc from peer 111 with allowed message
    const allowedDoc = new LoroDoc()
    allowedDoc.setPeerId("111")
    allowedDoc.getCounter("counter").increment(10)
    allowedDoc.commit({ message: JSON.stringify({ allowed: true }) })

    // Create external doc from peer 112 without allowed message (different peer, same prefix)
    const notAllowedDoc = new LoroDoc()
    notAllowedDoc.setPeerId("112")
    notAllowedDoc.getCounter("counter").increment(20)
    notAllowedDoc.commit({ message: JSON.stringify({ allowed: false }) })

    // Create external doc from peer 222 (wrong peer prefix)
    const wrongPeerDoc = new LoroDoc()
    wrongPeerDoc.setPeerId("222")
    wrongPeerDoc.getCounter("counter").increment(30)
    wrongPeerDoc.commit({ message: JSON.stringify({ allowed: true }) })

    // Import all to source
    loro(source).doc.import(allowedDoc.export({ mode: "update" }))
    loro(source).doc.import(notAllowedDoc.export({ mode: "update" }))
    loro(source).doc.import(wrongPeerDoc.export({ mode: "update" }))

    // Source has all (10+20+30=60)
    expect(source.counter.value).toBe(60)

    // Lens1 only has peers starting with "1" (10+20=30)
    expect(lens1.worldview.counter.value).toBe(30)

    // Lens2 only has peers starting with "1" with allowed=true (10)
    expect(lens2.worldview.counter.value).toBe(10)

    lens2.dispose()
    lens1.dispose()
  })

  it("handles dispose in chain correctly", () => {
    const source = createTypedDoc(TestSchema)
    const lens1 = createLens(source)
    const lens2 = createLens(lens1.worldview)

    // Make a change BEFORE dispose
    lens1.change(d => {
      d.counter.increment(5)
    })

    expect(lens1.worldview.counter.value).toBe(5)
    expect(lens2.worldview.counter.value).toBe(5)
    expect(source.counter.value).toBe(5)

    // Dispose inner lens
    lens2.dispose()

    // Outer lens should still work after inner dispose
    lens1.change(d => {
      d.counter.increment(3)
    })

    expect(lens1.worldview.counter.value).toBe(8)
    expect(source.counter.value).toBe(8)

    // Inner lens should not receive updates after dispose
    const externalDoc = new LoroDoc()
    externalDoc.setPeerId("999")
    externalDoc.getCounter("counter").increment(10)
    externalDoc.commit()

    loro(source).doc.import(externalDoc.export({ mode: "update" }))

    // Source and lens1 have it
    expect(source.counter.value).toBe(18)
    expect(lens1.worldview.counter.value).toBe(18)

    // lens2 should still have value from before dispose (5)
    // It doesn't receive the +3 or +10 changes
    expect(lens2.worldview.counter.value).toBe(5)

    lens1.dispose()
  })

  it("supports three-level chain", () => {
    const source = createTypedDoc(TestSchema)
    const lens1 = createLens(source)
    const lens2 = createLens(lens1.worldview)
    const lens3 = createLens(lens2.worldview)

    // Change through deepest lens
    lens3.change(d => {
      d.counter.increment(7)
    })

    // Should propagate all the way
    expect(lens3.worldview.counter.value).toBe(7)
    expect(lens2.worldview.counter.value).toBe(7)
    expect(lens1.worldview.counter.value).toBe(7)
    expect(source.counter.value).toBe(7)

    lens3.dispose()
    lens2.dispose()
    lens1.dispose()
  })
})
