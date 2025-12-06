# @loro-extended/repo

## 0.7.0

### Minor Changes

- 0879e51: When generating a UUID, prefer crypto.generateUUID, but gracefully fall back to other means in insecure contexts

### Patch Changes

- a26a6c2: Auto-reset repo if needed
- Updated dependencies [ab2d939]
  - @loro-extended/change@0.7.0

## 0.6.0

### Patch Changes

- c67e26c: Refactor directory-response into a new-doc message that is specifically for new, local doc announcements (pull-based). This frees us to use directory-response for its original intended purpose in future.
- 76a18ba: Updated Repo messages to be more efficient with regard to ephemeral state when peers request documents--just pass the ephemeral state along with the sync-request and sync-response, rather than initiating another message loop.
- Updated dependencies [26ca4cd]
- Updated dependencies [b9da0e9]
  - @loro-extended/change@0.6.0

## 0.5.0

### Minor Changes

- 9b291dc: Fixed an issue where StorageAdapter was not properly handling subscribes, making storage miss some documents.
- 204fda2: Fixed an issue with StorageAdapter where unnecessary data was sent, and potentially saved, in the storage medium.

### Patch Changes

- @loro-extended/change@0.5.0

## 0.4.0

### Minor Changes

- Accurate and fast presence updates

### Patch Changes

- Updated dependencies
  - @loro-extended/change@0.4.0

## 0.3.0

### Minor Changes

- 6d95249: Consistent ReadyState and additional tests

### Patch Changes

- Updated dependencies [6d95249]
  - @loro-extended/change@0.3.0

## 0.2.0

### Minor Changes

- Release 0.2.0

### Patch Changes

- Updated dependencies
  - @loro-extended/change@0.2.0
