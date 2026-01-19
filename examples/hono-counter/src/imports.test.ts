import { change, Shape } from "@loro-extended/change"
import { Repo } from "@loro-extended/repo"
import { describe, expect, it } from "vitest"

describe("hono-counter imports", () => {
  it("imports Shape from @loro-extended/change", () => {
    expect(Shape).toBeDefined()
  })

  it("imports change from @loro-extended/change", () => {
    expect(change).toBeDefined()
    expect(typeof change).toBe("function")
  })

  it("imports Repo from @loro-extended/repo", () => {
    expect(Repo).toBeDefined()
    expect(typeof Repo).toBe("function")
  })
})
