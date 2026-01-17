import { Shape } from "@loro-extended/change"
import { act, renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { useEphemeral, useHandle } from "../index.js"
import { createRepoWrapper, createTestDocumentId } from "../test-utils.js"

// Document schema
const DocSchema = Shape.doc({
  title: Shape.text().placeholder("Test Document"),
})

// Presence schema
const PresenceSchema = Shape.plain.object({
  cursor: Shape.plain.object({
    x: Shape.plain.number(),
    y: Shape.plain.number(),
  }),
  name: Shape.plain.string().placeholder("Anonymous"),
  status: Shape.plain.string().placeholder("offline"),
})

describe("useEphemeral (presence)", () => {
  it("should provide typed self and peers", async () => {
    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result } = renderHook(
      () => {
        const handle = useHandle(documentId, DocSchema, {
          presence: PresenceSchema,
        })
        return useEphemeral(handle.presence)
      },
      {
        wrapper: RepoWrapper,
      },
    )

    // New API: self is undefined until set
    expect(result.current.self).toBeUndefined()
    expect(result.current.peers).toBeInstanceOf(Map)
    expect(result.current.peers.size).toBe(0)
  })

  it("should update self state via handle.presence.setSelf", async () => {
    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result } = renderHook(
      () => {
        const handle = useHandle(documentId, DocSchema, {
          presence: PresenceSchema,
        })
        const presence = useEphemeral(handle.presence)
        return { handle, presence }
      },
      {
        wrapper: RepoWrapper,
      },
    )

    act(() => {
      result.current.handle.presence.setSelf({
        cursor: { x: 10, y: 20 },
        name: "Anonymous",
        status: "offline",
      })
    })

    await waitFor(() => {
      expect(result.current.presence.self?.cursor).toEqual({ x: 10, y: 20 })
      expect(result.current.presence.self?.name).toBe("Anonymous")
    })
  })

  it("should handle full updates", async () => {
    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result } = renderHook(
      () => {
        const handle = useHandle(documentId, DocSchema, {
          presence: PresenceSchema,
        })
        const presence = useEphemeral(handle.presence)
        return { handle, presence }
      },
      {
        wrapper: RepoWrapper,
      },
    )

    act(() => {
      result.current.handle.presence.setSelf({
        cursor: { x: 0, y: 0 },
        name: "Alice",
        status: "offline",
      })
    })

    await waitFor(() => {
      expect(result.current.presence.self?.name).toBe("Alice")
    })

    act(() => {
      result.current.handle.presence.setSelf({
        cursor: { x: 0, y: 0 },
        name: "Alice",
        status: "online",
      })
    })

    await waitFor(() => {
      expect(result.current.presence.self?.name).toBe("Alice")
      expect(result.current.presence.self?.status).toBe("online")
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

    const { result } = renderHook(
      () => {
        const handle = useHandle(documentId, DocSchema, {
          presence: UnionSchema,
        })
        return useEphemeral(handle.presence)
      },
      {
        wrapper: RepoWrapper,
      },
    )

    // New API: self is undefined until set
    expect(result.current.self).toBeUndefined()
    expect(result.current.peers).toBeInstanceOf(Map)
  })
})
