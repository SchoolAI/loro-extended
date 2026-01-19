import { Repo } from "@loro-extended/repo"
import { describe, expect, it } from "vitest"

describe("todo-minimal imports", () => {
  it("imports Repo from @loro-extended/repo", () => {
    expect(Repo).toBeDefined()
    expect(typeof Repo).toBe("function")
  })
})
