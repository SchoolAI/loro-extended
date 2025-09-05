import type { DocHandle, DocumentId, RepoConfig } from "@loro-extended/repo"
import { type RenderOptions, render } from "@testing-library/react"
import type { ReactElement } from "react"
import { vi } from "vitest"
import type { DocWrapper } from "./hooks/use-loro-doc-state.js"
import { RepoProvider } from "./repo-context.js"

// Mock DocHandle for testing
export function createMockDocHandle(
  overrides: Partial<DocHandle<DocWrapper>> = {},
): DocHandle<DocWrapper> {
  const mockHandle: DocHandle<DocWrapper> = {
    state: "ready",
    doc: vi.fn().mockReturnValue({
      opCount: vi.fn().mockReturnValue(1),
      getMap: vi.fn().mockReturnValue(new Map()),
    }),
    change: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    ...overrides,
  } as any

  return mockHandle
}

// Create a test RepoConfig
export function createTestRepoConfig(
  overrides: Partial<RepoConfig> = {},
): RepoConfig {
  return {
    peerId: `test-peer-${Math.random().toString(36).substr(2, 9)}`,
    storage: {
      save: vi.fn().mockResolvedValue(undefined),
      load: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      loadRange: vi.fn().mockResolvedValue([]),
      removeRange: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  }
}

// Custom render function with RepoProvider
interface CustomRenderOptions extends Omit<RenderOptions, "wrapper"> {
  repoConfig?: RepoConfig
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
  repoConfig: RepoConfig = createTestRepoConfig(),
) {
  return function RepoWrapper({ children }: { children: React.ReactNode }) {
    return <RepoProvider config={repoConfig}>{children}</RepoProvider>
  }
}

// Helper to create a test document ID
export function createTestDocumentId(): DocumentId {
  return `test-doc-${Math.random().toString(36).substr(2, 9)}` as DocumentId
}
