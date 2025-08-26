import { renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { createRepoWrapper, createTestDocumentId } from "../test-utils.js"
import { useDocument } from "./use-document.js"

describe("useDocument", () => {
  it("should return the expected tuple structure", () => {
    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result } = renderHook(() => useDocument(documentId), {
      wrapper: RepoWrapper,
    })

    expect(Array.isArray(result.current)).toBe(true)
    expect(result.current).toHaveLength(3)

    const [doc, changeDoc, handle] = result.current

    expect(doc).toBeUndefined() // Initially undefined
    expect(typeof changeDoc).toBe("function")
    expect(handle).toBeNull() // Initially null
  })

  it("should compose useLoroDocState and useLoroDocChanger correctly", () => {
    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result } = renderHook(() => useDocument(documentId), {
      wrapper: RepoWrapper,
    })

    const [, changeDoc] = result.current

    // Test that changeDoc warns when handle is null (from useLoroDocChanger)
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

    const { result, rerender } = renderHook(() => useDocument(documentId), {
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

    const { result, rerender } = renderHook(({ docId }) => useDocument(docId), {
      initialProps: { docId: documentId1 },
      wrapper: RepoWrapper,
    })

    const [doc1, changeDoc1, handle1] = result.current

    rerender({ docId: documentId2 })

    const [doc2, changeDoc2, handle2] = result.current

    // Initially both docs should be undefined and handles null
    expect(doc1).toBeUndefined()
    expect(doc2).toBeUndefined()
    expect(handle1).toBeNull()
    expect(handle2).toBeNull()

    // Change functions should be functions
    expect(typeof changeDoc1).toBe("function")
    expect(typeof changeDoc2).toBe("function")
  })
})
