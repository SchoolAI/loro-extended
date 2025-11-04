# Synchronizer Handlers

This directory contains the message handlers for the loro-extended synchronization protocol.

## Overview

The synchronizer implements a **pull-based discovery model** with two main flows:

1. **Discovery** (what documents exist) - `directory-request/response`
2. **Sync** (transferring data) - `sync-request/response`

## File Organization

### Core Infrastructure

- **types.ts** - Shared type definitions (`ChannelHandlerContext`)
- **utils.ts** - Utility functions (`batchAsNeeded`)
- **rule-context.ts** - Permission checking utilities
- **peer-state-helpers.ts** - Peer state management functions
- **state-helpers.ts** - Document and channel state helpers

### Channel Message Handlers (channel/*)

Protocol messages between peers:

- **handle-establish-request.ts** - Server side of connection handshake
- **handle-establish-response.ts** - Client side of connection handshake
- **handle-directory-request.ts** - Peer asks what documents we have
- **handle-directory-response.ts** - Peer announces documents they have
- **handle-sync-request.ts** - Peer requests document data
- **handle-sync-response.ts** - Peer sends document data

### Synchronizer Message Handlers (synchronizer/*)

Internal state management:

- **handle-channel-added.ts** - Channel connected
- **handle-establish-channel.ts** - Initiate connection handshake
- **handle-channel-removed.ts** - Channel disconnected
- **handle-local-doc-ensure.ts** - Create/load document locally
- **handle-local-doc-change.ts** - Propagate local changes to peers
- **handle-local-doc-delete.ts** - Delete document locally

## Key Concepts

### Pull-Based Discovery

The system uses announcements + explicit requests:

1. Peer announces documents (directory-response)
2. Interested peers request them (sync-request)
3. Data flows only when requested (sync-response)

This respects peer autonomy and saves bandwidth.

### Peer Awareness

The system tracks what each peer knows about documents:

- **"unknown"** - We don't know if peer has this doc → send announcement
- **"has-doc"** - Peer has requested this doc → send real-time updates
- **"no-doc"** - Peer doesn't have this doc → send nothing

### Permission Rules

Two rules control the protocol:

- **canReveal** - Controls discovery (who can know a document exists)
- **canUpdate** - Controls sync (who can receive/send document data)

## Common Patterns

### Pattern 1: New Document Created

```
User creates doc → local-doc-change
  → Send directory-response (announcement)
  → Storage adapter sends sync-request (eager)
  → Send sync-response with data
```

### Pattern 2: Existing Document Modified

```
User edits doc → local-doc-change
  → Send sync-response to peers who requested (real-time)
  → Send directory-response to peers who don't know about it
```

### Pattern 3: Peer Connection

```
establish-request/response handshake
  → Both send directory-request
  → Both send sync-request for their docs
  → Discovery and sync in parallel
```

## Storage Adapters

Storage adapters are just peers that:
- Request all announced documents (eager sync)
- Always have subscriptions after first sync
- Receive real-time updates for all changes

## Further Reading

- [Discovery and Sync Architecture](../../../../docs/discovery-and-sync-architecture.md) - Detailed protocol documentation
- [synchronizer-program.ts](../synchronizer-program.ts) - Main orchestration logic
- [MESSAGES.md](../../MESSAGES.md) - Message protocol reference