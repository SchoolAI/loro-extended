import type { DocId, RepoParams, UntypedDocHandle } from "@loro-extended/repo"
import { InMemoryStorageAdapter } from "@loro-extended/repo"
import { type RenderOptions, render } from "@testing-library/react"
import type { ReactElement } from "react"
import { vi } from "vitest"
import { RepoProvider } from "./repo-context.js"

// Mock UntypedDocHandle for testing
// Note: This creates a partial mock - for full integration tests, use createRepoWrapper instead
export function createMockDocHandle(
  overrides: Partial<UntypedDocHandle> = {},
): Partial<UntypedDocHandle> {
  const mockHandle: Partial<UntypedDocHandle> = {
    docId: "mock-doc-id",
    peerId: "mock-peer-id",
    doc: {
      opCount: vi.fn().mockReturnValue(1),
      getMap: vi.fn().mockReturnValue(new Map()),
      subscribe: vi.fn().mockReturnValue(() => {}),
      commit: vi.fn(),
    } as any,
    batch: vi.fn().mockReturnThis(),
    readyStates: [],
    onReadyStateChange: vi.fn().mockReturnValue(() => {}),
    presence: {
      set: vi.fn(),
      get: vi.fn(),
      self: {},
      peers: new Map(),
      all: {},
      setRaw: vi.fn(),
      subscribe: vi.fn().mockReturnValue(() => {}),
    },
    ...overrides,
  }

  return mockHandle
}

// Create a test RepoParams
export function createTestRepoConfig(
  overrides: Partial<RepoParams> = {},
): RepoParams {
  return {
    adapters: [new InMemoryStorageAdapter()],
    identity: {
      name: `test-peer-${Math.random().toString(36).substr(2, 9)}`,
      type: "user",
    },
    ...overrides,
  }
}

// Custom render function with RepoProvider
interface CustomRenderOptions extends Omit<RenderOptions, "wrapper"> {
  repoConfig?: RepoParams
}

export function renderWithRepo(
  ui: ReactElement,
  {
    repoConfig = createTestRepoConfig(),
    ...renderOptions
  }: CustomRenderOptions = {},
) {
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <RepoProvider config={repoConfig}>{children}</RepoProvider>
  }

  return render(ui, { wrapper: Wrapper, ...renderOptions })
}

// Create a proper wrapper component for renderHook
export function createRepoWrapper(
  repoConfig: RepoParams = createTestRepoConfig(),
) {
  return function RepoWrapper({ children }: { children: React.ReactNode }) {
    return <RepoProvider config={repoConfig}>{children}</RepoProvider>
  }
}

// Helper to create a test document ID
export function createTestDocumentId(): DocId {
  return `test-doc-${Math.random().toString(36).substr(2, 9)}`
}
