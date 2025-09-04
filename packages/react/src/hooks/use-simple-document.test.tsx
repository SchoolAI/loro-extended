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

    expect(doc).toBeNull() // Initially null (no empty state overlay)
    expect(typeof changeDoc).toBe("function")
    expect(handle).toBeNull() // Initially null
  })

  it("should compose useSimpleLoroDocState and useSimpleLoroDocChanger correctly", () => {
    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result } = renderHook(() => useSimpleDocument(documentId), {
      wrapper: RepoWrapper,
    })

    const [, changeDoc] = result.current

    // Test that changeDoc warns when handle is null (from useSimpleLoroDocChanger)
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

    const mockChangeFn = vi.fn()
    changeDoc(mockChangeFn)

    expect(consoleSpy).toHaveBeenCalledWith(
      "doc handle not available for change",
    )

    consoleSpy.mockRestore()
  })

  it("should maintain stable function references", () => {
    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result, rerender } = renderHook(() => useSimpleDocument(documentId), {
      wrapper: RepoWrapper,
    })

    const [, firstChangeDoc] = result.current

    rerender()

    const [, secondChangeDoc] = result.current

    expect(firstChangeDoc).toBe(secondChangeDoc)
  })

  it("should work with different document IDs", () => {
    const documentId1 = createTestDocumentId()
    const documentId2 = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result, rerender } = renderHook(({ docId }) => useSimpleDocument(docId), {
      initialProps: { docId: documentId1 },
      wrapper: RepoWrapper,
    })

    const [doc1, changeDoc1, handle1] = result.current

    rerender({ docId: documentId2 })

    const [doc2, changeDoc2, handle2] = result.current

    // Both docs should be null initially, handles initially null
    expect(doc1).toBeNull()
    expect(doc2).toBeNull()
    expect(handle1).toBeNull()
    expect(handle2).toBeNull()

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
    expect(doc).toBeNull()
    expect(typeof changeDoc).toBe("function")
    expect(handle).toBeNull()

    // Users can cast the result when using TypeScript
    if (doc) {
      const data = doc.toJSON() as TodoDoc
      expect(typeof data).toBe("object")
    }
  })
})