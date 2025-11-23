import { act, renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { createRepoWrapper, createTestDocumentId } from "../test-utils.js"
import { useEphemeral } from "./use-ephemeral.js"

describe("useEphemeral", () => {
  it("should provide self, peers, and others", async () => {
    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result } = renderHook(() => useEphemeral(documentId), {
      wrapper: RepoWrapper,
    })

    expect(result.current.self).toEqual({})
    expect(result.current.peers).toEqual({})
    expect(result.current.others).toEqual({})
    expect(typeof result.current.setSelf).toBe("function")
  })

  it("should update self state", async () => {
    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result } = renderHook(() => useEphemeral(documentId), {
      wrapper: RepoWrapper,
    })

    act(() => {
      result.current.setSelf({ cursor: { x: 10, y: 20 } })
    })

    await waitFor(() => {
      expect(result.current.self).toEqual({ cursor: { x: 10, y: 20 } })
    })
    
    // Peers should also contain self
    // We need to know the peerId to check the key, but we can check values
    expect(Object.values(result.current.peers)).toContainEqual({ cursor: { x: 10, y: 20 } })
  })

  it("should handle partial updates", async () => {
    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result } = renderHook(() => useEphemeral(documentId), {
      wrapper: RepoWrapper,
    })

    act(() => {
      result.current.setSelf({ name: "Alice" })
    })

    await waitFor(() => {
      expect(result.current.self).toEqual({ name: "Alice" })
    })

    act(() => {
      result.current.setSelf({ status: "online" })
    })

    await waitFor(() => {
      expect(result.current.self).toEqual({ name: "Alice", status: "online" })
    })
  })

  it("should support selectors", async () => {
    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result } = renderHook(
      () => {
        const selected = useEphemeral(documentId, state => state.self.cursor)
        const full = useEphemeral(documentId)
        return { selected, full }
      },
      {
        wrapper: RepoWrapper,
      },
    )

    // Initially undefined
    expect(result.current.selected).toBeUndefined()

    act(() => {
      result.current.full.setSelf({ cursor: { x: 100, y: 200 } })
    })

    await waitFor(() => {
      expect(result.current.selected).toEqual({ x: 100, y: 200 })
    })
  })
})