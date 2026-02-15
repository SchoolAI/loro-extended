import { EXT_SYMBOL, Shape } from "@loro-extended/change"
import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { createRepoWrapper, useDocument, useLens } from "../test-utils"

const testSchema = Shape.doc({
  title: Shape.text().placeholder("Lens Doc"),
  count: Shape.counter(),
})

describe("useLens", () => {
  it("should return lens and JSON snapshot", () => {
    const RepoWrapper = createRepoWrapper()
    const documentId = "lens-doc-json"
    const { result, rerender } = renderHook(
      () => {
        const doc = useDocument(documentId, testSchema)
        return useLens(doc)
      },
      { wrapper: RepoWrapper },
    )

    const initialLens = result.current.lens
    rerender()
    expect(result.current.lens).toBe(initialLens)
    expect(result.current.doc.title).toBe("Lens Doc")
    expect(result.current.doc.count).toBe(0)
    expect(result.current.lens.worldview).toBeDefined()
  })

  it("should update when lens changes are applied", () => {
    const RepoWrapper = createRepoWrapper()
    const documentId = "lens-doc-updates"
    const { result } = renderHook(
      () => {
        const doc = useDocument(documentId, testSchema)
        const lensState = useLens(doc)
        return { doc, lensState }
      },
      { wrapper: RepoWrapper },
    )

    act(() => {
      const { lens } = result.current.lensState
      // Cast to any to workaround type inference limitation with Lens<D>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      lens[EXT_SYMBOL].change((d: any) => {
        d.title.delete(0, d.title.length)
        d.title.insert(0, "Updated Lens Doc")
        d.count.increment(3)
      })
    })

    expect(result.current.lensState.doc.title).toBe("Updated Lens Doc")
    expect(result.current.lensState.doc.count).toBe(3)
  })

  it("should support selector", () => {
    const RepoWrapper = createRepoWrapper()
    const documentId = "lens-doc-selector"
    const { result } = renderHook(
      () => {
        const doc = useDocument(documentId, testSchema)
        return useLens(doc, undefined, d => d.title)
      },
      { wrapper: RepoWrapper },
    )

    expect(result.current.doc).toBe("Lens Doc")
  })
})
