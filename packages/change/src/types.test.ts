import { describe, expectTypeOf, it } from "vitest"
import { Shape } from "./shape.js"
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
})
