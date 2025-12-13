import { describe, expect, expectTypeOf, it } from "vitest"
import { change } from "./functional-helpers.js"
import type { ContainerShape, ValueShape } from "./shape.js"
import { Shape } from "./shape.js"
import { createTypedDoc } from "./typed-doc.js"
import type { Infer } from "./types.js"

describe("Infer type helper", () => {
  it("infers DocShape plain type", () => {
    const schema = Shape.doc({
      title: Shape.text(),
      count: Shape.counter(),
    })

    type Result = Infer<typeof schema>
    expectTypeOf<Result>().toEqualTypeOf<{ title: string; count: number }>()
  })

  it("infers ContainerShape plain type (list)", () => {
    const schema = Shape.list(Shape.plain.string())

    type Result = Infer<typeof schema>
    expectTypeOf<Result>().toEqualTypeOf<string[]>()
  })

  it("infers ValueShape plain type (object)", () => {
    const schema = Shape.plain.object({
      name: Shape.plain.string(),
      age: Shape.plain.number(),
    })

    type Result = Infer<typeof schema>
    expectTypeOf<Result>().toEqualTypeOf<{ name: string; age: number }>()
  })

  it("infers nested shapes", () => {
    const schema = Shape.doc({
      users: Shape.list(
        Shape.map({
          id: Shape.plain.string(),
          profile: Shape.record(
            Shape.plain.object({
              bio: Shape.plain.string(),
            }),
          ),
        }),
      ),
    })

    type Result = Infer<typeof schema>
    expectTypeOf<Result>().toEqualTypeOf<{
      users: {
        id: string
        profile: Record<string, { bio: string }>
      }[]
    }>()
  })

  it("infers discriminated union plain type", () => {
    const SessionStatusSchema = Shape.plain.discriminatedUnion("status", {
      not_started: Shape.plain.object({
        status: Shape.plain.string("not_started"),
      }),
      lobby: Shape.plain.object({
        status: Shape.plain.string("lobby"),
        lobbyPhase: Shape.plain.string("preparing", "typing"),
      }),
      active: Shape.plain.object({
        status: Shape.plain.string("active"),
        mode: Shape.plain.string("solo", "group"),
      }),
      paused: Shape.plain.object({
        status: Shape.plain.string("paused"),
        previousStatus: Shape.plain.string("lobby", "active"),
        previousMode: Shape.plain.string("solo", "group"),
        reason: Shape.plain.string(
          "no_students",
          "teacher_paused",
          "assignment_empty",
        ),
      }),
      ended: Shape.plain.object({
        status: Shape.plain.string<"ended">("ended"),
      }),
    })

    type Result = Infer<typeof SessionStatusSchema>

    // The result should be a union of all variant types
    type Expected =
      | { status: "not_started" }
      | { status: "lobby"; lobbyPhase: "preparing" | "typing" }
      | { status: "active"; mode: "solo" | "group" }
      | {
          status: "paused"
          previousStatus: "lobby" | "active"
          previousMode: "solo" | "group"
          reason: "no_students" | "teacher_paused" | "assignment_empty"
        }
      | { status: "ended" }

    expectTypeOf<Result>().toEqualTypeOf<Expected>()
  })

  it("infers discriminated union inside a map container", () => {
    const SessionStatusSchema = Shape.plain.discriminatedUnion("status", {
      not_started: Shape.plain.object({
        status: Shape.plain.string("not_started"),
      }),
      active: Shape.plain.object({
        status: Shape.plain.string("active"),
        mode: Shape.plain.string("solo", "group"),
      }),
    })

    const SessionMetadataSchema = Shape.map({
      sessionStartedAt: Shape.plain.number(),
      sessionStatus: SessionStatusSchema,
    })

    type Result = Infer<typeof SessionMetadataSchema>

    type Expected = {
      sessionStartedAt: number
      sessionStatus:
        | { status: "not_started" }
        | { status: "active"; mode: "solo" | "group" }
    }

    expectTypeOf<Result>().toEqualTypeOf<Expected>()
  })

  it("infers discriminated union inside a doc", () => {
    const SessionStatusSchema = Shape.plain.discriminatedUnion("status", {
      not_started: Shape.plain.object({
        status: Shape.plain.string("not_started"),
      }),
      active: Shape.plain.object({
        status: Shape.plain.string("active"),
      }),
    })

    const DocSchema = Shape.doc({
      metadata: Shape.map({
        sessionStartedAt: Shape.plain.number(),
        sessionStatus: SessionStatusSchema,
      }),
    })

    type Result = Infer<typeof DocSchema>

    type Expected = {
      metadata: {
        sessionStartedAt: number
        sessionStatus: { status: "not_started" } | { status: "active" }
      }
    }

    expectTypeOf<Result>().toEqualTypeOf<Expected>()
  })

  it("infers discriminated union type correctly when used with generic constraint", () => {
    // This test verifies the fix for usePresence type inference
    // The issue was that DiscriminatedUnionValueShape<any, any> in the ValueShape union
    // caused type information to be lost when inferring through generic constraints
    const ClientPresenceShape = Shape.plain.object({
      type: Shape.plain.string("client"),
      name: Shape.plain.string(),
    })
    const ServerPresenceShape = Shape.plain.object({
      type: Shape.plain.string("server"),
      tick: Shape.plain.number(),
    })
    const GamePresenceSchema = Shape.plain.discriminatedUnion("type", {
      client: ClientPresenceShape,
      server: ServerPresenceShape,
    })

    // Simulate the constraint used in usePresence: <S extends ContainerShape | ValueShape>
    type TestInfer<S extends ContainerShape | ValueShape> = Infer<S>

    type Result = TestInfer<typeof GamePresenceSchema>

    type Expected =
      | { type: "client"; name: string }
      | { type: "server"; tick: number }

    expectTypeOf<Result>().toEqualTypeOf<Expected>()
  })
})

describe("Mutable type helper", () => {
  it("Object.values returns values from the record", () => {
    const ParticipantSchema = Shape.plain.object({
      id: Shape.plain.string(),
      name: Shape.plain.string(),
    })

    const GroupSessionSchema = Shape.doc({
      participants: Shape.record(ParticipantSchema),
    })

    const doc = createTypedDoc(GroupSessionSchema)

    change(doc, (root: any) => {
      root.participants.set("p1", { id: "1", name: "Alice" })
      root.participants.set("p2", { id: "2", name: "Bob" })
    })

    const participants = doc.participants

    // Object.values returns the values from the record
    const values = Object.values(participants)

    // Runtime check - values are the plain objects
    expect(values).toHaveLength(2)
    expect(values.map((p: any) => p.name).sort()).toEqual(["Alice", "Bob"])
  })

  it("toJSON is callable on Records", () => {
    const ParticipantSchema = Shape.plain.object({
      id: Shape.plain.string(),
      name: Shape.plain.string(),
    })

    const GroupSessionSchema = Shape.doc({
      participants: Shape.record(ParticipantSchema),
    })

    const doc = createTypedDoc(GroupSessionSchema)

    change(doc, (root: any) => {
      root.participants.set("p1", { id: "1", name: "Alice" })
    })

    const participants = doc.participants

    // toJSON should be callable
    const json = participants.toJSON()

    // Type check: toJSON returns the plain Record type
    expectTypeOf(json).toEqualTypeOf<
      Record<string, { id: string; name: string }>
    >()

    // Runtime check
    expect(json).toEqual({ p1: { id: "1", name: "Alice" } })
  })

  it("toJSON is callable on Maps", () => {
    const MetaSchema = Shape.map({
      title: Shape.plain.string(),
      count: Shape.plain.number(),
    })

    const DocSchema = Shape.doc({
      meta: MetaSchema,
    })

    const doc = createTypedDoc(DocSchema)

    change(doc, (root: any) => {
      root.meta.title = "Test"
      root.meta.count = 42
    })

    const meta = doc.meta

    // toJSON should be callable
    const json = meta.toJSON()

    // Type check
    expectTypeOf(json).toEqualTypeOf<{ title: string; count: number }>()

    // Runtime check
    expect(json).toEqual({ title: "Test", count: 42 })
  })
})
