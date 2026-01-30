import type { LoroEventBatch } from "loro-crdt"
import { describe, expect, it } from "vitest"
import { createDiffOverlay } from "./diff-overlay.js"
import { createTypedDoc, loro, Shape } from "./index.js"

describe("diff overlay", () => {
  it("should read before values via overlay without checkout", () => {
    const schema = Shape.doc({
      counter: Shape.counter(),
      info: Shape.struct({
        name: Shape.plain.string(),
        count: Shape.plain.number(),
      }),
      list: Shape.list(Shape.plain.number()),
      text: Shape.text(),
    })

    const doc = createTypedDoc(schema)
    const loroDoc = loro(doc).doc

    doc.counter.increment(10)
    doc.info.name = "Alice"
    doc.info.count = 1
    doc.list.push(1)
    doc.text.insert(0, "hello")
    loroDoc.commit()

    const transitions: Array<{
      before: {
        counter: number
        name: string
        count: number
        list: number[]
        text: string
      }
      after: {
        counter: number
        name: string
        count: number
        list: number[]
        text: string
      }
    }> = []

    loroDoc.subscribe(event => {
      const batch = event as LoroEventBatch
      if (batch.by === "checkout") return

      const overlay = createDiffOverlay(loroDoc, batch)
      const beforeDoc = createTypedDoc(schema, { doc: loroDoc, overlay })
      const afterDoc = createTypedDoc(schema, { doc: loroDoc })

      transitions.push({
        before: {
          counter: beforeDoc.counter.value,
          name: beforeDoc.info.name,
          count: beforeDoc.info.count,
          list: beforeDoc.list.toArray(),
          text: beforeDoc.text.toString(),
        },
        after: {
          counter: afterDoc.counter.value,
          name: afterDoc.info.name,
          count: afterDoc.info.count,
          list: afterDoc.list.toArray(),
          text: afterDoc.text.toString(),
        },
      })
    })

    doc.change(draft => {
      draft.counter.increment(5)
      draft.info.name = "Bob"
      draft.info.count = 2
      draft.list.push(2)
      draft.text.update("hello world")
    })

    expect(transitions).toHaveLength(1)
    expect(transitions[0].before).toEqual({
      counter: 10,
      name: "Alice",
      count: 1,
      list: [1],
      text: "hello",
    })
    expect(transitions[0].after).toEqual({
      counter: 15,
      name: "Bob",
      count: 2,
      list: [1, 2],
      text: "hello world",
    })
  })
})
