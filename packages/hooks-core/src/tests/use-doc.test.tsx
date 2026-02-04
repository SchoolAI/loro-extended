import { change, Shape } from "@loro-extended/change"
import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import {
  createRepoWrapper,
  createTestDocumentId,
  useDoc,
  useHandle,
} from "../test-utils"

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

    // Mutate via change() (wrapped in act to allow React to process updates)
    act(() => {
      change(result.current.handle.doc, d => {
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

  it("should re-render when document is checked out to historical frontier", () => {
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

    // Initial state
    expect(result.current.doc.title).toBe("Test Document")

    // Make a change and capture the frontier
    act(() => {
      change(result.current.handle.doc, d => {
        d.title.delete(0, d.title.length)
        d.title.insert(0, "First Edit")
      })
    })
    const frontier1 = result.current.handle.loroDoc.frontiers()
    expect(result.current.doc.title).toBe("First Edit")

    // Make another change
    act(() => {
      change(result.current.handle.doc, d => {
        d.title.delete(0, d.title.length)
        d.title.insert(0, "Second Edit")
      })
    })
    expect(result.current.doc.title).toBe("Second Edit")

    // Checkout to the first frontier
    act(() => {
      result.current.handle.loroDoc.checkout(frontier1)
    })

    // Should now show the state at frontier1
    expect(result.current.doc.title).toBe("First Edit")
  })

  it("should re-render when checkoutToLatest is called", () => {
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

    // Make a change and capture the frontier
    act(() => {
      change(result.current.handle.doc, d => {
        d.title.delete(0, d.title.length)
        d.title.insert(0, "First Edit")
      })
    })
    const frontier1 = result.current.handle.loroDoc.frontiers()

    // Make another change
    act(() => {
      change(result.current.handle.doc, d => {
        d.title.delete(0, d.title.length)
        d.title.insert(0, "Latest Edit")
      })
    })
    expect(result.current.doc.title).toBe("Latest Edit")

    // Checkout to historical state
    act(() => {
      result.current.handle.loroDoc.checkout(frontier1)
    })
    expect(result.current.doc.title).toBe("First Edit")

    // Return to latest
    act(() => {
      result.current.handle.loroDoc.checkoutToLatest()
    })

    // Should show the latest state
    expect(result.current.doc.title).toBe("Latest Edit")
  })

  it("should re-render with selector when document is checked out", () => {
    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result } = renderHook(
      () => {
        const handle = useHandle(documentId, testSchema)
        const title = useDoc(handle, d => d.title)
        return { handle, title }
      },
      { wrapper: RepoWrapper },
    )

    // Make changes
    act(() => {
      change(result.current.handle.doc, d => {
        d.title.delete(0, d.title.length)
        d.title.insert(0, "Version 1")
      })
    })
    const frontier1 = result.current.handle.loroDoc.frontiers()

    act(() => {
      change(result.current.handle.doc, d => {
        d.title.delete(0, d.title.length)
        d.title.insert(0, "Version 2")
      })
    })
    expect(result.current.title).toBe("Version 2")

    // Checkout to historical state
    act(() => {
      result.current.handle.loroDoc.checkout(frontier1)
    })

    // Selector should return the historical value
    expect(result.current.title).toBe("Version 1")
  })

  it("should have different cache keys for different frontiers with same opCount", () => {
    // This test verifies that the version key includes frontiers, not just opCount.
    // Without frontiers in the key, checkout between two states with the same opCount
    // would not trigger a re-render because the cache key would be identical.
    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const renderCounts = { count: 0 }

    const { result } = renderHook(
      () => {
        const handle = useHandle(documentId, testSchema)
        const doc = useDoc(handle)
        renderCounts.count++
        return { handle, doc }
      },
      { wrapper: RepoWrapper },
    )

    const initialRenderCount = renderCounts.count

    // Make first change
    act(() => {
      change(result.current.handle.doc, d => {
        d.title.delete(0, d.title.length)
        d.title.insert(0, "State A")
      })
    })
    const frontierA = result.current.handle.loroDoc.frontiers()
    const renderCountAfterA = renderCounts.count

    // Make second change
    act(() => {
      change(result.current.handle.doc, d => {
        d.title.delete(0, d.title.length)
        d.title.insert(0, "State B")
      })
    })
    const frontierB = result.current.handle.loroDoc.frontiers()
    const renderCountAfterB = renderCounts.count

    // Verify we rendered after each change
    expect(renderCountAfterA).toBeGreaterThan(initialRenderCount)
    expect(renderCountAfterB).toBeGreaterThan(renderCountAfterA)

    // Now checkout to A - opCount stays the same, but frontiers change
    act(() => {
      result.current.handle.loroDoc.checkout(frontierA)
    })
    const renderCountAfterCheckoutA = renderCounts.count

    // Should have re-rendered because frontiers changed
    expect(renderCountAfterCheckoutA).toBeGreaterThan(renderCountAfterB)
    expect(result.current.doc.title).toBe("State A")

    // Checkout to B - opCount still the same, frontiers change again
    act(() => {
      result.current.handle.loroDoc.checkout(frontierB)
    })
    const renderCountAfterCheckoutB = renderCounts.count

    // Should have re-rendered again
    expect(renderCountAfterCheckoutB).toBeGreaterThan(renderCountAfterCheckoutA)
    expect(result.current.doc.title).toBe("State B")
  })
})
