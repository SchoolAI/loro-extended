// Get a list of docIds that we are allowed to tell msg.peerId about
const docIds = [...Object.keys(model.documents)].filter(docId =>
  permissions.canList(msg.channelId, docId),
)

// Take note that this peer is aware of the docIds we are about to send it via the directory-response
for (const documentId of docIds) {
  const docState = model.documents.get(documentId)
  if (docState) {
    docState.channelsState.set(
      msg.channelId,
      createDocChannelState({
        awareness: { state: "has-doc", asOf: Date.now() },
      }),
    )
  }
}

// Return the command
return {
          type: "cmd/send-message",
          message: {
            type: "channel/directory-response",
            docIds: docIds,
            targetIds: [msg.channelId],
          },
        }

          | {
      type: "msg/update-doc-channel-state"
      docId: DocId
      channelId: ChannelId
      status: Partial<DocChannelState>
    }
  | {
      type: "msg/document-changed"
      docId: DocId
      event: LoroEventBatch
    }
  | {
      type: "msg/doc-channel-state-changed"
      docId: DocId
      channelId: ChannelId
      status: DocChannelState
    }
// // (from channel): a channel can request a doc sync
// | {
//     type: "msg/broadcast-sync-request"
//     from: ChannelId
//     docId: DocId
//     myVersion: VersionVector
//   }

// | { type: "msg/received-sync"; from: PeerId; documentId: DocumentId; transmission: SyncTransmission; hopCount: number }
// Internal Events
// | { type: "msg/sync-timeout-fired"; documentId: DocumentId }

case "msg/update-doc-channel-state":
{
  const { docId: documentId, channelId, status } = msg
  const docState = model.documents.get(documentId)
  if (docState) {
    const docChannelStatus = docState.channelState.get(channelId)
    if (docChannelStatus) {
      Object.assign(docChannelStatus, status)
    } else {
      docState.channelState.set(channelId, createDocChannelState(status))
    }
  }
  return
}

// case "msg/broadcast-sync-request": {
//   const { docId: documentId } = msg

//   // Send sync requests to all connected peers
//   const peerIds = Array.from(model.peers.keys())

//   if (peerIds.length === 0) {
//     return // No peers to sync with
//   }

//   return {
//     type: "cmd/send-message",
//     message: {
//       type: "channel/sync-request",
//       docId: documentId,
//       targetIds: peerIds,
//     },
//   }
// }

// async #executeLoadFromSource(documentId: DocId, sourceId: string) {
//   const docState = this.model.documents.get(documentId)
//   if (!docState) return

//   // Update ready state to requesting and emit event
//   const requestingState = {
//     source: { type: "storage" as const, storageId: sourceId },
//     state: { type: "requesting" as const },
//   }

//   this.#dispatch({
//     type: "msg/doc-channel-state-changed",
//     docId: documentId,
//     channelId: sourceId,
//     readyState: requestingState,
//   })

//   try {
//     const hadContentBefore = this.hasContent(docState.doc)
//     await this.#dataSourceCoordinator.loadFromStorage(
//       documentId,
//       docState.doc,
//       sourceId,
//     )
//     const hasNewContent = this.hasContent(docState.doc) && !hadContentBefore

//     const foundState = {
//       source: { type: "storage" as const, storageId: sourceId },
//       state: { type: "found" as const, containsNewOperations: hasNewContent },
//     }

//     this.#dispatch({
//       type: "msg/doc-channel-state-changed",
//       docId: documentId,
//       channelId: sourceId,
//       readyState: foundState,
//     })
//   } catch (_error) {
//     const notFoundState = {
//       source: { type: "storage" as const, storageId: sourceId },
//       state: { type: "not-found" as const },
//     }

//     this.#dispatch({
//       type: "msg/doc-channel-state-changed",
//       docId: documentId,
//       channelId: sourceId,
//       readyState: notFoundState,
//     })
//   }
// }

// this.#dataSourceCoordinator.send({
//   type: "channel/sync-response",
//   targetIds: [to],
//   documentId,
//   transmission: { type: "update", data },
//   hopCount: 0,
// })

// async #executeSaveToSource(documentId: DocId, sourceId: string) {
//   const docState = this.model.documents[documentId]
//   if (!docState) return

//   // TODO: this is not quite right
//   await this.#dataSourceCoordinator.saveToStorage(
//     documentId,
//     docState.doc,
//     null as any,
//   )
// }

// #ensureDocumentState(documentId: DocId): void {
//   if (!(documentId in this.model.documents)) {
//     const docState: DocState = {
//       docId: documentId,
//       doc: new LoroDoc(),
//       channelsState: new Map(),
//     }

//     this.model.documents[documentId] = docState

//     // Setup document subscriptions using clipped logic
//     this.setupDocumentSubscriptions(docState, this)
//   }
// }

// setupDocumentSubscriptions(
//   docState: DocState,
//   synchronizer: Synchronizer,
// ): void {
//   docState.doc.subscribe(event => {
//     // Handle doc changes, trigger storage saves
//     if (event.by === "local" || event.by === "import") {
//       synchronizer.#dispatch({
//         type: "msg/document-changed",
//         docId: docState.docId,
//         event,
//       })
//     }
//   })

//   docState.doc.subscribeLocalUpdates(syncMessage => {
//     // Emit for network synchronization
//     synchronizer.#dispatch({
//       type: "msg/local-doc-change",
//       docId: docState.docId,
//       data: syncMessage,
//     })
//   })
// }

// hasContent(doc: LoroDoc): boolean {
//   const vv = doc.oplogVersion()
//   for (const [, counter] of vv.toJSON()) {
//     if (counter > 0) {
//       return true
//     }
//   }
//   return false
// }
