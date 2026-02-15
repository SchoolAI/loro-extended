import { describe, expect, it } from "vitest"
import {
  change,
  ext,
  loro,
  RepoContext,
  RepoProvider,
  Shape,
  useCollaborativeText,
  useDocument,
  useEphemeral,
  useLens,
  usePlaceholder,
  useRepo,
  useUndoManager,
  useValue,
} from "./index.js"

describe("@loro-extended/hono exports", () => {
  it("exports RepoProvider component", () => {
    expect(RepoProvider).toBeDefined()
    expect(typeof RepoProvider).toBe("function")
  })

  it("exports RepoContext", () => {
    expect(RepoContext).toBeDefined()
  })

  it("exports useRepo hook", () => {
    expect(useRepo).toBeDefined()
    expect(typeof useRepo).toBe("function")
  })

  it("exports useDocument hook", () => {
    expect(useDocument).toBeDefined()
    expect(typeof useDocument).toBe("function")
  })

  it("exports useValue hook", () => {
    expect(useValue).toBeDefined()
    expect(typeof useValue).toBe("function")
  })

  it("exports usePlaceholder hook", () => {
    expect(usePlaceholder).toBeDefined()
    expect(typeof usePlaceholder).toBe("function")
  })

  it("exports useEphemeral hook", () => {
    expect(useEphemeral).toBeDefined()
    expect(typeof useEphemeral).toBe("function")
  })

  it("exports useLens hook", () => {
    expect(useLens).toBeDefined()
    expect(typeof useLens).toBe("function")
  })

  it("exports useCollaborativeText hook", () => {
    expect(useCollaborativeText).toBeDefined()
    expect(typeof useCollaborativeText).toBe("function")
  })

  it("exports useUndoManager hook", () => {
    expect(useUndoManager).toBeDefined()
    expect(typeof useUndoManager).toBe("function")
  })

  it("exports Shape from @loro-extended/change", () => {
    expect(Shape).toBeDefined()
  })

  it("exports change from @loro-extended/change", () => {
    expect(change).toBeDefined()
    expect(typeof change).toBe("function")
  })

  it("exports loro and ext from @loro-extended/change", () => {
    expect(loro).toBeDefined()
    expect(typeof loro).toBe("function")
    expect(ext).toBeDefined()
    expect(typeof ext).toBe("function")
  })
})
