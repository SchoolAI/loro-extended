import { Shape } from "@loro-extended/change"
import { act, renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { createRepoWrapper, createTestDocumentId } from "../test-utils.js"
import { usePresence, useUntypedPresence } from "./use-presence.js"

describe("useUntypedPresence", () => {
  it("should provide self and all", async () => {
    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result } = renderHook(() => useUntypedPresence(documentId), {
      wrapper: RepoWrapper,
    })

    expect(result.current.self).toEqual({})
    expect(result.current.all).toEqual({})
    expect(typeof result.current.setSelf).toBe("function")
  })

  it("should update self state", async () => {
    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result } = renderHook(() => useUntypedPresence(documentId), {
      wrapper: RepoWrapper,
    })

    act(() => {
      result.current.setSelf({ cursor: { x: 10, y: 20 } })
    })

    await waitFor(() => {
      expect(result.current.self).toEqual({ cursor: { x: 10, y: 20 } })
    })

    // All should also contain self
    // We need to know the peerId to check the key, but we can check values
    expect(Object.values(result.current.all)).toContainEqual({
      cursor: { x: 10, y: 20 },
    })
  })

  it("should handle partial updates", async () => {
    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result } = renderHook(() => useUntypedPresence(documentId), {
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
        const selected = useUntypedPresence(
          documentId,
          state => state.self.cursor,
        )
        const full = useUntypedPresence(documentId)
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

describe("usePresence (typed)", () => {
  const PresenceSchema = Shape.plain.object({
    cursor: Shape.plain.object({
      x: Shape.plain.number(),
      y: Shape.plain.number(),
    }),
    name: Shape.plain.string(),
    status: Shape.plain.string(),
  })

  const EmptyPresence = {
    cursor: { x: 0, y: 0 },
    name: "Anonymous",
    status: "offline",
  }

  it("should provide typed self and all", async () => {
    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result } = renderHook(
      () => usePresence(documentId, PresenceSchema, EmptyPresence),
      {
        wrapper: RepoWrapper,
      },
    )

    expect(result.current.self).toEqual(EmptyPresence)
    expect(result.current.all).toEqual({})
    expect(typeof result.current.setSelf).toBe("function")
  })

  it("should update typed self state", async () => {
    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result } = renderHook(
      () => usePresence(documentId, PresenceSchema, EmptyPresence),
      {
        wrapper: RepoWrapper,
      },
    )

    act(() => {
      result.current.setSelf({ cursor: { x: 10, y: 20 } })
    })

    await waitFor(() => {
      expect(result.current.self.cursor).toEqual({ x: 10, y: 20 })
      // Other fields should remain default
      expect(result.current.self.name).toBe("Anonymous")
    })
  })

  it("should support typed selectors", async () => {
    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result } = renderHook(
      () => {
        const cursor = usePresence(
          documentId,
          PresenceSchema,
          EmptyPresence,
          state => state.self.cursor,
        )
        const full = usePresence(documentId, PresenceSchema, EmptyPresence)
        return { cursor, full }
      },
      {
        wrapper: RepoWrapper,
      },
    )

    expect(result.current.cursor).toEqual({ x: 0, y: 0 })

    act(() => {
      result.current.full.setSelf({ cursor: { x: 100, y: 200 } })
    })

    await waitFor(() => {
      expect(result.current.cursor).toEqual({ x: 100, y: 200 })
    })
  })
})
