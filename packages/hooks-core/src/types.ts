/**
 * Framework-agnostic hook interface for dependency injection.
 * Framework adapters (React, Hono, etc.) provide implementations of these hooks.
 *
 * Note: Context types use `any` to allow framework-specific context implementations
 * (React.Context, Hono context, etc.) to be passed without type conflicts.
 */
export interface FrameworkHooks {
  useState: <T>(
    initialState: T | (() => T),
  ) => [T, (newState: T | ((prevState: T) => T)) => void]
  useEffect: (effect: () => undefined | (() => void), deps?: unknown[]) => void
  /**
   * Memoizes a callback function.
   * The callback type is generic to preserve the function signature.
   * Note: We use `any` for args to allow framework-specific callback signatures.
   */
  useCallback: <T extends (...args: any[]) => any>(
    callback: T,
    deps: unknown[],
  ) => T
  useMemo: <T>(factory: () => T, deps: unknown[]) => T

  useRef: <T>(initialValue: T) => { current: T | null }

  useSyncExternalStore: <Snapshot>(
    subscribe: (onStoreChange: () => void) => () => void,
    getSnapshot: () => Snapshot,
  ) => Snapshot

  /**
   * Accesses a context value.
   * The context parameter is framework-specific (React.Context, etc.).
   * Note: We use `any` for args to allow framework-specific signatures.
   */
  useContext: <T>(context: any) => T

  /**
   * Creates a new context.
   * Returns a framework-specific context object.
   * Note: We use `any` for args to allow framework-specific signatures.
   */
  createContext: <T>(defaultValue: T) => any
}
