# Plan: Repo Mergeable Configuration and Document Metadata

## Context

Following the implementation of mergeable flattened containers in `@loro-extended/change`, we need to extend this to the repo layer. This discussion revealed a broader need for document-level metadata.

## Questions and Analysis

### Q1: Schema-Level Configuration - "Runtime-Aware" Concern

**Original concern**: "Schema becomes runtime-aware (currently it's just type metadata)"

**Clarification**: This concern is actually **not significant** for our use case. Here's why:

Currently, `Shape.doc()` returns a pure type descriptor:
```typescript
const schema = Shape.doc({
  players: Shape.record(Shape.struct({ score: Shape.plain.number() })),
})
// schema is just { _type: "doc", shapes: {...} }
```

Adding `mergeable` to the schema:
```typescript
const schema = Shape.doc({
  players: Shape.record(Shape.struct({ score: Shape.plain.number() })),
}, { mergeable: true })
// schema becomes { _type: "doc", shapes: {...}, mergeable: true }
```

**In practice**, this is fine because:
1. The schema is already used at runtime (for validation, placeholder derivation, etc.)
2. `mergeable` is a storage concern that naturally belongs with the schema
3. It makes the schema self-describing - you can look at a schema and know how it should be stored

**Recommendation**: Schema-level configuration is actually the cleanest approach.

### Q2: External Sync and Container Creation

**Question**: "Do we know that containers will certainly NOT be created by external sync?"

**Analysis**: You're absolutely right! When syncing:

1. **Peer A** creates a document with `mergeable: true`
   - Containers are stored at root: `cid:root-players-alice:Map`

2. **Peer B** receives the sync data
   - The container IDs are **already determined** by Peer A
   - Peer B imports them as-is - the IDs don't change

3. **The key insight**: Container IDs are determined by the **creator**, not the receiver

**Implications**:
- If Peer A uses `mergeable: true` and Peer B uses `mergeable: false`, the containers will still have root-based IDs (because A created them)
- The mismatch would cause issues when B tries to create new containers (they'd use nested IDs)
- **This is why document-level metadata is important** - peers need to agree on the storage strategy

### Q3: Document Metadata - The Bigger Picture

**Observation**: Multiple concerns point to needing document-level metadata:
- `mergeable` flag
- Schema version
- Schema itself (for validation)
- Other future metadata

**Proposed Solution**: A `_loro_meta` root container

```typescript
// Reserved root container for metadata
const META_CONTAINER_NAME = "_loro_meta"

interface LoroDocMetadata {
  // Storage strategy
  mergeable?: boolean
  
  // Schema versioning
  schemaVersion?: string
  schemaHash?: string  // Hash of schema for quick comparison
  
  // Future: other metadata
  // createdAt?: number
  // createdBy?: PeerID
}
```

**How it works**:

1. **On document creation** (first peer):
   ```typescript
   const metaMap = doc.getMap(META_CONTAINER_NAME)
   metaMap.set("mergeable", true)
   metaMap.set("schemaVersion", "1.0.0")
   ```

2. **On sync receive** (other peers):
   ```typescript
   const metaMap = doc.getMap(META_CONTAINER_NAME)
   const remoteMergeable = metaMap.get("mergeable")
   
   if (remoteMergeable !== localExpectedMergeable) {
     console.warn(`Document ${docId} has mergeable=${remoteMergeable} but local config expects ${localExpectedMergeable}`)
   }
   ```

3. **In toJSON()**: Skip the `_loro_meta` container
   ```typescript
   toJSON(): Infer<Shape> {
     const raw = this.doc.toJSON()
     delete raw[META_CONTAINER_NAME]  // Don't include in user-facing JSON
     // ... rest of reconstruction
   }
   ```

## Design: Combined Approach

### Phase 1: Schema-Level Mergeable Configuration

```typescript
// packages/change/src/shape.ts
interface DocShapeOptions {
  mergeable?: boolean
}

function doc<T extends Record<string, ContainerShape>>(
  shapes: T,
  options?: DocShapeOptions,
): DocShape<T> {
  return {
    _type: "doc",
    shapes,
    mergeable: options?.mergeable ?? false,
  }
}

// Usage
const schema = Shape.doc({
  players: Shape.record(Shape.struct({ score: Shape.plain.number() })),
}, { mergeable: true })
```

### Phase 2: Document Metadata Container

```typescript
// packages/change/src/metadata.ts
export const META_CONTAINER_NAME = "_loro_meta"

export interface DocMetadata {
  mergeable?: boolean
  schemaVersion?: string
}

export function writeMetadata(doc: LoroDoc, metadata: DocMetadata): void {
  const metaMap = doc.getMap(META_CONTAINER_NAME)
  if (metadata.mergeable !== undefined) {
    metaMap.set("mergeable", metadata.mergeable)
  }
  if (metadata.schemaVersion !== undefined) {
    metaMap.set("schemaVersion", metadata.schemaVersion)
  }
}

export function readMetadata(doc: LoroDoc): DocMetadata {
  const metaMap = doc.getMap(META_CONTAINER_NAME)
  return {
    mergeable: metaMap.get("mergeable") as boolean | undefined,
    schemaVersion: metaMap.get("schemaVersion") as string | undefined,
  }
}
```

### Phase 3: Repo Integration

```typescript
// packages/repo/src/handle.ts
constructor({ docId, docShape, ... }: HandleParams<D, E>) {
  // Get or create document state
  const docState = synchronizer.getOrCreateDocumentState(docId)
  
  // Read existing metadata (if any)
  const existingMeta = readMetadata(docState.doc)
  
  // Determine mergeable setting
  const schemaMergeable = docShape.mergeable ?? false
  
  // Validate consistency
  if (existingMeta.mergeable !== undefined && existingMeta.mergeable !== schemaMergeable) {
    console.warn(
      `Document ${docId} has mergeable=${existingMeta.mergeable} in metadata ` +
      `but schema specifies mergeable=${schemaMergeable}. Using metadata value.`
    )
  }
  
  // Use metadata if present, otherwise use schema
  const effectiveMergeable = existingMeta.mergeable ?? schemaMergeable
  
  // Write metadata if this is a new document
  if (existingMeta.mergeable === undefined) {
    writeMetadata(docState.doc, { mergeable: schemaMergeable })
  }
  
  // Create TypedDoc with the effective mergeable setting
  this._doc = createTypedDoc(docShape, { 
    doc: docState.doc,
    mergeable: effectiveMergeable,
  })
}
```

### Phase 4: Sync Validation (Optional Enhancement)

```typescript
// In sync response handler
function handleSyncResponse(msg, model) {
  // ... import data ...
  
  // After import, check metadata consistency
  const docState = model.documents.get(msg.docId)
  const meta = readMetadata(docState.doc)
  
  // Check for peer-dependent container IDs in a mergeable doc
  if (meta.mergeable) {
    const containerIds = Object.keys(docState.doc.toJSON())
    const peerDependentIds = containerIds.filter(id => 
      id.includes("@") && !id.startsWith("_loro_meta")
    )
    
    if (peerDependentIds.length > 0) {
      console.warn(
        `Document ${msg.docId} is marked mergeable but contains ` +
        `peer-dependent container IDs: ${peerDependentIds.join(", ")}`
      )
    }
  }
}
```

## Benefits of This Approach

1. **Self-Describing Documents**: The document carries its own metadata
2. **Peer Agreement**: All peers can read the metadata and use consistent settings
3. **Validation**: Can detect mismatches and warn developers
4. **Extensible**: Easy to add more metadata fields in the future
5. **Schema-Driven**: The schema declares the intent, metadata persists it

## Migration Path

For existing documents:
1. Documents without `_loro_meta` are assumed to be `mergeable: false`
2. First access with a `mergeable: true` schema writes the metadata
3. Subsequent accesses read and validate against the metadata

## Open Questions

1. Should metadata be immutable after first write? (Probably yes for `mergeable`)
2. Should we include schema hash for validation?
3. Should metadata changes trigger sync? (Yes, it's just another container)
4. Should we reserve other `_loro_*` prefixes for future use?

## Implementation Order

1. Add `mergeable` option to `Shape.doc()` in `@loro-extended/change`
2. Add metadata utilities (`readMetadata`, `writeMetadata`)
3. Update `createTypedDoc` to read `mergeable` from schema
4. Update `toJSON` to exclude `_loro_meta`
5. Update Handle to write/validate metadata
6. Add sync validation (optional)
7. Add tests for all scenarios
