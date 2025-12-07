import type { DocHandle, DocId, RepoParams } from "@loro-extended/repo"
import { InMemoryStorageAdapter } from "@loro-extended/repo"
import { type RenderOptions, render } from "@testing-library/react"
import type { ReactElement } from "react"
import { vi } from "vitest"
import type { DocWrapper } from "./index.js"
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
