---
"@loro-extended/change": minor
---

Add `$` namespace to typed refs for accessing underlying Loro primitives

This release adds a `$` namespace to all typed refs (TextRef, CounterRef, ListRef, MovableListRef, RecordRef, StructRef, TreeRef) that provides:

- `ref.$.loroDoc` - Access the underlying LoroDoc from any ref
- `ref.$.loroContainer` - Access the correctly-typed Loro container (LoroText, LoroCounter, LoroList, etc.)
- `ref.$.subscribe(callback)` - Subscribe to container-level changes

Also adds functional helpers:

- `getLoroDoc(ref)` - Functional API to get LoroDoc from any ref (extends existing `getLoroDoc(doc)`)
- `getLoroContainer(ref)` - New functional API to get the typed Loro container from any ref

This enables the "pass around a ref" pattern where components can receive a ref and subscribe to its changes without needing the full document:

```typescript
function TextEditor({ textRef }: { textRef: TextRef }) {
  useEffect(() => {
    return textRef.$.subscribe((event) => {
      // Handle text changes
    });
  }, [textRef]);
  
  // Access the container for advanced operations
  const loroText = textRef.$.loroContainer;
  
  return <div>...</div>;
}
```
