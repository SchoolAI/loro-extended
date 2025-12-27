# Loro Extended Documentation

This directory contains architecture documentation and design documents for the loro-extended ecosystem.

## Overview

[Loro Extended](../README.md) is a toolkit for building local-first applications and multi-agent systems with [Loro](https://github.com/loro-dev/loro). It provides schemas, network synchronization, persistence, and reactivity on top of Loro's CRDT engine.

---

## Architecture Documentation

| Document                                                                | Description                                                                                                                                                                     |
| :---------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Repo Architecture](./repo-architecture.md)                             | High-level architecture of the repo package, including system overview, core components, and design decisions.                                                                  |
| [Discovery and Sync Architecture](./discovery-and-sync-architecture.md) | Detailed architecture for document discovery and synchronization, including the pull-based discovery model, peer awareness tracking, and the Rules system for privacy controls. |
| [Presence (Ephemeral Data)](./presence.md)                              | Theory and implementation of ephemeral/presence data propagation, including the hop-based relay system and disconnect cleanup strategies.                                       |
| [Creating Custom Adapters](./creating-adapters.md)                      | Guide for implementing custom storage and network adapters.                                                                                                                     |

---

## Core Package Documentation

| Package                                                   | Description                                                                                                                           |
| :-------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------ |
| [**@loro-extended/change**](../packages/change/README.md) | Schema-driven, type-safe wrapper for Loro CRDT. Provides the `Shape` schema builders and `TypedDoc` for natural JavaScript mutations. |
| [**@loro-extended/repo**](../packages/repo/README.md)     | The sync engine. Manages document lifecycle, storage, and network synchronization through a channel-based adapter architecture.       |
| [**@loro-extended/react**](../packages/react/README.md)   | React hooks (`useDoc`, `useEphemeral`) for building reactive collaborative UIs.                                                       |
| [**@loro-extended/hono**](../packages/hono/README.md)     | Hono JSX hooks mirroring the React API for Hono-based applications.                                                                   |

### Additional Repo Documentation

The `@loro-extended/repo` package contains additional in-depth documentation:

| Document                                                      | Description                                                                  |
| :------------------------------------------------------------ | :--------------------------------------------------------------------------- |
| [Repo Architecture](../packages/repo/src/repo.md)             | Overall system architecture and design principles.                           |
| [Handle Design](../packages/repo/src/doc-handle.md)           | Always-available document design and readiness APIs.                         |
| [Synchronizer Protocol](../packages/repo/src/synchronizer.md) | Synchronization protocol details and state machine design.                   |
| [Adapter System](../packages/repo/src/adapter/adapter.md)     | Adapter system design and implementation guide.                              |
| [Message Protocol](../packages/repo/MESSAGES.md)              | Complete message flow documentation for peer connection and synchronization. |

---

## Storage Adapter Documentation

| Adapter                                                               | Description                                      |
| :-------------------------------------------------------------------- | :----------------------------------------------- |
| [**@loro-extended/adapter-indexeddb**](../adapters/indexeddb/)        | IndexedDB storage for browser-based persistence. |
| [**@loro-extended/adapter-leveldb**](../adapters/leveldb/)            | LevelDB storage for server-side persistence.     |
| [**@loro-extended/adapter-postgres**](../adapters/postgres/README.md) | PostgreSQL storage for server-side persistence.  |

---

## Network Adapter Documentation

| Adapter                                                                       | Description                                                                           |
| :---------------------------------------------------------------------------- | :------------------------------------------------------------------------------------ |
| [**@loro-extended/adapter-http-polling**](../adapters/http-polling/README.md) | HTTP polling with resilient long-polling support. Works with any HTTP infrastructure. |
| [**@loro-extended/adapter-sse**](../adapters/sse/)                            | Server-Sent Events (SSE) for real-time client-server sync.                            |
| [**@loro-extended/adapter-websocket**](../adapters/websocket/README.md)       | WebSocket adapter implementing the Loro Syncing Protocol.                             |
| [**@loro-extended/adapter-webrtc**](../adapters/webrtc/README.md)             | WebRTC data channel adapter for peer-to-peer document synchronization.                |

---

## Quick Links

- [Main README](../README.md) - Project overview and quick start guide
- [Examples](../README.md#-examples) - Example applications demonstrating various features
- [Loro Documentation](https://loro.dev) - Official Loro CRDT documentation
