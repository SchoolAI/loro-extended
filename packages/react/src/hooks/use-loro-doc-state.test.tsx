import { LoroShape } from "@loro-extended/change"
import { renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { createRepoWrapper, createTestDocumentId } from "../test-utils.js"
import { useLoroDocState } from "./use-loro-doc-state.js"

// Test schema and empty state - using only Loro containers for simplicity
const testSchema = LoroShape.doc({
  title: LoroShape.text(),
  count: LoroShape.counter(),
})

const testEmptyState = {
  title: "Test Document",
  count: 0,
}

describe("useLoroDocState", () => {
  it("should initialize with loading state", () => {
    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result } = renderHook(() => useLoroDocState(documentId, testSchema, testEmptyState), {
      wrapper: RepoWrapper,
    })

    expect(result.current.doc).toEqual(testEmptyState) // Always defined due to empty state
    expect(result.current.handle).toBeNull()
  })

  it("should eventually get a handle from repo", async () => {
    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result } = renderHook(() => useLoroDocState(documentId, testSchema, testEmptyState), {
      wrapper: RepoWrapper,
    })

    // Wait for the repo to create a handle
    await waitFor(
      () => {
        expect(result.current.handle).not.toBeNull()
      },
      { timeout: 2000 },
    )

    expect(result.current.handle).toBeTruthy()
  })

  it("should return undefined doc when not ready", () => {
    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result } = renderHook(() => useLoroDocState(documentId, testSchema, testEmptyState), {
      wrapper: RepoWrapper,
    })

    // Should show empty state even when handle is not ready
    expect(result.current.doc).toEqual(testEmptyState)
  })
})
