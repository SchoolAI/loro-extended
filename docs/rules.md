# Rules System

The Rules system in Loro Extended provides fine-grained access control for document synchronization. Rules determine what documents can be shared, who can update them, and how sync behaves across different channels.

## Overview

Rules are functions that receive a `RuleContext` and return a boolean. They're evaluated at key points during synchronization to control data flow.

```typescript
import { Repo } from "@loro-extended/repo"

const repo = new Repo({
  identity: { name: "user-1", type: "user" },
  adapters: [...],
  rules: {
    canReveal: (ctx) => ctx.docId.startsWith("public-"),
    canUpdate: (ctx) => ctx.peerType !== "bot",
    // ... other rules
  },
})
```

## Rule Context

Every rule receives a `RuleContext` object with information about the current operation:

```typescript
type RuleContext = {
  doc: LoroDoc           // The document being operated on
  docId: DocId           // Document identifier
  peerId: PeerID         // Unique identifier for the peer
  peerName?: string      // Human-readable name (optional)
  peerType: "user" | "bot" | "service"  // Type of peer
  channelId: ChannelId   // Channel identifier
  channelKind: "storage" | "network" | "other"  // Type of channel
}
```

## The Five Rules

### 1. `canBeginSync`

**When called:** Immediately after a channel is established.

**Purpose:** Determines if we should proactively request sync from this peer.

**Default:** `true` (always begin sync)

```typescript
rules: {
  canBeginSync: (ctx) => {
    // Only begin sync with storage adapters automatically
    // Network peers must request sync first
    return ctx.channelKind === "storage"
  }
}
```

**Use cases:**
- Delay sync until authentication is complete
- Prioritize storage loading before network sync
- Implement lazy loading patterns

### 2. `canReveal`

**When called:** When announcing documents to a peer, either on connection or when a new document is created.

**Purpose:** Controls whether a peer learns about a document's existence.

**Default:** `true` (reveal all documents)

```typescript
rules: {
  canReveal: (ctx) => {
    // Storage always sees everything
    if (ctx.channelKind === "storage") return true
    
    // Network peers only see public documents
    return ctx.docId.startsWith("public-")
  }
}
```

**Use cases:**
- Multi-tenant isolation (only reveal tenant's documents)
- Public/private document separation
- Role-based document visibility

**Important:** If a peer already knows about a document (e.g., they created it), `canReveal` has no effect. It only controls the initial announcement.

### 3. `canUpdate`

**When called:** Every time a sync message is received from a peer.

**Purpose:** Determines if we accept updates from this peer for this document.

**Default:** `true` (accept all updates)

```typescript
rules: {
  canUpdate: (ctx) => {
    // Always accept from storage
    if (ctx.channelKind === "storage") return true
    
    // Only accept from users, not bots
    return ctx.peerType === "user"
  }
}
```

**Use cases:**
- Read-only documents for certain peers
- Prevent bot modifications
- Implement approval workflows

### 4. `canDelete`

**When called:** When a peer requests to delete a document.

**Purpose:** Controls who can delete documents.

**Default:** `true` (allow all deletions)

```typescript
rules: {
  canDelete: (ctx) => {
    // Only services can delete documents
    return ctx.peerType === "service"
  }
}
```

**Use cases:**
- Prevent accidental deletion
- Admin-only deletion
- Soft-delete patterns (reject delete, mark as deleted in document)

### 5. `canCreate`

**When called:** When a peer requests a document that doesn't exist locally.

**Purpose:** Controls who can create new documents.

**Default:** `true` (allow all creation)

**Note:** This rule receives `Omit<RuleContext, "doc">` since the document doesn't exist yet.

```typescript
rules: {
  canCreate: (ctx) => {
    // Only users can create documents
    return ctx.peerType === "user"
  }
}
```

**Use cases:**
- Prevent unauthorized document creation
- Validate document IDs before creation
- Implement document quotas

## Common Patterns

### Multi-Tenant Isolation

```typescript
const tenantId = "tenant-123"

const repo = new Repo({
  rules: {
    canReveal: (ctx) => {
      // Storage sees everything
      if (ctx.channelKind === "storage") return true
      // Network peers only see their tenant's documents
      return ctx.docId.startsWith(`${tenantId}/`)
    },
    canUpdate: (ctx) => {
      // Only accept updates for our tenant's documents
      return ctx.docId.startsWith(`${tenantId}/`)
    },
    canCreate: (ctx) => {
      // Only create documents in our tenant namespace
      return ctx.docId.startsWith(`${tenantId}/`)
    },
  },
})
```

### Read-Only for Network Peers

```typescript
const repo = new Repo({
  rules: {
    canUpdate: (ctx) => {
      // Storage can always update (for persistence)
      if (ctx.channelKind === "storage") return true
      // Network peers are read-only
      return false
    },
  },
})
```

### Public/Private Documents

```typescript
const repo = new Repo({
  rules: {
    canReveal: (ctx) => {
      if (ctx.channelKind === "storage") return true
      
      // Public documents are visible to everyone
      if (ctx.docId.startsWith("public/")) return true
      
      // Private documents only visible to specific peers
      const allowedPeers = getDocumentAllowedPeers(ctx.docId)
      return allowedPeers.includes(ctx.peerId)
    },
  },
})
```

### Bot Restrictions

```typescript
const repo = new Repo({
  rules: {
    canUpdate: (ctx) => {
      // Bots can only update documents they created
      if (ctx.peerType === "bot") {
        return ctx.docId.startsWith(`bot-${ctx.peerId}/`)
      }
      return true
    },
    canDelete: (ctx) => {
      // Bots cannot delete documents
      return ctx.peerType !== "bot"
    },
  },
})
```

### Server-Side Validation

```typescript
// Server repo with strict rules
const serverRepo = new Repo({
  identity: { name: "server", type: "service" },
  rules: {
    canCreate: (ctx) => {
      // Validate document ID format
      const validFormat = /^[a-z0-9-]+\/[a-z0-9-]+$/.test(ctx.docId)
      if (!validFormat) return false
      
      // Check user quota
      const userDocCount = getUserDocumentCount(ctx.peerId)
      return userDocCount < 100
    },
    canUpdate: (ctx) => {
      // Validate peer has write access
      return hasWriteAccess(ctx.peerId, ctx.docId)
    },
  },
})
```

## Storage vs Network Rules

A common pattern is to treat storage and network channels differently:

```typescript
const repo = new Repo({
  rules: {
    // Storage always participates in sync
    canBeginSync: (ctx) => ctx.channelKind === "storage",
    
    // Storage sees all documents
    canReveal: (ctx) => {
      if (ctx.channelKind === "storage") return true
      return isPublicDocument(ctx.docId)
    },
    
    // Storage always accepts updates (for persistence)
    canUpdate: (ctx) => {
      if (ctx.channelKind === "storage") return true
      return hasWritePermission(ctx.peerId, ctx.docId)
    },
  },
})
```

## Default Behavior

If you don't specify rules, all operations are allowed:

```typescript
// These are equivalent:
const repo1 = new Repo({ adapters: [...] })

const repo2 = new Repo({
  adapters: [...],
  rules: {
    canBeginSync: () => true,
    canReveal: () => true,
    canUpdate: () => true,
    canDelete: () => true,
    canCreate: () => true,
  },
})
```

## Partial Rules

You can specify only the rules you need:

```typescript
const repo = new Repo({
  rules: {
    // Only override canReveal, others use defaults
    canReveal: (ctx) => ctx.docId.startsWith("public-"),
  },
})
```

## Testing Rules

Rules are pure functions, making them easy to test:

```typescript
import { describe, it, expect } from "vitest"

const rules = {
  canReveal: (ctx) => ctx.docId.startsWith("public-"),
}

describe("canReveal", () => {
  it("allows public documents", () => {
    const ctx = {
      docId: "public-doc-1",
      channelKind: "network",
      // ... other context
    }
    expect(rules.canReveal(ctx)).toBe(true)
  })

  it("denies private documents", () => {
    const ctx = {
      docId: "private-doc-1",
      channelKind: "network",
      // ... other context
    }
    expect(rules.canReveal(ctx)).toBe(false)
  })
})
```

## Related Documentation

- [Repo Architecture](./repo-architecture.md) - How rules fit into the sync system
- [Discovery and Sync](./discovery-and-sync-architecture.md) - Detailed sync protocol
- [Creating Adapters](./creating-adapters.md) - How adapters interact with rules
