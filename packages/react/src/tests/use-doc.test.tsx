import { Shape } from "@loro-extended/change"
import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { useDoc, useHandle } from "../index.js"
import { createRepoWrapper, createTestDocumentId } from "../test-utils.js"

const testSchema = Shape.doc({
  title: Shape.text().placeholder("Test Document"),
  count: Shape.counter(),
})

describe("useDoc", () => {
  it("should return JSON snapshot", () => {
    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result } = renderHook(
      () => {
        const handle = useHandle(documentId, testSchema)
        return useDoc(handle)
      },
      { wrapper: RepoWrapper },
    )

    // useDoc returns JSON, so values are plain types
    expect(result.current.title).toBe("Test Document")
    expect(result.current.count).toBe(0)
  })

  it("should support selector for fine-grained access", () => {
    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result } = renderHook(
      () => {
        const handle = useHandle(documentId, testSchema)
        return useDoc(handle, d => d.title)
      },
      { wrapper: RepoWrapper },
    )

    expect(result.current).toBe("Test Document")
  })

  it("should support selector for plain object return", () => {
    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result } = renderHook(
      () => {
        const handle = useHandle(documentId, testSchema)
        return useDoc(handle, d => ({
          title: d.title,
          count: d.count,
        }))
      },
      { wrapper: RepoWrapper },
    )

    expect(result.current).toEqual({
      title: "Test Document",
      count: 0,
    })
  })

  it("should allow mutations via handle.batch", () => {
    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result } = renderHook(
      () => {
        const handle = useHandle(documentId, testSchema)
        const doc = useDoc(handle)
        return { handle, doc }
      },
      { wrapper: RepoWrapper },
    )

    // Verify initial state - doc is JSON
    expect(result.current.doc.title).toBe("Test Document")

    // Mutate via handle.batch (wrapped in act to allow React to process updates)
    act(() => {
      result.current.handle.change(d => {
        d.title.delete(0, d.title.length)
        d.title.insert(0, "Updated Title")
      })
    })

    // Verify mutation worked
    expect(result.current.doc.title).toBe("Updated Title")
  })

  it("should allow direct mutations via handle.doc", () => {
    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result } = renderHook(
      () => {
        const handle = useHandle(documentId, testSchema)
        const doc = useDoc(handle)
        return { handle, doc }
      },
      { wrapper: RepoWrapper },
    )

    // Verify initial state - doc is JSON
    expect(result.current.doc.count).toBe(0)

    // Direct mutation via handle.doc (auto-commits)
    act(() => {
      result.current.handle.doc.count.increment(5)
    })

    // Verify mutation worked
    expect(result.current.doc.count).toBe(5)
  })

  it("should work with different document IDs", () => {
    const documentId1 = createTestDocumentId()
    const documentId2 = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result, rerender } = renderHook(
      ({ docId }) => {
        const handle = useHandle(docId, testSchema)
        const doc = useDoc(handle)
        return { handle, doc }
      },
      {
        initialProps: { docId: documentId1 },
        wrapper: RepoWrapper,
      },
    )

    const handle1 = result.current.handle
    expect(handle1.docId).toBe(documentId1)

    rerender({ docId: documentId2 })

    // Note: Due to useState initialization, handle won't change on docId change
    // This is expected behavior - the handle is stable for the component's lifetime
    // If you need to switch documents, you should remount the component
    const handle2 = result.current.handle
    expect(handle2).toBe(handle1) // Same handle due to useState
  })
})
