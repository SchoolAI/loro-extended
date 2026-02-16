# Bumper Cars App FC/IS Refactoring Plan

## Background

The `bumper-cars-app.tsx` component is the main client-side entry point for the bumper cars multiplayer game. It currently mixes pure data transformations with React hooks and side effects, making it harder to test, understand, and maintain.

The file contains several sequential `useMemo` chains that transform presence data (allPresence → serverPresence → clientPresences), inline score sorting, and throttled presence update logic embedded directly in a `useEffect`. These are opportunities to apply the Functional Core / Imperative Shell (FC/IS) principle.

Additionally, there is a bug on line 177 where `snapshot.scores` is referenced but the variable is named `scores`.

## Problem Statement

1. **Cognitive load**: Three chained `useMemo` calls (allPresence, serverPresence, clientPresences) obscure what is essentially a simple partition operation
2. **Untestable logic**: Throttling decision logic and data transformations are embedded in hooks, making them impossible to unit test in isolation
3. **Repeated patterns**: `ClientPresence` objects are constructed in 3 different places with the same shape
4. **Bug**: `snapshot.scores` should be `scores` on line 177

## Success Criteria

- [x] Pure transformation functions are extracted and unit tested
- [x] Component is shorter and reads more declaratively
- [x] Throttling logic is testable in isolation
- [x] The `snapshot.scores` bug is fixed
- [x] All existing functionality works identically
- [x] `pnpm turbo run verify --filter=example-bumper-cars` passes

## The Gap

| Current State | Target State |
|---------------|--------------|
| 3 chained useMemos for presence partitioning | 1 useMemo calling pure `partitionPresences()` |
| Inline score sorting | Pure `sortScores()` function |
| Inline throttle decision in useEffect | Pure `shouldSendPresenceUpdate()` + custom hook |
| 3 places constructing ClientPresence | Single `createClientPresence()` factory |
| Bug: `snapshot.scores` | Fixed: `scores` |

## Phases and Tasks

### Phase 1: Extract Pure Logic Module ✅

Created `src/client/logic.ts` with all pure functions:

- ✅ `partitionPresences(self, peers, myPeerId)` - returns `{ serverPresence, clientPresences }`
- ✅ `getActivePlayers(clientPresences)` - returns player list for PlayerList component
- ✅ `createClientPresence(name, color, input)` - factory function
- ✅ `sortScores(scores, limit)` - sorts and limits scores for Scoreboard
- ✅ `combineInputs(joystickInput, keyboardInput)` - joystick takes priority
- ✅ `shouldSendPresenceUpdate(current, last, lastTime, now, throttleMs)` - throttling decision
- ✅ `ZERO_INPUT` constant for default input state

### Phase 2: Add Unit Tests ✅

Created `src/client/logic.test.ts` with 37 tests covering:

- ✅ `partitionPresences` - null server, finds server among peers, collects clients, excludes null, mixed types
- ✅ `getActivePlayers` - maps to player list format, empty input
- ✅ `createClientPresence` - correct shape construction
- ✅ `sortScores` - sorts descending, respects limit, handles empty, preserves properties
- ✅ `combineInputs` - joystick priority, keyboard fallback, edge cases
- ✅ `shouldSendPresenceUpdate` - unchanged input, immediate stop, throttling behavior, change detection

### Phase 3: Create Custom Hook for Throttled Presence ✅

Created `src/client/hooks/use-presence-sender.ts`:

- ✅ `usePresenceSender({ doc, hasJoined, playerName, playerColor, input })` hook
- ✅ Encapsulates refs for last sent input and last update time
- ✅ Uses pure `shouldSendPresenceUpdate()` for decision logic
- ✅ Uses `createClientPresence()` factory

### Phase 4: Refactor Component ✅

Updated `src/client/bumper-cars-app.tsx`:

- ✅ Fixed `snapshot.scores` → `scores` bug
- ✅ Replaced 3 presence useMemos with single call to `partitionPresences()`
- ✅ Replaced inline score sorting with `sortScores()`
- ✅ Replaced inline input combination with `combineInputs()`
- ✅ Replaced presence update effect with `usePresenceSender()` hook
- ✅ Used `createClientPresence()` in handleJoin and handleLeave
- ✅ Removed unused imports (useRef, PeerID, ClientPresence, ServerPresence)

### Phase 5: Verification ✅

- ✅ `pnpm turbo run verify --filter=example-bumper-cars` passes (format, types, 37 tests)

## Summary of Changes

### Files Created
- `src/client/logic.ts` - Pure functional core (190 lines)
- `src/client/logic.test.ts` - Unit tests (440 lines, 37 tests)
- `src/client/hooks/use-presence-sender.ts` - Custom hook (70 lines)

### Files Modified
- `src/client/bumper-cars-app.tsx` - Refactored to use pure functions and custom hook

### Lines of Code Comparison
- **Before**: ~220 lines in bumper-cars-app.tsx (mixed concerns)
- **After**: ~140 lines in bumper-cars-app.tsx + 190 lines in logic.ts + 70 lines in hook
- **Net**: More total lines, but better separated concerns and 37 new unit tests

### Key Improvements
1. **Testability**: All business logic is now pure and unit tested
2. **Readability**: Component reads declaratively - "partition presences", "combine inputs", "sort scores"
3. **Single Responsibility**: Pure logic in `logic.ts`, hook concerns in `use-presence-sender.ts`, wiring in component
4. **Bug Fix**: `snapshot.scores` bug fixed

## Transitive Effect Analysis

| Changed Module | Direct Dependents | Impact |
|----------------|-------------------|--------|
| `bumper-cars-app.tsx` | `main.tsx` | No API change, safe |
| New `logic.ts` | `bumper-cars-app.tsx`, `use-presence-sender.ts`, `logic.test.ts` | New dependency, addition only |
| New `use-presence-sender.ts` | `bumper-cars-app.tsx` | New dependency, addition only |

No breaking changes to external APIs. All changes are internal refactoring.

## Resources for Implementation Context

- `loro-extended/examples/bumper-cars/src/client/bumper-cars-app.tsx` - main file being refactored
- `loro-extended/examples/bumper-cars/src/shared/types.ts` - type definitions (PeerID, ClientPresence, ServerPresence, InputState, PlayerScore)
- `loro-extended/examples/bumper-cars/src/client/hooks/use-joystick.ts` - pattern for hooks in this codebase
- `loro-extended/examples/bumper-cars/src/client/hooks/use-keyboard-input.ts` - pattern for hooks in this codebase

## Documentation Updates

No high-level public changes; no README update needed.

No architectural shifts requiring TECHNICAL.md update - this is standard FC/IS application.