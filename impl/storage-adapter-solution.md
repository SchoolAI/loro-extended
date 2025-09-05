# Storage Adapter Solution: Version-Based Unique Keys

## Problem Solved

The storage adapter was using non-unique keys like `[documentId]` which caused each save to overwrite the previous one. This made incremental storage impossible and lost all history except the last change.

## Solution Implemented

We now extract version information from the document AFTER changes are applied and use it to create unique storage keys.

### Key Changes

1. **Extracted common version key logic**:
```typescript
private getVersionKey(doc: LoroDoc): string {
  const versionBytes = doc.oplogVersion().encode()
  return Buffer.from(versionBytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}
```

2. **For Snapshots** (when document becomes ready):
```typescript
const versionKey = this.getVersionKey(doc)
await storageAdapter.save([documentId, "snapshot", versionKey], data)
```

3. **For Incremental Updates** (on local changes):
```typescript
// The change has already been applied when this event fires
const doc = handle.doc()
const versionKey = this.getVersionKey(doc)
await storageAdapter.save([documentId, "update", versionKey], message)
```

## Why This Works

1. **Unique Keys**: Each version produces a unique key, preventing overwrites
2. **Proper Timing**: We extract version info AFTER the change is applied
3. **Flexible Storage**: Adapters can now implement different strategies:
   - Store all updates for full history
   - Compact periodically
   - Keep only recent changes

## Storage Key Structure

The `StorageKey` is a `string[]` that now follows this pattern:

- **Snapshots**: `[documentId, "snapshot", versionKey]`
- **Updates**: `[documentId, "update", versionKey]`

This allows storage adapters to:
- Query all chunks for a document: `loadRange([documentId])`
- Query only snapshots: `loadRange([documentId, "snapshot"])`
- Query only updates: `loadRange([documentId, "update"])`

## Version Key Format

The version key is created by:
1. Getting the oplog version from the document
2. Encoding it to bytes (`Uint8Array`)
3. Converting to URL-safe base64 for use in the storage key

We use base64 instead of hex for more compact keys:
- Base64 is ~33% more compact than hex
- URL-safe variant avoids filesystem issues (replaces `+/=` with `-_`)
- Still maintains uniqueness and readability

```typescript
private getVersionKey(doc: LoroDoc): string {
  const versionBytes = doc.oplogVersion().encode()
  return Buffer.from(versionBytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '') // Remove padding
}
```

## Benefits

1. **No Data Loss**: Each change is stored separately
2. **Incremental Storage**: Enables efficient sync and history tracking
3. **Flexible Strategies**: Adapters can implement snapshot, incremental, or hybrid approaches
4. **Automerge-Compatible**: The key structure supports future enhancements like compaction

## Future Enhancements

While the current implementation solves the immediate problem, future work could include:

1. **Compaction**: Periodically combine updates into snapshots
2. **Garbage Collection**: Remove old updates after compaction
3. **Branching**: Support multiple versions with branch keys
4. **Optimization**: Let adapters declare their preferred strategy

The architecture now supports all these enhancements without breaking changes.