# Middleware System

Middleware in Loro Extended provides a way to implement advanced access control and cross-cutting concerns that require async operations, external service calls, or complex logic.

## When to Use Middleware vs Permissions

| Use Case               | Permissions | Middleware |
| ---------------------- | ----------- | ---------- |
| Simple boolean checks  | ✅          | ❌         |
| Sync operations        | ✅          | ✅         |
| Async operations       | ❌          | ✅         |
| External auth services | ❌          | ✅         |
| Rate limiting          | ❌          | ✅         |
| Audit logging          | ❌          | ✅         |
| Size/quota limits      | ❌          | ✅         |

**Rule of thumb:** Use permissions for simple, synchronous checks. Use middleware for anything that needs async operations or has side effects.

## Overview

Middleware runs at the async boundary, BEFORE the synchronizer processes incoming messages. This allows middleware to:

1. Reject messages before they're processed
2. Call external services (auth, rate limiting)
3. Log/audit operations
4. Enforce quotas and limits

```typescript
import { Repo, type Middleware } from "@loro-extended/repo"

const rateLimiter: Middleware = {
  name: "rate-limiter",
  requires: ["peer"],
  check: async (ctx) => {
    const count = await getRequestCount(ctx.peer.peerId)
    if (count >= 100) {
      return { allow: false, reason: "rate-limited" }
    }
    return { allow: true }
  }
}

const repo = new Repo({
  identity: { name: "server", type: "service" },
  adapters: [...],
  middleware: [rateLimiter],
})
```

## Middleware Interface

```typescript
interface Middleware {
  /** Human-readable name for logging */
  name: string;

  /** What context this middleware needs */
  requires: Array<"peer" | "document" | "transmission">;

  /** The check function - can be sync or async */
  check: (
    ctx: MiddlewareContext
  ) => MiddlewareResult | Promise<MiddlewareResult>;
}

type MiddlewareResult = { allow: true } | { allow: false; reason: string };
```

## Middleware Context

The context provided to middleware depends on what's available at the time:

```typescript
type MiddlewareContext = {
  /** The incoming message */
  message: ChannelMsg;

  /** Peer information (always available for established channels) */
  peer?: {
    peerId: PeerID;
    peerName?: string;
    peerType: "user" | "bot" | "service";
    channelId: ChannelId;
    channelKind: "storage" | "network" | "other";
  };

  /** Document information (available for doc-specific messages) */
  document?: {
    id: DocId;
    loroDoc: LoroDoc;
  };

  /** Transmission data (available for sync messages) */
  transmission?: {
    type: "snapshot" | "update" | "up-to-date" | "unavailable";
    dataSize?: number;
  };
};
```

## Common Middleware Patterns

### Rate Limiting

```typescript
const rateLimiter: Middleware = {
  name: "rate-limiter",
  requires: ["peer"],
  check: async (ctx) => {
    const key = `rate:${ctx.peer.peerId}`;
    const count = await redis.incr(key);

    if (count === 1) {
      await redis.expire(key, 60); // 1 minute window
    }

    if (count > 100) {
      return { allow: false, reason: "Rate limit exceeded (100/min)" };
    }

    return { allow: true };
  },
};
```

### Size Limits

```typescript
const sizeLimit: Middleware = {
  name: "size-limit",
  requires: ["transmission"],
  check: (ctx) => {
    if (ctx.transmission?.dataSize && ctx.transmission.dataSize > 10_000_000) {
      return { allow: false, reason: "Payload too large (max 10MB)" };
    }
    return { allow: true };
  },
};
```

### External Auth Service

```typescript
const authMiddleware: Middleware = {
  name: "external-auth",
  requires: ["peer", "document"],
  check: async (ctx) => {
    const hasAccess = await authService.checkAccess({
      userId: ctx.peer.peerId,
      resourceId: ctx.document.id,
      action: "write",
    });

    if (!hasAccess) {
      return { allow: false, reason: "Access denied by auth service" };
    }

    return { allow: true };
  },
};
```

### Audit Logging

```typescript
const auditLogger: Middleware = {
  name: "audit-logger",
  requires: ["peer", "document"],
  check: async (ctx) => {
    // Log the operation (always allow, just for logging)
    await auditLog.record({
      timestamp: new Date(),
      peerId: ctx.peer.peerId,
      peerName: ctx.peer.peerName,
      documentId: ctx.document?.id,
      messageType: ctx.message.type,
    });

    return { allow: true };
  },
};
```

### Document Quota

```typescript
const quotaMiddleware: Middleware = {
  name: "document-quota",
  requires: ["peer"],
  check: async (ctx) => {
    // Only check for sync-request (document creation)
    if (ctx.message.type !== "channel/sync-request") {
      return { allow: true };
    }

    const docCount = await db.countDocuments(ctx.peer.peerId);
    if (docCount >= 100) {
      return { allow: false, reason: "Document quota exceeded (max 100)" };
    }

    return { allow: true };
  },
};
```

### IP-Based Restrictions

```typescript
const ipRestriction: Middleware = {
  name: "ip-restriction",
  requires: ["peer"],
  check: async (ctx) => {
    const ip = await getIpForPeer(ctx.peer.peerId);
    const isBlocked = await ipBlocklist.check(ip);

    if (isBlocked) {
      return { allow: false, reason: "IP address blocked" };
    }

    return { allow: true };
  },
};
```

## Middleware Execution Order

Middleware runs in the order specified in the array. If any middleware rejects, subsequent middleware is not executed:

```typescript
const repo = new Repo({
  middleware: [
    rateLimiter, // Runs first
    authMiddleware, // Runs second (if rate limiter allows)
    auditLogger, // Runs third (if auth allows)
  ],
});
```

## Combining Permissions and Middleware

Permissions and middleware work together:

1. **Middleware** runs first (async, at message receive boundary)
2. **Permissions** run during synchronizer processing (sync, in TEA update)

```typescript
const repo = new Repo({
  // Middleware for async/external checks
  middleware: [rateLimiter, externalAuth],

  // Permissions for simple sync checks
  permissions: {
    visibility: (doc, peer) => doc.id.startsWith("public/"),
    mutability: (doc, peer) => peer.peerType !== "bot",
  },
});
```

## Error Handling

Middleware errors are logged but don't crash the system. If a middleware throws, the message is rejected:

```typescript
const flakyMiddleware: Middleware = {
  name: "flaky",
  requires: [],
  check: async () => {
    throw new Error("Service unavailable");
    // Message will be rejected, error logged
  },
};
```

## Testing Middleware

Middleware can be tested in isolation:

```typescript
import { describe, it, expect, vi } from "vitest";

describe("rate-limiter middleware", () => {
  it("allows requests under limit", async () => {
    const redis = { incr: vi.fn().mockResolvedValue(50) };
    const middleware = createRateLimiter(redis);

    const result = await middleware.check({
      message: { type: "channel/sync-request" },
      peer: { peerId: "user-1" },
    });

    expect(result.allow).toBe(true);
  });

  it("rejects requests over limit", async () => {
    const redis = { incr: vi.fn().mockResolvedValue(101) };
    const middleware = createRateLimiter(redis);

    const result = await middleware.check({
      message: { type: "channel/sync-request" },
      peer: { peerId: "user-1" },
    });

    expect(result.allow).toBe(false);
    expect(result.reason).toContain("rate");
  });
});
```

## Related Documentation

- [Permissions](./permissions.md) - Simple, synchronous access control
- [Repo Architecture](./repo-architecture.md) - How middleware fits into the sync system
- [Creating Adapters](./creating-adapters.md) - How adapters interact with middleware
