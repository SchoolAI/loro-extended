import { renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { createRepoWrapper, createTestDocumentId } from "../test-utils.js"
import { useLoroDocState } from "./use-loro-doc-state.js"

describe("useLoroDocState", () => {
  it("should initialize with loading state", () => {
    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result } = renderHook(() => useLoroDocState(documentId), {
      wrapper: RepoWrapper,
    })

    expect(result.current.doc).toBeUndefined()
    expect(result.current.handle).toBeNull()
  })

  it("should eventually get a handle from repo", async () => {
    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result } = renderHook(() => useLoroDocState(documentId), {
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

    const { result } = renderHook(() => useLoroDocState(documentId), {
      wrapper: RepoWrapper,
    })

    // Initially should be undefined since handle is not ready
    expect(result.current.doc).toBeUndefined()
  })
})
