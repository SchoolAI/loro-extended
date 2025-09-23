  #handles = new Map<DocumentId, DocHandle<any>>()
  getOrCreateHandle<T extends DocContent>(
    documentId: DocumentId,
  ): DocHandle<T> {
    let handle = this.#handles.get(documentId)
    if (!handle) {
      // this.#dispatch({ type: "msg/document-added", documentId })
      this.#ensureDocumentState(documentId)

      handle = new DocHandle<T>(this, documentId)
      this.#handles.set(documentId, handle)

      // Auto-load from storage
      this.#executeCommand({
        type: "cmd/load-from-source",
        documentId,
        sourceId: "default",
      })
    }
    return handle as DocHandle<T>
  }

