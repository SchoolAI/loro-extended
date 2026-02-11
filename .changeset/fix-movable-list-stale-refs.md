---
"@loro-extended/change": patch
---

Fixed stale container refs after MovableListRef.move() operations

When items in a MovableListRef were reordered via move(), cached TextRefs and other container refs would become stale, causing the wrong data to be returned. This manifested as text content not moving with reordered list items.

The fix disables container ref caching outside of change() transactions, ensuring fresh refs are created on each access. This mirrors the existing behavior for value shapes and eliminates the stale cache issue.