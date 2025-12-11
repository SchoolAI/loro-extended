## Important Edge Cases for Multi-Peer Schema Migration

When dealing with multiple peers and schema migration in a CRDT system, there are several critical edge cases to consider:

### 1. Version Skew Between Peers

- **Peer A on V3, Peer B on V1**: Both write to different storage keys simultaneously
- **Data divergence**: V3 peer sees migrated data, V1 peer sees original data
- **Conflict on upgrade**: When V1 peer upgrades, which data wins?

### 2. Concurrent Migration and Write

- **Race condition**: Peer 1 migrates stale V1 data while Peer 2 writes fresh V1 data
- **Lost updates**: Migration overwrites newer V1 data with transformed stale data
- **Timestamp ordering**: CRDT may resolve in favor of older migrated data

### 3. Partial Sync During Migration

- **Incomplete document**: Peer receives partial sync missing the V1 data needed for migration
- **Out-of-order delivery**: V2 key arrives before V1 key, migration skipped, then V1 arrives
- **Network partition**: Peer migrates locally, partition heals, conflicting migrations merge

### 4. Garbage Collection Timing

- **Premature GC**: Deleting V1 data before all peers have migrated
- **Offline peers**: Peer comes online after GC, has only V1 data, V1 key deleted on sync
- **Data loss**: V1 deleted, V2 never written (migration never triggered for that peer)

### 5. Chained Migration Gaps

- **Missing intermediate version**: V1 → V3 migration exists, but peer has V2 data
- **Incompatible transforms**: V1→V2 transform + V2→V3 transform ≠ V1→V3 transform
- **Circular dependencies**: V1 needs V2 data to migrate, V2 needs V1 data

### 6. Container Type Changes

- **List → MovableList**: Peer 1 migrates, Peer 2 writes to old List, merge conflict
- **Text → Object**: Collaborative text edits during migration window
- **Counter → Value**: Counter increments lost during migration

### 7. Nested Migration Conflicts

- **Heterogeneous lists**: Same list contains items at different schema versions
- **Nested object migration**: Parent migrated, child not migrated (or vice versa)
- **Array index shifts**: Migration changes array structure, indices become invalid

### 8. Idempotency and Re-migration

- **Double migration**: Same data migrated twice due to sync timing
- **Migration loops**: V1→V2 migration triggers, then V2→V1 "downgrade" from another peer
- **Idempotency failure**: `transform(transform(data)) ≠ transform(data)`

### Recommendations for Robust Migration

1. **Version Markers**: Store schema version in document metadata
2. **Delayed GC**: Only GC after high confidence all peers have migrated
3. **Tombstones**: Mark V1 data as "migrated" rather than deleting
4. **Conflict Resolution**: Define explicit merge strategy for version conflicts
5. **Backward Compatibility**: Keep V1 readers working even after V2 writes
6. **Migration Audit Log**: Track which peers have completed migration
