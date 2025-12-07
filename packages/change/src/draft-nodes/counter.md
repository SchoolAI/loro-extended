### Summary: The `getCounter` Side-Effect & Read-Only Access

We have uncovered a subtle and unexpected between Loro's API and our `TypedDoc` "empty state" logic.

#### 1. The Problem

A test expects a LoroConter at `doc.value.counter` to return `1` (from `emptyState`), but it returns `0`.

- **`doc.toJSON()`** works correctly: It sees the doc is empty, so it overlays `emptyState` (`{ counter: 1 }`).
- **`doc.value`** fails: It returns `0`.

#### 2. The Root Cause: "Heisenberg" Observation

Accessing a root container in Loro changes it.

- **Observation:** Calling `doc.getCounter("counter")` **materializes** the container in the CRDT with a default value of `0`.
- **Consequence:** `DraftDoc` calls `getCounter` to read the value. This inadvertently "writes" a `0` to the document.
- **Result:** The "empty" state is lost. The document now effectively contains `counter: 0`.

#### 3. The Solution: `getShallowValue()`

We need to peek at the document to see if a container exists _before_ we try to retrieve (and thus create) it.

- **Investigation:** We verified that `doc.getShallowValue()` returns a list of existing root containers _without_ creating new ones.
- **Strategy:**
  1.  In `DraftDoc` (which handles root properties), check `readonly` mode.
  2.  Call `doc.getShallowValue()`.
  3.  **If key is missing:** Return the `emptyState` value directly.
  4.  **If key exists:** Safe to call `doc.getCounter()` (or others) to get the actual CRDT value.

This ensures `doc.value` remains a pure, non-destructive view that respects the "virtual" empty state.
