import { renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { createRepoWrapper, createTestDocumentId } from "../test-utils.js"
import { useSimpleDocument } from "./use-simple-document.js"

describe("useSimpleDocument", () => {
  it("should return the expected tuple structure", () => {
    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result } = renderHook(() => useSimpleDocument(documentId), {
      wrapper: RepoWrapper,
    })

    expect(Array.isArray(result.current)).toBe(true)
    expect(result.current).toHaveLength(3)

    const [doc, changeDoc, handle] = result.current

    // With the new synchronous API, doc and handle are immediately available
    expect(doc).not.toBeNull() // Doc is immediately available
    expect(typeof changeDoc).toBe("function")
    expect(handle).not.toBeNull() // Handle is immediately available
  })

  it("should compose useSimpleLoroDocState and useSimpleLoroDocChanger correctly", () => {
    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result } = renderHook(() => useSimpleDocument(documentId), {
      wrapper: RepoWrapper,
    })

    const [doc, changeDoc, handle] = result.current

    // With the new synchronous API, handle is immediately available
    expect(handle).not.toBeNull()
    expect(doc).not.toBeNull()

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
      () => useSimpleDocument(documentId),
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
      ({ docId }) => useSimpleDocument(docId),
      {
        initialProps: { docId: documentId1 },
        wrapper: RepoWrapper,
      },
    )

    const [doc1, changeDoc1, handle1] = result.current

    rerender({ docId: documentId2 })

    const [doc2, changeDoc2, handle2] = result.current

    // With the new synchronous API, docs and handles are immediately available
    expect(doc1).not.toBeNull()
    expect(doc2).not.toBeNull()
    expect(handle1).not.toBeNull()
    expect(handle2).not.toBeNull()

    // They should be different instances
    expect(doc1).not.toBe(doc2)
    expect(handle1).not.toBe(handle2)

    // Change functions should be functions
    expect(typeof changeDoc1).toBe("function")
    expect(typeof changeDoc2).toBe("function")
  })

  it("should work with TypeScript interface types", () => {
    interface TodoDoc {
      title: string
      todos: Array<{ id: string; text: string; completed: boolean }>
    }

    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result } = renderHook(() => useSimpleDocument(documentId), {
      wrapper: RepoWrapper,
    })

    const [doc, changeDoc, handle] = result.current

    // Type assertions to verify TypeScript compatibility
    expect(doc).not.toBeNull() // Doc is immediately available
    expect(typeof changeDoc).toBe("function")
    expect(handle).not.toBeNull() // Handle is immediately available

    // Users can cast the result when using TypeScript
    const data = doc?.toJSON() as TodoDoc
    expect(typeof data).toBe("object")
  })
})
