import { describe, expectTypeOf, it } from "vitest"
import { Shape } from "./shape.js"

describe("Discriminated Union Placeholder Issue", () => {
  it("should allow discriminated union with placeholder in a map", () => {
    const PauseReasonSchema = Shape.plain.string()
    const ActiveModeSchema = Shape.plain.string()

    const SessionPhaseSchema = Shape.plain
      .discriminatedUnion("phase", {
        "not-started": Shape.plain.object({
          phase: Shape.plain.string("not-started"),
        }),

        lobby: Shape.plain.object({
          phase: Shape.plain.string("lobby"),
        }),
        "lobby-paused": Shape.plain.object({
          phase: Shape.plain.string("lobby-paused"),
          reason: PauseReasonSchema,
        }),

        active: Shape.plain.object({
          phase: Shape.plain.string("active"),
          mode: ActiveModeSchema,
        }),
        "active-paused": Shape.plain.object({
          phase: Shape.plain.string("active-paused"),
          mode: ActiveModeSchema,
          reason: PauseReasonSchema,
        }),

        ended: Shape.plain.object({
          phase: Shape.plain.string("ended"),
        }),
      })
      .placeholder({ phase: "not-started" })

    const PhaseTransitionSchema = Shape.map({
      phase: SessionPhaseSchema,
    })

    expectTypeOf(PhaseTransitionSchema).not.toBeNever()
  })
})
