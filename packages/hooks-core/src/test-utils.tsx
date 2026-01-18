/**
 * Test utilities for hooks-core.
 *
 * This file creates React-based hooks from the hooks-core factories for testing.
 * React is a dev dependency only - the package remains framework-agnostic at runtime.
 */
import type { DocId, RepoParams } from "@loro-extended/repo"
import { InMemoryStorageAdapter, Repo } from "@loro-extended/repo"
import { act, renderHook, waitFor } from "@testing-library/react"
import * as React from "react"
import type { CursorRegistry } from "./cursor-registry"
import {
  createHooks,
  createRefHooks,
  createTextHooks,
  createUndoHooks,
} from "./index"
import type { UndoManagerRegistry } from "./undo-manager-registry"

// ============================================================================
// React-based hooks from hooks-core factories
// ============================================================================

const coreHooks = createHooks(React)
export const { RepoContext, useRepo, useHandle, useDoc, useEphemeral } =
  coreHooks

// Create ref hooks
const refHooks = createRefHooks(React)
export const { useRefValue } = refHooks

/**
 * Create text hooks with optional cursor registry support.
 */
export function createTestTextHooks(
  getCursorRegistry?: () => CursorRegistry | null,
) {
  return createTextHooks(React, { getCursorRegistry })
}

/**
 * Create undo hooks with optional registry support.
 */
export function createTestUndoHooks(config?: {
  getCursorRegistry?: () => CursorRegistry | null
  getUndoManagerRegistry?: () => UndoManagerRegistry | null
}) {
  return createUndoHooks(React, config)
}

// ============================================================================
// Re-export testing utilities
// ============================================================================

export { act, renderHook, waitFor }

// ============================================================================
// Test helpers
// ============================================================================

/**
 * Create a test repo configuration with in-memory storage.
 */
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

/**
 * Create a wrapper component that provides a Repo context.
 */
export function createRepoWrapper(
  repoConfig: RepoParams = createTestRepoConfig(),
) {
  return function RepoWrapper({ children }: { children: React.ReactNode }) {
    const [repo] = React.useState(() => new Repo(repoConfig))
    return React.createElement(RepoContext.Provider, { value: repo }, children)
  }
}

/**
 * Create a unique test document ID.
 */
export function createTestDocumentId(): DocId {
  return `test-doc-${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Create a mock HTMLInputElement for testing.
 */
export function createMockInput(id = "test-input"): HTMLInputElement {
  const input = document.createElement("input")
  input.id = id
  return input
}

/**
 * Create a mock HTMLTextAreaElement for testing.
 */
export function createMockTextarea(id = "test-textarea"): HTMLTextAreaElement {
  const textarea = document.createElement("textarea")
  textarea.id = id
  return textarea
}
