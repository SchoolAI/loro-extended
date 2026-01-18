import { Repo, type RepoParams } from "@loro-extended/repo"
import { type ReactNode, useEffect, useMemo } from "react"
import {
  CursorRegistry,
  CursorRegistryContext,
  RepoContext,
} from "./hooks-core.js"

/**
 * Configuration options for RepoProvider
 */
export interface RepoProviderConfig extends RepoParams {
  /**
   * Whether to enable automatic cursor restoration for undo/redo.
   * When enabled, cursor positions are automatically tracked and restored
   * when using useCollaborativeText with useUndoManager.
   * Default: true
   */
  cursorRestoration?: boolean
}

export const RepoProvider = ({
  config,
  children,
}: {
  config: RepoProviderConfig
  children: ReactNode
}) => {
  // Extract cursorRestoration option (default: true)
  const cursorRestoration = config.cursorRestoration ?? true

  const repo = useMemo(() => {
    // Create a copy without cursorRestoration for Repo
    const { cursorRestoration: _, ...repoParams } = config
    return new Repo(repoParams)
  }, [config])

  // Create cursor registry if cursor restoration is enabled
  const cursorRegistry = useMemo(
    () => (cursorRestoration ? new CursorRegistry() : null),
    [cursorRestoration],
  )

  // Proper cleanup when component unmounts
  useEffect(() => {
    return () => {
      // Clean up resources when RepoProvider unmounts
      repo.reset()
    }
  }, [repo])

  // Wrap with cursor registry context if enabled
  const content = (
    <RepoContext.Provider value={repo}>{children}</RepoContext.Provider>
  )

  if (cursorRegistry) {
    return (
      <CursorRegistryContext.Provider value={cursorRegistry}>
        {content}
      </CursorRegistryContext.Provider>
    )
  }

  return content
}

export { useRepo } from "./hooks-core.js"
