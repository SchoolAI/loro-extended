import type { CursorRegistry } from "./cursor-registry"
import type { FrameworkHooks } from "./types"

/**
 * Creates cursor registry context and hooks for a specific framework.
 *
 * @param framework - Framework-specific hook implementations
 * @returns Object containing CursorRegistryProvider and useCursorRegistry hook
 */
export function createCursorRegistryContext(framework: FrameworkHooks) {
  const { createContext, useContext } = framework

  // Create the context with null as default (no provider)
  const CursorRegistryContext = createContext<CursorRegistry | null>(null)

  /**
   * Hook to access the cursor registry.
   * Returns null if no CursorRegistryProvider is present in the tree.
   *
   * @returns The CursorRegistry instance, or null if not available
   */
  function useCursorRegistry(): CursorRegistry | null {
    return useContext<CursorRegistry | null>(CursorRegistryContext)
  }

  return {
    CursorRegistryContext,
    useCursorRegistry,
  }
}
