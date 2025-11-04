# Type-Safe Channel Messaging Implementation Plan

## Problem Statement

The current synchronizer protocol has a critical type safety gap: all channel messages (`ChannelMsg`) can be sent over any channel type, regardless of whether the channel is in the correct state to handle that message. This leads to several issues:

### Current Issues

1. **Runtime Protocol Violations**: Sync messages can be sent before establishment completes
2. **Difficult Debugging**: When messages fail, it's unclear if the channel state is wrong
3. **Implicit State Requirements**: Message handlers check `isEstablished()` at runtime, but nothing prevents sending messages to non-established channels
4. **Test Timeouts**: The current bridge adapter tests timeout at `waitForNetwork()` because messages may be sent to channels in the wrong state, causing the sync protocol to silently fail

### Channel State Progression

```
GeneratedChannel → ConnectedChannel → Channel
   (created)       (has channelId +    (has peerId)
                    onReceive)
```

### Message Type Requirements

| Message Type | Valid Channel State | Reason |
|-------------|-------------------|---------|
| `channel/establish-request` | `ConnectedChannel` only | Initiates establishment; sending to `Channel` is redundant |
| `channel/establish-response` | `ConnectedChannel` only | Completes establishment; sending to `Channel` is redundant |
| `channel/sync-request` | `Channel` only | Requires `peerId` for permissions/awareness |
| `channel/sync-response` | `Channel` only | Requires `peerId` for permissions/awareness |
| `channel/directory-request` | `Channel` only | Requires `peerId` for permissions |
| `channel/directory-response` | `Channel` only | Requires `peerId` for permissions |
| `channel/delete-request` | `Channel` only | Requires `peerId` for permissions |
| `channel/delete-response` | `Channel` only | Requires `peerId` for permissions |

## Proposed Solution: Separate Send Methods with Strong Typing

### Core Idea

Instead of a single `send(msg: ChannelMsg)` method that accepts any message, provide **type-specific send methods** that are only available when the channel is in the correct state.

### Type Definitions

```typescript
// In channel.ts

// Message type unions based on valid channel states
export type EstablishmentMsg =
  | ChannelMsgEstablishRequest
  | ChannelMsgEstablishResponse

export type EstablishedMsg =
  | ChannelMsgSyncRequest
  | ChannelMsgSyncResponse
  | ChannelMsgDirectoryRequest
  | ChannelMsgDirectoryResponse
  | ChannelMsgDeleteRequest
  | ChannelMsgDeleteResponse

// All messages (for generic handling)
export type ChannelMsg = EstablishmentMsg | EstablishedMsg

// Type predicates for runtime validation
export function isEstablishmentMsg(msg: ChannelMsg): msg is EstablishmentMsg {
  return msg.type === "channel/establish-request" 
      || msg.type === "channel/establish-response"
}

export function isEstablishedMsg(msg: ChannelMsg): msg is EstablishedMsg {
  return !isEstablishmentMsg(msg)
}
```

### Updated Channel Types

```typescript
export type ChannelActions = {
  // Generic send - kept for backward compatibility and internal use
  // Runtime validation should be added here
  send: (msg: ChannelMsg) => void
  stop: () => void
}

export type ConnectedChannel =
  & GeneratedChannel
  & {
      channelId: ChannelId
      onReceive: (msg: ChannelMsg) => void
      
      // Type-safe send for establishment phase
      sendEstablishment: (msg: EstablishmentMsg) => void
    }

export type Channel =
  & ConnectedChannel
  & {
      peerId: PeerId
      
      // Type-safe send for established channels
      sendEstablished: (msg: EstablishedMsg) => void
    }
```

### Implementation in Adapter.generate()

When an adapter generates a channel, it needs to provide implementations for all send methods:

```typescript
// In adapter.ts or bridge-adapter.ts

generate(context: BridgeAdapterContext): GeneratedChannel {
  const baseSend = (msg: ChannelMsg) => {
    context.send(msg)
  }
  
  const channel: GeneratedChannel = {
    adapterId: this.adapterId,
    kind: "network",
    
    // Generic send (with runtime validation)
    send: (msg: ChannelMsg) => {
      // Optional: Add runtime validation here
      baseSend(msg)
    },
    
    stop: () => {
      // Channel cleanup
    },
  }

  return channel
}
```

When the channel is connected (gets `channelId` and `onReceive`), add `sendEstablishment`:

```typescript
// In adapter.addChannel() or similar
const connectedChannel: ConnectedChannel = {
  ...generatedChannel,
  channelId: newChannelId,
  onReceive: (msg) => {
    // Handle received message
  },
  
  // Type-safe establishment send
  sendEstablishment: (msg: EstablishmentMsg) => {
    generatedChannel.send(msg)
  },
}
```

When the channel becomes established (gets `peerId`), add `sendEstablished`:

```typescript
// In synchronizer-program.ts when handling establish-request/response
const establishedChannel: Channel = {
  ...connectedChannel,
  peerId: identity.peerId,
  
  // Type-safe established send
  sendEstablished: (msg: EstablishedMsg) => {
    connectedChannel.send(msg)
  },
}
```

## Implementation Strategy

### Phase 1: Add Type Definitions (Non-Breaking)

1. Add `EstablishmentMsg` and `EstablishedMsg` unions to [`channel.ts`](../packages/repo/src/channel.ts)
2. Add type predicates `isEstablishmentMsg()` and `isEstablishedMsg()`
3. Export these for use in other modules

**Files to modify:**
- `packages/repo/src/channel.ts`

### Phase 2: Add Send Methods to Channel Types (Non-Breaking)

1. Add `sendEstablishment` to `ConnectedChannel` type
2. Add `sendEstablished` to `Channel` type
3. Keep existing `send` method for backward compatibility

**Files to modify:**
- `packages/repo/src/channel.ts`

### Phase 3: Implement Send Methods in Adapters

1. Update `Adapter.addChannel()` to provide `sendEstablishment` implementation
2. Update synchronizer-program to provide `sendEstablished` when channel becomes established
3. Ensure all adapters (BridgeAdapter, StorageAdapter, etc.) support the new methods

**Files to modify:**
- `packages/repo/src/adapter/adapter.ts`
- `packages/repo/src/adapter/bridge-adapter.ts`
- `packages/repo/src/storage/storage-adapter.ts`
- `packages/repo/src/synchronizer-program.ts` (when establishing channels)

### Phase 4: Update Synchronizer to Use Type-Safe Methods

1. In [`synchronizer-program.ts`](../packages/repo/src/synchronizer-program.ts), replace generic `send()` calls with type-specific methods:
   - Use `sendEstablishment()` for establish-request/response
   - Use `sendEstablished()` for all other messages
2. Add runtime validation in the generic `send()` method as a safety net

**Files to modify:**
- `packages/repo/src/synchronizer-program.ts` (lines 138-147, 403-433, etc.)

### Phase 5: Add Runtime Validation (Safety Net)

Even with type-safe methods, add runtime validation to catch any remaining issues:

```typescript
// In the generic send() implementation
send: (msg: ChannelMsg) => {
  if (isEstablishedMsg(msg) && !isEstablished(this)) {
    throw new Error(
      `Cannot send ${msg.type}: channel ${this.channelId} not established`
    )
  }
  // Proceed with send
}
```

**Files to modify:**
- `packages/repo/src/adapter/adapter.ts` (in the send implementation)

### Phase 6: Testing

1. Update existing tests to use type-safe methods where appropriate
2. Add new tests that verify:
   - Type-safe methods work correctly
   - Runtime validation catches violations
   - Error messages are clear and actionable

**Files to modify:**
- `packages/repo/src/adapter/bridge-adapter.test.ts`
- `packages/repo/src/synchronizer-program.test.ts`

## Technical Considerations

### TypeScript Contravariance Issue

**Problem**: TypeScript function parameters are contravariant, meaning a subtype can't narrow parameter types. This prevents us from overriding `send(msg: ChannelMsg)` with `send(msg: EstablishedMsg)` in the `Channel` type.

**Solution**: Use separate method names (`sendEstablishment`, `sendEstablished`) instead of overriding. This avoids the contravariance issue while providing type safety.

### Backward Compatibility

Keep the generic `send(msg: ChannelMsg)` method for:
1. Internal use where the channel state is already validated
2. Backward compatibility with existing code
3. Generic message handling in adapters

Add runtime validation to this method to catch misuse.

### Channel State Transitions

The channel state transitions happen in [`synchronizer-program.ts`](../packages/repo/src/synchronizer-program.ts):

1. **ConnectedChannel created**: When adapter calls `addChannel()` (line 133-147)
2. **Channel established**: When `establish-request` or `establish-response` is processed (lines 390-434, 436-604)

At the establishment point, we need to:
```typescript
// In mutatingChannelUpdate, case "channel/establish-request" or "establish-response"
Object.assign(channel, { 
  peerId,
  sendEstablished: (msg: EstablishedMsg) => channel.send(msg)
})
```

### Error Messages

When runtime validation fails, provide clear, actionable error messages:

```typescript
throw new Error(
  `Cannot send ${msg.type} on channel ${channelId}: ` +
  `channel not established (missing peerId). ` +
  `Ensure establish handshake completes before sending sync messages.`
)
```

## Benefits

1. **Compile-Time Safety**: TypeScript prevents sending wrong message types to wrong channel states
2. **Self-Documenting**: Method names clearly indicate when they should be used
3. **Better IDE Support**: Autocomplete shows only valid messages for each channel state
4. **Easier Debugging**: Type errors at compile time instead of silent failures at runtime
5. **Clear Intent**: Code explicitly shows which protocol phase it's in
6. **Fixes Current Bug**: The timeout issue would be caught at compile time or with clear runtime errors

## Migration Path

1. **Phase 1-2**: Add types (no breaking changes)
2. **Phase 3**: Implement in adapters (no breaking changes, new methods added)
3. **Phase 4**: Update synchronizer to use new methods (internal change)
4. **Phase 5**: Add runtime validation (safety net)
5. **Phase 6**: Test thoroughly
6. **Future**: Consider deprecating generic `send()` method once all code uses type-safe methods

## Success Criteria

1. ✅ All establishment messages use `sendEstablishment()`
2. ✅ All sync/directory/delete messages use `sendEstablished()`
3. ✅ Runtime validation catches any violations with clear errors
4. ✅ Bridge adapter tests pass without timeouts
5. ✅ No TypeScript compilation errors
6. ✅ Existing tests continue to pass

## Open Questions

1. **Should we make the generic `send()` method private?** This would force all code to use type-safe methods, but might break backward compatibility.

2. **Should we add a `sendAny()` method for cases where runtime validation is sufficient?** This would make the intent clearer when bypassing type safety.

3. **How do we handle message forwarding?** When a peer forwards a message, it might not know the original channel state. Should forwarding use the generic `send()` with runtime validation?

## References

- Current channel types: [`packages/repo/src/channel.ts`](../packages/repo/src/channel.ts)
- Synchronizer protocol: [`packages/repo/src/synchronizer-program.ts`](../packages/repo/src/synchronizer-program.ts)
- Bridge adapter: [`packages/repo/src/adapter/bridge-adapter.ts`](../packages/repo/src/adapter/bridge-adapter.ts)
- Failing tests: [`packages/repo/src/adapter/bridge-adapter.test.ts`](../packages/repo/src/adapter/bridge-adapter.test.ts)