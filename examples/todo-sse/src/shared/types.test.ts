import { describe, expect, it } from "vitest"
import { TodoSchema } from "./types.js"

describe("todo-sse shared types", () => {
  it("defines TodoSchema", () => {
    expect(TodoSchema).toBeDefined()
  })
})
