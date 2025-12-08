import { Shape } from "@loro-extended/change"
import { act, renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { usePresence, useUntypedPresence } from "../index.js"
import { createRepoWrapper, createTestDocumentId } from "../test-utils.js"

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

  it("should support functional updater for setSelf", async () => {
    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result } = renderHook(() => useUntypedPresence(documentId), {
      wrapper: RepoWrapper,
    })

    // Set initial state
    act(() => {
      result.current.setSelf({ count: 5 })
    })

    await waitFor(() => {
      expect(result.current.self).toEqual({ count: 5 })
    })

    // Use functional updater
    act(() => {
      result.current.setSelf(current => ({
        count: (current.count as number) + 1,
      }))
    })

    await waitFor(() => {
      expect(result.current.self).toEqual({ count: 6 })
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
  // Schema with placeholder annotations - no separate EmptyPresence needed
  const PresenceSchema = Shape.plain.object({
    cursor: Shape.plain.object({
      x: Shape.plain.number(),
      y: Shape.plain.number(),
    }),
    name: Shape.plain.string().placeholder("Anonymous"),
    status: Shape.plain.string().placeholder("offline"),
  })

  // Expected placeholder values derived from schema
  const expectedPlaceholder = {
    cursor: { x: 0, y: 0 },
    name: "Anonymous",
    status: "offline",
  }

  it("should provide typed self and all", async () => {
    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result } = renderHook(
      () => usePresence(documentId, PresenceSchema),
      {
        wrapper: RepoWrapper,
      },
    )

    expect(result.current.self).toEqual(expectedPlaceholder)
    expect(result.current.all).toEqual({})
    expect(typeof result.current.setSelf).toBe("function")
  })

  it("should update typed self state", async () => {
    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result } = renderHook(
      () => usePresence(documentId, PresenceSchema),
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

  it("should support functional updater for setSelf", async () => {
    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result } = renderHook(
      () => usePresence(documentId, PresenceSchema),
      {
        wrapper: RepoWrapper,
      },
    )

    // Set initial cursor position
    act(() => {
      result.current.setSelf({ cursor: { x: 10, y: 20 } })
    })

    await waitFor(() => {
      expect(result.current.self.cursor).toEqual({ x: 10, y: 20 })
    })

    // Use functional updater to increment x
    act(() => {
      result.current.setSelf(current => ({
        cursor: { x: current.cursor.x + 5, y: current.cursor.y },
      }))
    })

    await waitFor(() => {
      expect(result.current.self.cursor).toEqual({ x: 15, y: 20 })
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
          state => state.self.cursor,
        )
        const full = usePresence(documentId, PresenceSchema)
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

  it("should work with discriminated unions", () => {
    // Schema with placeholder on the discriminated union
    const ClientSchema = Shape.plain.object({
      type: Shape.plain.string("client"),
      name: Shape.plain.string().placeholder("test"),
    })
    const ServerSchema = Shape.plain.object({
      type: Shape.plain.string("server"),
      tick: Shape.plain.number(),
    })
    const UnionSchema = Shape.plain.discriminatedUnion("type", {
      client: ClientSchema,
      server: ServerSchema,
    })

    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result } = renderHook(() => usePresence(documentId, UnionSchema), {
      wrapper: RepoWrapper,
    })

    const presence = result.current.self
    if (presence.type === "client") {
      expect(presence.name).toBe("test")
    } else {
      // This branch should be reachable type-wise
      expect(presence.tick).toBeUndefined()
    }
  })
})
