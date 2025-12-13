import { Shape } from "@loro-extended/change"
import { act, renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { useHandle, usePresence } from "../index.js"
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

// Expected placeholder values derived from schema
const expectedPlaceholder = {
  cursor: { x: 0, y: 0 },
  name: "Anonymous",
  status: "offline",
}

describe("usePresence", () => {
  it("should provide typed self and peers", async () => {
    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result } = renderHook(
      () => {
        const handle = useHandle(documentId, DocSchema, PresenceSchema)
        return usePresence(handle)
      },
      {
        wrapper: RepoWrapper,
      },
    )

    expect(result.current.self).toEqual(expectedPlaceholder)
    expect(result.current.peers).toBeInstanceOf(Map)
    expect(result.current.peers.size).toBe(0)
  })

  it("should update self state via handle.presence.set", async () => {
    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result } = renderHook(
      () => {
        const handle = useHandle(documentId, DocSchema, PresenceSchema)
        const presence = usePresence(handle)
        return { handle, presence }
      },
      {
        wrapper: RepoWrapper,
      },
    )

    act(() => {
      result.current.handle.presence.set({ cursor: { x: 10, y: 20 } })
    })

    await waitFor(() => {
      expect(result.current.presence.self.cursor).toEqual({ x: 10, y: 20 })
      // Other fields should remain default
      expect(result.current.presence.self.name).toBe("Anonymous")
    })
  })

  it("should handle partial updates", async () => {
    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result } = renderHook(
      () => {
        const handle = useHandle(documentId, DocSchema, PresenceSchema)
        const presence = usePresence(handle)
        return { handle, presence }
      },
      {
        wrapper: RepoWrapper,
      },
    )

    act(() => {
      result.current.handle.presence.set({ name: "Alice" })
    })

    await waitFor(() => {
      expect(result.current.presence.self.name).toBe("Alice")
    })

    act(() => {
      result.current.handle.presence.set({ status: "online" })
    })

    await waitFor(() => {
      expect(result.current.presence.self.name).toBe("Alice")
      expect(result.current.presence.self.status).toBe("online")
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
        const handle = useHandle(documentId, DocSchema, UnionSchema)
        return usePresence(handle)
      },
      {
        wrapper: RepoWrapper,
      },
    )

    const presence = result.current.self
    if (presence.type === "client") {
      expect(presence.name).toBe("test")
    } else {
      // This branch should be reachable type-wise
      expect(presence.tick).toBeUndefined()
    }
  })
})
