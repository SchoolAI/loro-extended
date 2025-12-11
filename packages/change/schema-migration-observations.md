# Observations and Recommendations for `loro-extended/change`

Based on the code analysis and the problem statement, here are my observations and recommendations.

## Observations

1.  **The "Shape" is Static, but Data is Dynamic:**
    The current `Shape` definition in `packages/change/src/shape.ts` is a static type definition. It describes *what the data should look like now*. It has no concept of time, versioning, or history. This is the root of the migration problem. When you change the `Shape` definition in your code, you are implicitly asserting that *all* data (past, present, and future) conforms to this new shape. In a P2P system, this assertion is false.

2.  **Placeholders are the "Secret Weapon" for Additive Changes:**
    The `derive-placeholder.ts` and `overlay.ts` logic is already doing a form of "migration on read" for additive changes. When a field is missing in the CRDT (because it was created by an older peer), the `overlayPlaceholder` function fills it in with a default value. This confirms that **additive changes are already supported and safe** in the current architecture, provided that:
    *   New fields have valid placeholders.
    *   The application logic can handle the default values.

3.  **Validation is Strict and "Now-Focused":**
    The `validateValue` function in `packages/change/src/validation.ts` enforces the *current* schema. If a peer sends data that includes a field that was removed in the current schema, `validateValue` (if called on raw data) might throw or ignore it. If a peer sends data with a wrong type (e.g., `string` instead of `number` due to a schema change), it *will* throw. This strictness is good for data integrity but bad for migration flexibility in a mixed-version environment.

4.  **`TypedDoc` is the Natural Integration Point:**
    `TypedDoc` (in `packages/change/src/typed-doc.ts`) wraps the raw `LoroDoc`. It is the gateway through which the application interacts with the data. This makes it the ideal place to intercept reads and writes to handle versioning and migration. Currently, it just applies the overlay. It could be enhanced to apply migrations.

5.  **JSON Patch is a "Tactical" Tool, Not a Strategy:**
    The `json-patch.ts` implementation provides a mechanism to modify the document, but it doesn't solve the *strategic* problem of *what* modifications to apply when schemas diverge. It's a useful primitive for implementing a migration function (e.g., "move `/content` to `/blocks/0/content`"), but it's not the migration system itself.

## Recommendations

### 1. Embrace "Additive-Only" as the Default P2P Strategy
The code already supports this well via placeholders. We should formalize this pattern.
*   **Recommendation:** Explicitly document and encourage "Additive-Only" evolution for P2P apps.
*   **Code Change:** Consider adding a `Shape.deprecated()` marker. This wouldn't change runtime behavior (it acts like an optional field), but it signals intent to developers and could trigger linter warnings if accessed.

### 2. Introduce Explicit Schema Versioning
We need a way to know *what* version a document (or a peer) is speaking.
*   **Recommendation:** Add a standard `_schema` or `_v` field to the root `DocShape`.
*   **Mechanism:**
    ```typescript
    const SchemaV1 = Shape.doc({
      _v: Shape.plain.number().placeholder(1),
      // ...
    });
    ```
    This allows a peer to inspect a document and say "Ah, this is version 1 data, but I know how to read version 2."

### 3. Implement "Lazy Migration" via `TypedDoc` (Client-Side)
For breaking changes where we *must* transform data (e.g., `content` -> `blocks`), we can do it lazily at the read layer without necessarily writing back to the CRDT immediately (which causes sync conflicts).
*   **Recommendation:** Enhance `TypedDoc` to accept a "Migration Strategy".
*   **Concept:**
    ```typescript
    const typedDoc = new TypedDoc(SchemaV3, loroDoc, {
      migrations: [
        { from: 1, to: 2, up: (data) => ... },
        { from: 2, to: 3, up: (data) => ... }
      ]
    });
    ```
    When `typedDoc.value` is accessed, if the underlying data is V1, the accessor runs the `up` functions *in memory* to present a V3 view to the application.
    *   **Trade-off:** This is read-only migration. Writing back is dangerous (the "Dual Write" problem). This works best for "Client/Server" or "Reader" scenarios.

### 4. The "Tombstone" Pattern for Renaming/Moving
To handle renames safely in P2P (e.g., `list` -> `movableList`), we shouldn't just delete the old field.
*   **Recommendation:** When "moving" data, keep the old field but mark it as deprecated. Write new data to the new field.
*   **Migration Logic:** "If new field is empty, try to populate from old field."
*   **Example (Case 5):**
    ```typescript
    // Schema V2
    columns: Shape.list(...), // Deprecated, read-only
    boardColumns: Shape.movableList(...) // New active field
    ```
    The application logic checks `boardColumns`. If empty, it reads `columns`, converts, and (optionally) writes to `boardColumns`.

### 5. Server-Side "Eager Migration" for Breaking Changes
For the "Client/Server" topology, the server is the authority.
*   **Recommendation:** Build a server-side utility that loads a doc, checks its version, applies all `up` migrations, and *commits* the result back to the CRDT.
*   **Benefit:** Clients just sync and receive the new structure.
*   **Risk:** Clients with pending offline edits to the *old* structure will have merge conflicts or "ghost" data. The server migration effectively "wins".

## Summary of the Path Forward

1.  **Immediate:** Document the "Additive-Only" pattern as the golden rule for P2P schema safety.
2.  **Short-term:** Add `Shape.deprecated()` to the API to help manage schema cruft.
3.  **Medium-term:** Prototype a `MigrationLayer` in `TypedDoc` that can transform data on-read (Lazy Migration).
4.  **Long-term:** Explore "Versioned CRDTs" where the sync protocol itself negotiates capabilities, but this is a heavy lift.

The `loro-extended/change` package is well-positioned because `TypedDoc` provides the perfect abstraction layer to hide this complexity from the developer. We just need to make `TypedDoc` smarter about time.