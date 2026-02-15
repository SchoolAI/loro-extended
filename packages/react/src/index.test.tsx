import { describe, expect, it } from "vitest"
import {
  CursorRegistry,
  CursorRegistryContext,
  change,
  ext,
  hasSync,
  loro,
  RepoContext,
  RepoProvider,
  Shape,
  sync,
  useCollaborativeText,
  useCursorRegistry,
  useDocument,
  useEphemeral,
  useLens,
  usePlaceholder,
  useRepo,
  useUndoManager,
  useValue,
} from "./index.js"

describe("@loro-extended/react exports", () => {
  describe("Document API", () => {
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

    it("exports sync function from @loro-extended/repo", () => {
      expect(sync).toBeDefined()
      expect(typeof sync).toBe("function")
    })

    it("exports hasSync function from @loro-extended/repo", () => {
      expect(hasSync).toBeDefined()
      expect(typeof hasSync).toBe("function")
    })

    it("exports useLens hook", () => {
      expect(useLens).toBeDefined()
      expect(typeof useLens).toBe("function")
    })
  })

  describe("Core exports", () => {
    it("exports RepoProvider component", () => {
      expect(RepoProvider).toBeDefined()
      expect(typeof RepoProvider).toBe("function")
    })

    it("exports RepoContext", () => {
      expect(RepoContext).toBeDefined()
    })

    it("exports CursorRegistry class", () => {
      expect(CursorRegistry).toBeDefined()
      expect(typeof CursorRegistry).toBe("function")
    })

    it("exports CursorRegistryContext", () => {
      expect(CursorRegistryContext).toBeDefined()
    })

    it("exports useCursorRegistry hook", () => {
      expect(useCursorRegistry).toBeDefined()
      expect(typeof useCursorRegistry).toBe("function")
    })

    it("exports useRepo hook", () => {
      expect(useRepo).toBeDefined()
      expect(typeof useRepo).toBe("function")
    })

    it("exports useEphemeral hook", () => {
      expect(useEphemeral).toBeDefined()
      expect(typeof useEphemeral).toBe("function")
    })

    it("exports useCollaborativeText hook", () => {
      expect(useCollaborativeText).toBeDefined()
      expect(typeof useCollaborativeText).toBe("function")
    })

    it("exports useUndoManager hook", () => {
      expect(useUndoManager).toBeDefined()
      expect(typeof useUndoManager).toBe("function")
    })
  })

  describe("@loro-extended/change re-exports", () => {
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
})
