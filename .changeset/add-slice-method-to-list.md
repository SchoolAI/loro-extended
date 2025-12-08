---
"@loro-extended/change": minor
---

Add `.slice()` method to `ListRefBase` for getting slices of arrays

The new `slice(start?, end?)` method follows JavaScript's `Array.prototype.slice()` semantics:
- Returns a portion of the list from `start` to `end` (exclusive)
- Supports negative indices (counting from the end)
- Returns `MutableItem[]` so mutations to sliced items persist back to the original list

Example usage:
```typescript
typedDoc.change(draft => {
  // Get items at indices 1 and 2
  const sliced = draft.items.slice(1, 3)
  
  // Get last 2 items
  const lastTwo = draft.items.slice(-2)
  
  // Mutations persist back to the original list
  sliced[0].value = 'updated'
})