# Permissions System

The Permissions system in Loro Extended provides fine-grained access control for document synchronization. Permissions are simple, synchronous predicates that determine what peers can do with documents.

## Overview

Permissions are functions that receive document and peer context and return a boolean. They're evaluated at key points during synchronization to control data flow.

```typescript
import { Repo } from "@loro-extended/repo"

const repo = new Repo({
  identity: { name: "user-1", type: "user" },
  adapters: [...],
  permissions: {
    visibility: (doc, peer) => doc.id.startsWith("public/"),
    mutability: (doc, peer) => peer.peerType !== "bot",
    // ... also availabe: creation, deletion
  },
})
```

## Permission Context

Permissions receive two context objects:

### Document Context (`doc`)

```typescript
type DocumentContext = {
  id: DocId; // Document identifier
  loroDoc: LoroDoc; // The Loro document instance
};
```

### Peer Context (`peer`)

```typescript
type PeerContext = {
  peerId: PeerID; // Unique identifier for the peer
  peerName?: string; // Human-readable name (optional)
  peerType: "user" | "bot" | "service"; // Type of peer
  channelId: ChannelId; // Channel identifier
  channelKind: "storage" | "network" | "other"; // Type of channel
};
```

## The Four Permissions

### 1. `visibility`

**When called:** When announcing documents to a peer, either on connection or when a new document is created.

**Purpose:** Controls whether a peer learns about a document's existence.

**Default:** `true` (reveal all documents)

```typescript
permissions: {
  visibility: (doc, peer) => {
    // Storage always sees everything
    if (peer.channelKind === "storage") return true;

    // Network peers only see public documents
    return doc.id.startsWith("public/");
  };
}
```

**Use cases:**

- Multi-tenant isolation (only reveal tenant's documents)
- Public/private document separation
- Role-based document visibility

**Important:** If a peer already knows about a document (e.g., they created it), `visibility` has no effect. It only controls the initial announcement.

### 2. `mutability`

**When called:** Every time a sync message is received from a peer.

**Purpose:** Determines if we accept updates from this peer for this document.

**Default:** `true` (accept all updates)

```typescript
permissions: {
  mutability: (doc, peer) => {
    // Always accept from storage
    if (peer.channelKind === "storage") return true;

    // Only accept from users, not bots
    return peer.peerType === "user";
  };
}
```

**Use cases:**

- Read-only documents for certain peers
- Prevent bot modifications
- Implement approval workflows

### 3. `deletion`

**When called:** When a peer requests to delete a document.

**Purpose:** Controls who can delete documents.

**Default:** `true` (allow all deletions)

```typescript
permissions: {
  deletion: (doc, peer) => {
    // Only services can delete documents
    return peer.peerType === "service";
  };
}
```

**Use cases:**

- Prevent accidental deletion
- Admin-only deletion
- Soft-delete patterns (reject delete, mark as deleted in document)

### 4. `creation`

**When called:** When a peer requests a document that doesn't exist locally.

**Purpose:** Controls who can create new documents.

**Default:** `true` (allow all creation)

**Note:** This permission receives `(docId, peer)` since the document doesn't exist yet.

```typescript
permissions: {
  creation: (docId, peer) => {
    // Only users can create documents
    return peer.peerType === "user";
  };
}
```

**Use cases:**

- Prevent unauthorized document creation
- Validate document IDs before creation
- Implement document quotas

## Common Patterns

### Multi-Tenant Isolation

```typescript
const tenantId = "tenant-123";

const repo = new Repo({
  permissions: {
    visibility: (doc, peer) => {
      // Storage sees everything
      if (peer.channelKind === "storage") return true;
      // Network peers only see their tenant's documents
      return doc.id.startsWith(`${tenantId}/`);
    },
    mutability: (doc, peer) => {
      // Only accept updates for our tenant's documents
      return doc.id.startsWith(`${tenantId}/`);
    },
    creation: (docId, peer) => {
      // Only create documents in our tenant namespace
      return docId.startsWith(`${tenantId}/`);
    },
  },
});
```

### Read-Only for Network Peers

```typescript
const repo = new Repo({
  permissions: {
    mutability: (doc, peer) => {
      // Storage can always update (for persistence)
      if (peer.channelKind === "storage") return true;
      // Network peers are read-only
      return false;
    },
  },
});
```

### Server-Authoritative with RPC (Split Documents)

When using Asks RPC, you may need clients to write to the RPC queue but not to authoritative data. Split into separate documents:

```typescript
// Server
const repo = new Repo({
  identity: { name: "server", type: "service" },
  permissions: {
    mutability: (doc, peer) => {
      // Authoritative data is server-only
      if (doc.id === "authoritative-data") {
        return peer.channelKind === "storage";
      }
      // RPC document is client-writable
      return true;
    },
  },
});

// Two handles for different purposes
const rpcHandle = repo.get("rpc-queue", RpcDocSchema, EphemeralDeclarations);
const dataHandle = repo.get("authoritative-data", DataDocSchema);
```

**Why split documents?**
- Permissions operate at the document level, not field level
- Clients need to write to RPC queue to ask questions
- Server needs exclusive write access to authoritative data
- Server restart = clean authoritative state (no stale client data)

See `examples/username-claimer` for a complete implementation.

### Public/Private Documents

```typescript
const repo = new Repo({
  permissions: {
    visibility: (doc, peer) => {
      if (peer.channelKind === "storage") return true;

      // Public documents are visible to everyone
      if (doc.id.startsWith("public/")) return true;

      // Private documents only visible to specific peers
      const allowedPeers = getDocumentAllowedPeers(doc.id);
      return allowedPeers.includes(peer.peerId);
    },
  },
});
```

### Bot Restrictions

```typescript
const repo = new Repo({
  permissions: {
    mutability: (doc, peer) => {
      // Bots can only update documents they created
      if (peer.peerType === "bot") {
        return doc.id.startsWith(`bot-${peer.peerId}/`);
      }
      return true;
    },
    deletion: (doc, peer) => {
      // Bots cannot delete documents
      return peer.peerType !== "bot";
    },
  },
});
```

### Server-Side Validation

```typescript
// Server repo with strict permissions
const serverRepo = new Repo({
  identity: { name: "server", type: "service" },
  permissions: {
    creation: (docId, peer) => {
      // Validate document ID format
      const validFormat = /^[a-z0-9-]+\/[a-z0-9-]+$/.test(docId);
      if (!validFormat) return false;

      // Check user quota
      const userDocCount = getUserDocumentCount(peer.peerId);
      return userDocCount < 100;
    },
    mutability: (doc, peer) => {
      // Validate peer has write access
      return hasWriteAccess(peer.peerId, doc.id);
    },
  },
});
```

## Storage vs Network Permissions

A common pattern is to treat storage and network channels differently:

```typescript
const repo = new Repo({
  permissions: {
    // Storage sees all documents
    visibility: (doc, peer) => {
      if (peer.channelKind === "storage") return true;
      return isPublicDocument(doc.id);
    },

    // Storage always accepts updates (for persistence)
    mutability: (doc, peer) => {
      if (peer.channelKind === "storage") return true;
      return hasWritePermission(peer.peerId, doc.id);
    },
  },
});
```

## Default Behavior

If you don't specify permissions, all operations are allowed:

```typescript
// These are equivalent:
const repo1 = new Repo({ adapters: [...] })

const repo2 = new Repo({
  adapters: [...],
  permissions: {
    visibility: () => true,
    mutability: () => true,
    deletion: () => true,
    creation: () => true,
  },
})
```

## Partial Permissions

You can specify only the permissions you need:

```typescript
const repo = new Repo({
  permissions: {
    // Only override visibility, others use defaults
    visibility: (doc, peer) => doc.id.startsWith("public/"),
  },
});
```

## Testing Permissions

Permissions are pure functions, making them easy to test:

```typescript
import { describe, it, expect } from "vitest";

const permissions = {
  visibility: (doc, peer) => doc.id.startsWith("public/"),
};

describe("visibility", () => {
  it("allows public documents", () => {
    const doc = { id: "public/doc-1", loroDoc: {} };
    const peer = { channelKind: "network", peerType: "user" };
    expect(permissions.visibility(doc, peer)).toBe(true);
  });

  it("denies private documents", () => {
    const doc = { id: "private/doc-1", loroDoc: {} };
    const peer = { channelKind: "network", peerType: "user" };
    expect(permissions.visibility(doc, peer)).toBe(false);
  });
});
```

## Middleware for Advanced Use Cases

For advanced access control scenarios that require async operations, external service calls, or cross-cutting concerns like rate limiting and audit logging, use **middleware** instead of permissions.

See [Middleware](./middleware.md) for details.

## Related Documentation

- [Middleware](./middleware.md) - Async access control and cross-cutting concerns
- [Repo Architecture](./repo-architecture.md) - How permissions fit into the sync system
- [Discovery and Sync](./discovery-and-sync-architecture.md) - Detailed sync protocol
- [Creating Adapters](./creating-adapters.md) - How adapters interact with permissions
