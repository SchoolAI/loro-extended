# React Hooks for Presence - Implementation Plan

## Overview

This plan adds React hooks for the new presence features in `@loro-extended/repo`. We'll follow the existing patterns from document hooks, leveraging the new `docHandle.presence` API.

## Key Design Principles

1. **Integrated with Documents**: Presence is an ephemeral layer on top of a document, accessed via `docHandle.ephemeral`.
2. **Simple API First**: Start with untyped API since presence is dynamic and less structured.
3. **React Best Practices**: Use `useSyncExternalStore` for external state synchronization.

## Proposed API Design

### Hook 1: `usePresence` - Presence State Hook

```typescript
/**
 * Hook that provides reactive access to presence state in a document.
 * Re-renders when presence updates occur.
 *
 * @param docHandle - The DocHandle instance
 * @returns Current presence state for all peers
 *
 * @example
 * ```tsx
 * function CursorOverlay({ docHandle }) {
 *   const presence = usePresence(docHandle);
 *
 *   return (
 *     <>
 *       {Object.entries(presence).map(([peerId, data]) => (
 *         <Cursor key={peerId} position={data.cursor} />
 *       ))}
 *     </>
 *   );
 * }
 * ```
 */
function usePresence<T = any>(
  docHandle: DocHandle<any> | null
): Record<PeerID, T>
```

### Hook 2: `useMyPresence` - Self Presence Hook

```typescript
/**
 * Hook that provides a setter for the current user's presence.
 * Convenience wrapper around docHandle.ephemeral.set().
 *
 * @param docHandle - The DocHandle instance
 * @returns Function to update own presence
 *
 * @example
 * ```tsx
 * function Editor({ docHandle }) {
 *   const setPresence = useMyPresence(docHandle);
 *
 *   const handleMouseMove = (e: MouseEvent) => {
 *     setPresence({ cursor: { x: e.clientX, y: e.clientY } });
 *   };
 *
 *   return <div onMouseMove={handleMouseMove}>...</div>;
 * }
 * ```
 */
function useMyPresence<T = any>(
  docHandle: DocHandle<any> | null
): (data: T) => void
```

## Implementation Structure

### File Organization

```
packages/react/src/hooks/
├── use-presence.ts                # Presence state hook
├── use-my-presence.ts             # Self presence setter hook
└── use-presence.test.tsx          # Tests for presence hooks
```

### Implementation Details

#### 1. `use-presence.ts`

```typescript
export function usePresence<T = any>(
  docHandle: DocHandle<any> | null
): Record<PeerID, T> {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!docHandle) return () => {};
      
      // Subscribe to presence updates
      return docHandle.ephemeral.subscribe(() => {
        onStoreChange();
      });
    },
    [docHandle]
  );
  
  const getSnapshot = useCallback(() => {
    if (!docHandle) return {};
    return docHandle.ephemeral.getAll() as Record<PeerID, T>;
  }, [docHandle]);
  
  return useSyncExternalStore(subscribe, getSnapshot);
}
```

#### 2. `use-my-presence.ts`

```typescript
export function useMyPresence<T = any>(
  docHandle: DocHandle<any> | null
): (data: T) => void {
  return useCallback(
    (data: T) => {
      if (!docHandle) return;
      docHandle.ephemeral.set(data);
    },
    [docHandle]
  );
}
```

## Testing Strategy

### Unit Tests (`use-presence.test.tsx`)

```typescript
describe("Presence Hooks", () => {
  describe("usePresence", () => {
    it("should return empty object initially", () => {});
    it("should update when presence changes", () => {});
    it("should handle docHandle being null", () => {});
  });
  
  describe("useMyPresence", () => {
    it("should set presence", () => {});
    it("should handle docHandle being null", () => {});
  });
});
```

---

This plan provides a comprehensive, well-structured approach to adding rooms and presence to the React package while maintaining consistency with existing patterns and React best practices.