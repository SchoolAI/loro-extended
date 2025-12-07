import { Shape } from "@loro-extended/change"
import { renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { createRepoWrapper, createTestDocumentId } from "../test-utils.js"
import { useDocument } from "../index.js"

// Test schema with placeholder values
const testSchema = Shape.doc({
  title: Shape.text().placeholder("Test Document"),
  count: Shape.counter(),
})

// Expected placeholder values (derived from schema)
const expectedPlaceholder = {
  title: "Test Document",
  count: 0,
}

describe("useDocument", () => {
  it("should return the expected tuple structure", () => {
    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result } = renderHook(() => useDocument(documentId, testSchema), {
      wrapper: RepoWrapper,
    })

    expect(Array.isArray(result.current)).toBe(true)
    expect(result.current).toHaveLength(3)

    const [doc, changeDoc, handle] = result.current

    // Check properties individually since doc is a Proxy
    expect(doc.title).toBe(expectedPlaceholder.title)
    expect(doc.count).toBe(expectedPlaceholder.count)
    expect(typeof changeDoc).toBe("function")
    expect(handle).not.toBeNull() // Handle is immediately available with new API
  })

  it("should support selector for granular access", () => {
    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result } = renderHook(
      () => useDocument(documentId, testSchema, doc => doc.title),
      {
        wrapper: RepoWrapper,
      },
    )

    const [title] = result.current
    expect(title).toBe(expectedPlaceholder.title)
  })

  it("should support selector for plain object return", () => {
    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result } = renderHook(
      () =>
        useDocument(documentId, testSchema, doc => ({
          title: doc.title,
          count: doc.count,
        })),
      {
        wrapper: RepoWrapper,
      },
    )

    const [doc] = result.current

    // With selector returning plain object, toEqual works
    expect(doc).toEqual(expectedPlaceholder)
  })

  it("should compose useLoroDocState and useLoroDocChanger correctly", () => {
    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result } = renderHook(() => useDocument(documentId, testSchema), {
      wrapper: RepoWrapper,
    })

    const [doc, changeDoc, handle] = result.current

    // With the new synchronous API, handle is immediately available
    expect(handle).not.toBeNull()
    expect(doc.title).toBe(expectedPlaceholder.title)
    expect(doc.count).toBe(expectedPlaceholder.count)

    // Test that changeDoc works correctly
    const mockChangeFn = vi.fn()
    changeDoc(mockChangeFn)

    // The change function should have been called
    expect(mockChangeFn).toHaveBeenCalled()
  })

  it("should maintain stable function references", () => {
    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result, rerender } = renderHook(
      () => useDocument(documentId, testSchema),
      {
        wrapper: RepoWrapper,
      },
    )

    const [, firstChangeDoc] = result.current

    rerender()

    const [, secondChangeDoc] = result.current

    expect(firstChangeDoc).toBe(secondChangeDoc)
  })

  it("should work with different document IDs", () => {
    const documentId1 = createTestDocumentId()
    const documentId2 = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result, rerender } = renderHook(
      ({ docId }) => useDocument(docId, testSchema),
      {
        initialProps: { docId: documentId1 },
        wrapper: RepoWrapper,
      },
    )

    const [doc1, changeDoc1, handle1] = result.current

    rerender({ docId: documentId2 })

    const [doc2, changeDoc2, handle2] = result.current

    // Both docs should show placeholder, handles are immediately available
    expect(doc1.title).toBe(expectedPlaceholder.title)
    expect(doc2.title).toBe(expectedPlaceholder.title)
    expect(handle1).not.toBeNull()
    expect(handle2).not.toBeNull()

    // They should be different instances
    expect(handle1).not.toBe(handle2)

    // Change functions should be functions
    expect(typeof changeDoc1).toBe("function")
    expect(typeof changeDoc2).toBe("function")
  })
})
