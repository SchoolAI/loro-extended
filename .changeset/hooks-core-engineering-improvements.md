---
"@loro-extended/hooks-core": patch
---

Improve error handling, type safety, and add namespace validation

## Error Handling
- Add try-catch to `createSyncStore` subscription callback to prevent errors from breaking React rendering
- Add debug logging for cursor restoration failures in `useUndoManager`

## Type Safety
- Create `utils/type-guards.ts` with proper type guards (hasToJSON, hasSubscribe, hasInternalMethods, getPlaceholderSafe, toJSONSafe)
- Replace unsafe `any` casts with type guards in `create-ref-hooks.ts` and `text-ref-helpers.ts`
- Improve `useCallback` type signature in `FrameworkHooks` interface

## Namespace Validation
- Add `utils/validate-namespace.ts` with validation functions for undo namespaces
- Validate namespace format in `UndoManagerRegistry.getOrCreate()` and `useCollaborativeText`
- Namespaces must start with a letter, contain only letters/numbers/underscores/hyphens, max 64 chars

## Code Cleanup
- Remove dead `updateExistingManagers` method from `UndoManagerRegistry`
- Add JSDoc explaining the limitation of late namespace registration
- Create shared `utils/container-id.ts` for consistent container ID resolution
- Update `CursorRegistry` to use shared container ID utility

## Performance
- Optimize `useDoc` to check version before calling `toJSON()` to avoid unnecessary computation
