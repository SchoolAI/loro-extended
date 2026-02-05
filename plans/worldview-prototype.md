# Worldview Prototype Plan

## Background

The worldview simplification plan proposes using Loro's `subscribePreCommit` API to capture commit messages before they're applied, enabling users to call `change(worldview, fn, { commitMessage })` directly instead of a special `change(lens, fn)` function.

Before implementing the full plan, we need to validate three critical assumptions:
1. `subscribePreCommit` → `subscribe` message passing works reliably
2. Chained worldviews propagate messages correctly
3. Re-entrancy scenarios are handled properly

## Problem Statement

The proposed architecture relies on subscription timing that hasn't been empirically verified. A prototype will:
1. Prove the `subscribePreCommit` → `subscribe` pattern works
2. Identify any edge cases or timing issues
3. Inform the final implementation design

## Success Criteria

1. ✅ Prototype demonstrates message capture via `subscribePreCommit`
2. ✅ Prototype demonstrates message propagation to world via `subscribe`
3. ✅ Prototype demonstrates chained worldviews with message flow
4. ✅ Prototype demonstrates re-entrancy handling
5. ✅ All prototype tests pass
6. ✅ Decision made: proceed with full implementation or revise approach

## The Gap

| Current State | Target State |
|---------------|--------------|
| Theoretical design | Empirically validated design |
| Untested assumptions | Proven patterns |
| Unknown edge cases | Documented edge cases |

## Phases and Tasks

### Phase 1: Create Prototype Test File 🔴

- 🔴 **Task 1.1**: Create `packages/lens/src/worldview-prototype.test.ts`
- 🔴 **Task 1.2**: Import necessary dependencies from loro-crdt and @loro-extended/change
- 🔴 **Task 1.3**: Create minimal test schema (counter + text)

### Phase 2: Test subscribePreCommit → subscribe Pattern 🔴

- 🔴 **Task 2.1**: Test that `subscribePreCommit` fires before `subscribe`
- 🔴 **Task 2.2**: Test that commit message is accessible in `subscribePreCommit`
- 🔴 **Task 2.3**: Test that captured message can be used in `subscribe` callback
- 🔴 **Task 2.4**: Test that message is correctly applied to world via `setNextCommitMessage`

### Phase 3: Test Chained Worldviews 🔴

- 🔴 **Task 3.1**: Create two-level chain (world → wv1 → wv2)
- 🔴 **Task 3.2**: Test message propagation from wv2 to world
- 🔴 **Task 3.3**: Test that intermediate worldview (wv1) correctly relays message
- 🔴 **Task 3.4**: Create three-level chain and verify end-to-end message flow

### Phase 4: Test Re-entrancy Scenarios 🔴

- 🔴 **Task 4.1**: Test `change()` called inside `subscribe` callback
- 🔴 **Task 4.2**: Test multiple nested `change()` calls
- 🔴 **Task 4.3**: Test `change()` called inside `subscribePreCommit` callback
- 🔴 **Task 4.4**: Test re-entrancy in chained worldviews

### Phase 5: Analyze Results and Decide 🔴

- 🔴 **Task 5.1**: Document any failures or unexpected behavior
- 🔴 **Task 5.2**: Identify necessary adjustments to the design
- 🔴 **Task 5.3**: Update worldview-simplification.md with findings
- 🔴 **Task 5.4**: Make go/no-go decision for full implementation

## Tests

### Test Structure

```typescript
// packages/lens/src/worldview-prototype.test.ts

import { describe, it, expect } from "vitest"
import { LoroDoc } from "loro-crdt"
import { createTypedDoc, Shape, change, loro } from "@loro-extended/change"

const TestSchema = Shape.doc({
  counter: Shape.counter(),
  text: Shape.text(),
})

describe("worldview prototype", () => {
  describe("subscribePreCommit → subscribe pattern", () => {
    it("subscribePreCommit fires before subscribe")
    it("commit message is accessible in subscribePreCommit")
    it("captured message can be used in subscribe callback")
    it("message is correctly applied to world")
  })

  describe("chained worldviews", () => {
    it("two-level chain propagates message to world")
    it("three-level chain propagates message to world")
  })

  describe("re-entrancy", () => {
    it("handles change() inside subscribe callback")
    it("handles multiple nested change() calls")
    it("handles change() inside subscribePreCommit callback")
    it("handles re-entrancy in chained worldviews")
  })
})
```

### Critical Test: Message Capture Pattern

```typescript
it("captured message can be used in subscribe callback", () => {
  const world = new LoroDoc()
  const worldview = world.fork()
  worldview.setPeerId(world.peerId)
  
  let capturedMessage: string | undefined
  let propagatedMessage: string | undefined
  
  // Capture message before commit
  worldview.subscribePreCommit((e) => {
    capturedMessage = e.changeMeta.message
  })
  
  // Propagate after commit
  worldview.subscribe((event) => {
    if (event.by === "local") {
      const frontiers = worldview.frontiers()
      const diff = worldview.diff([], frontiers, false)
      world.applyDiff(diff)
      if (capturedMessage) {
        world.setNextCommitMessage(capturedMessage)
      }
      world.commit()
      
      // Verify message reached world
      const worldFrontiers = world.frontiers()
      const changes = world.exportJsonInIdSpan({
        peer: worldFrontiers[0].peer,
        counter: 0,
        length: worldFrontiers[0].counter + 1,
      })
      propagatedMessage = changes[changes.length - 1]?.msg ?? undefined
    }
  })
  
  // Make change with message
  worldview.getCounter("counter").increment(1)
  worldview.setNextCommitMessage("test-message")
  worldview.commit()
  
  expect(capturedMessage).toBe("test-message")
  expect(propagatedMessage).toBe("test-message")
})
```

### Critical Test: Chained Worldviews

```typescript
it("three-level chain propagates message to world", () => {
  const world = new LoroDoc()
  
  // Create chain: world → wv1 → wv2
  const wv1 = world.fork()
  wv1.setPeerId(world.peerId)
  
  const wv2 = wv1.fork()
  wv2.setPeerId(wv1.peerId)
  
  // Set up message capture and propagation for each level
  let wv2Message: string | undefined
  let wv1Message: string | undefined
  
  wv2.subscribePreCommit((e) => {
    wv2Message = e.changeMeta.message
  })
  
  wv2.subscribe((event) => {
    if (event.by === "local") {
      const diff = wv2.diff([], wv2.frontiers(), false)
      wv1.applyDiff(diff)
      if (wv2Message) {
        wv1.setNextCommitMessage(wv2Message)
      }
      wv1.commit()
    }
  })
  
  wv1.subscribePreCommit((e) => {
    wv1Message = e.changeMeta.message
  })
  
  wv1.subscribe((event) => {
    if (event.by === "local") {
      const diff = wv1.diff([], wv1.frontiers(), false)
      world.applyDiff(diff)
      if (wv1Message) {
        world.setNextCommitMessage(wv1Message)
      }
      world.commit()
    }
  })
  
  // Make change at wv2 with message
  wv2.getCounter("counter").increment(1)
  wv2.setNextCommitMessage("chained-message")
  wv2.commit()
  
  // Verify message reached world
  const worldFrontiers = world.frontiers()
  const changes = world.exportJsonInIdSpan({
    peer: worldFrontiers[0].peer,
    counter: 0,
    length: worldFrontiers[0].counter + 1,
  })
  
  expect(changes[changes.length - 1]?.msg).toBe("chained-message")
})
```

### Critical Test: Re-entrancy

```typescript
it("handles change() inside subscribe callback", () => {
  const world = new LoroDoc()
  const worldview = world.fork()
  worldview.setPeerId(world.peerId)
  
  let isProcessing = false
  let reacted = false
  
  worldview.subscribe((event) => {
    if (event.by === "local" && !isProcessing) {
      isProcessing = true
      
      // Propagate to world
      const diff = worldview.diff([], worldview.frontiers(), false)
      world.applyDiff(diff)
      world.commit()
      
      // Re-entrant change
      if (!reacted) {
        reacted = true
        worldview.getText("text").insert(0, "reacted")
        worldview.commit()
      }
      
      isProcessing = false
    }
  })
  
  worldview.getCounter("counter").increment(1)
  worldview.commit()
  
  expect(world.getCounter("counter").value).toBe(1)
  expect(world.getText("text").toString()).toBe("reacted")
})
```

## Transitive Effect Analysis

This is a prototype - no transitive effects on production code.

| Affected | Impact |
|----------|--------|
| Production code | None (prototype only) |
| Test suite | New test file added |
| Documentation | Findings will update worldview-simplification.md |

## Deliverables

1. `packages/lens/src/worldview-prototype.test.ts` - Prototype tests
2. Updated `plans/worldview-simplification.md` - With findings and decision
3. Go/no-go decision for full implementation

## Decision Criteria

**Proceed with full implementation if:**
- All prototype tests pass
- No unexpected timing issues discovered
- Re-entrancy can be handled with simple `isProcessing` flag

**Revise approach if:**
- Message capture fails in chained scenarios
- Re-entrancy requires complex queue-based handling
- Subscription ordering is unreliable
