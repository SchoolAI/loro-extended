# Permissions

TODO: We used to have the following code enforce permissions in the network subsystem, but it was factored out in anticipation of the synchronizer owning permissions in future:

```ts
  /**
   * Set the permission adapter for authorization checks.
   */
  setPermissionAdapter(permissionAdapter: PermissionAdapter): void {
    this.#permissionAdapter = permissionAdapter
  }

  /**
   * Check if a message type requires permission checking.
   */
  #requiresPermissionCheck(type: UnsentRepoMessage["type"]): boolean {
    return [
      "announce-document",
      "request-sync",
      "sync",
      "delete-document",
    ].includes(type)
  }

  /**
   * Check if a peer is authorized for a specific document operation.
   */
  #checkDocumentPermission(
    peerId: PeerId,
    documentId: string,
    type: UnsentRepoMessage["type"],
  ): boolean {
    if (!this.#permissionAdapter) {
      return true // No permission adapter means allow all
    }

    switch (type) {
      case "announce-document":
      case "request-sync":
        return this.#permissionAdapter.canList(peerId, documentId)
      case "sync":
        return this.#permissionAdapter.canWrite(peerId, documentId)
      case "delete-document":
        return this.#permissionAdapter.canDelete(peerId, documentId)
      default:
        return true
    }
  }

      // For document-related messages, check permissions
      if (this.#requiresPermissionCheck(type)) {
        let documentId: string | undefined
        let canSend = true

        switch (type) {
          case "announce-document":
            documentId = message.documentIds[0]
            canSend = this.#checkDocumentPermission(targetId, documentId, type)
            break
          case "request-sync":
            documentId = message.documentId
            canSend = this.#checkDocumentPermission(targetId, documentId, type)
            break
          case "sync":
            documentId = message.documentId
            canSend = this.#checkDocumentPermission(targetId, documentId, type)
            break
          case "delete-document":
            documentId = message.documentId
            canSend = this.#checkDocumentPermission(targetId, documentId, type)
            break
        }

        if (!canSend && documentId) {
          console.warn(
            `[NetworkSubsystem] Peer ${targetId} not authorized for ${type} on document ${documentId}`,
          )
          return false
        }
      }
```