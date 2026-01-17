---
"@loro-extended/hooks-core": minor
"@loro-extended/react": patch
"@loro-extended/hono": patch
---

Add `useRefValue` hook for fine-grained subscriptions to typed refs

The new `useRefValue` hook subscribes to a single typed ref (TextRef, ListRef, CounterRef, etc.) and returns its current value. This provides:

- **No prop drilling** - Components only need the ref, not value + placeholder
- **Automatic placeholder** - Extracts placeholder from `Shape.text().placeholder()`
- **Fine-grained subscriptions** - Only re-renders when this specific container changes
- **Type-safe** - Return type is inferred from the ref type

Example usage:

```tsx
import { useRefValue, type TextRef } from "@loro-extended/react";

function ControlledInput({ textRef }: { textRef: TextRef }) {
  // No need to pass value or placeholder as props!
  const { value, placeholder } = useRefValue(textRef);

  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(e) => textRef.update(e.target.value)}
    />
  );
}
```

This is particularly useful for building controlled inputs without the prop drilling required when using `useDoc` at the parent level.
