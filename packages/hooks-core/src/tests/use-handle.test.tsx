import { Shape } from "@loro-extended/change"
import { renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import {
  createRepoWrapper,
  createTestDocumentId,
  useHandle,
} from "../test-utils"

const testSchema = Shape.doc({
  title: Shape.text().placeholder("Test Document"),
  count: Shape.counter(),
})

describe("useHandle", () => {
  it("should return a typed handle synchronously", () => {
    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result } = renderHook(() => useHandle(documentId, testSchema), {
      wrapper: RepoWrapper,
    })

    const handle = result.current
    expect(handle).not.toBeNull()
    expect(handle.docId).toBe(documentId)
  })

  it("should return stable handle reference across re-renders", () => {
    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result, rerender } = renderHook(
      () => useHandle(documentId, testSchema),
      { wrapper: RepoWrapper },
    )

    const firstHandle = result.current
    rerender()
    const secondHandle = result.current

    expect(firstHandle).toBe(secondHandle)
  })
})
