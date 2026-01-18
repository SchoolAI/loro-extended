# @loro-extended/askforce

P2P-native work exchange pattern using the question/answer metaphor.

## Overview

Askforce provides a type-safe, composable pattern for P2P work exchange that:

- Leverages CRDT primitives for coordination (not reinventing them)
- Supports multiple independent queues per document
- Uses staggered claiming in Pool mode to minimize duplicate work
- Provides explicit mode selection (RPC vs. Pool) for predictable behavior

## Installation

```bash
pnpm add @loro-extended/askforce
```

## Quick Start

```typescript
import { Askforce, createAskforceSchema } from "@loro-extended/askforce"
import { Shape } from "@loro-extended/change"

// Define your question and answer schemas
const MyQueueSchema = createAskforceSchema(
  Shape.plain.struct({ query: Shape.plain.string() }),   // Question
  Shape.plain.struct({ result: Shape.plain.string() })   // Answer
)

// Create an Askforce instance
const askforce = new Askforce(
  recordRef,      // StructRef to the queue record
  ephemeral,      // TypedEphemeral for worker presence
  { 
    peerId: "peer-1", 
    mode: "rpc"   // or "pool"
  }
)

// Ask a question
const askId = askforce.ask({ query: "What is 2+2?" })

// Wait for an answer
const answer = await askforce.waitFor(askId)
console.log(answer.result) // "4"
```

## Modes

### RPC Mode

Use RPC mode when you have exactly one worker that will answer each question.

```typescript
const askforce = new Askforce(recordRef, ephemeral, {
  peerId: "client",
  mode: "rpc"
})
```

**Characteristics:**
- Assumes exactly one worker will answer each ask
- Handlers do NOT need to be idempotent
- `waitFor()` resolves as soon as any answer appears
- Best for: client-server patterns, request/response

### Pool Mode

Use Pool mode when multiple workers may process the same question.

```typescript
const askforce = new Askforce(recordRef, ephemeral, {
  peerId: "worker-1",
  mode: "pool"
})
```

**Characteristics:**
- Multiple workers may answer the same ask
- Handlers MUST be idempotent
- Uses staggered claiming to minimize duplicate work (see below)
- `waitFor()` uses `pickOne` aggregation by default
- Best for: distributed work queues, fan-out patterns

### Pool Mode Efficiency

In Pool mode, Askforce uses staggered claiming to minimize duplicate work:

1. Each ask has a deterministic "priority worker" based on the ask ID
2. The priority worker claims immediately
3. Other workers wait 500ms (configurable), then claim only if unclaimed

This means in the common case, only one worker processes each ask, while still
providing resilience if the priority worker is slow or unavailable.

Configure the claim window:

```typescript
const askforce = new Askforce(recordRef, ephemeral, {
  peerId: "worker-1",
  mode: "pool",
  claimWindowMs: 1000, // Wait 1 second before non-priority workers claim
})
```

## API

### `Askforce<Q, A>`

The main class for work exchange.

#### Constructor

```typescript
new Askforce<QuestionShape, AnswerShape>(
  recordRef: RecordRef<StructRef<any>>,
  ephemeral: TypedEphemeral<WorkerPresence>,
  options: {
    peerId: string
    mode: "rpc" | "pool"
    claimWindowMs?: number  // Pool mode only, default: 500
  }
)
```

#### Methods

- `ask(question: Q): string` - Ask a question, returns the ask ID
- `onAsk(handler, options?): () => void` - Subscribe to incoming asks
- `waitFor(askId, timeoutMs?): Promise<A>` - Wait for an answer
- `getStatus(askId): AskStatus` - Get the current status of an ask
- `allAnswers(askId): Array<{workerId, data, answeredAt}>` - Get all answers (Pool mode)
- `dispose(): void` - Clean up resources

### `createAskforceSchema<Q, A>(questionSchema, answerSchema)`

Factory function to create a typed Askforce schema.

```typescript
const schema = createAskforceSchema(
  Shape.plain.struct({ query: Shape.plain.string() }),
  Shape.plain.struct({ result: Shape.plain.string() })
)
```

## Worker Presence

Askforce uses EphemeralStore for worker presence and discovery.

```typescript
interface WorkerPresence {
  workerId: string
  activeAsks: string[]  // Ask IDs currently being processed
  lastHeartbeat: number
}
```

Workers automatically:
- Send heartbeats while processing asks
- Update their active asks list
- Clean up presence on dispose
- Discover other workers for priority calculation (Pool mode)

## Status Derivation

Ask status is derived from the answers map:

- `pending` - No answers yet
- `claimed` - At least one worker has claimed (status: "pending")
- `answered` - At least one worker has answered (status: "answered")
- `failed` - All workers have failed (status: "failed")

## Answer Schema

Worker answers use a discriminated union:

```typescript
type WorkerAnswer<T> =
  | { status: "pending"; claimedAt: number }
  | { status: "answered"; data: T; answeredAt: number }
  | { status: "failed"; reason: string; failedAt: number }
```

## License

MIT
