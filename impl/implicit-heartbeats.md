# Presence Heartbeat Implementation Summary

## Problem Statement

The current Ephemeral Store implementation requires consumers (e.g., React components) to manually maintain presence state by periodically re-broadcasting their data (heartbeat). This leads to:

1.  **Leaky Abstraction**: Application code must know about timeout intervals and manage timers.
2.  **Poor DX**: Developers must use `useEffect` + `setInterval` for basic presence.
3.  **Delayed Presence**: Presence is only established when the first heartbeat fires or manual set occurs.

## System Analysis
1.  **Loro's `EphemeralStore`**:
    *   Uses a timestamp-based Last-Write-Wins (LWW) map.
    *   Entries expire after a configurable timeout (default 30s).
    *   `set(key, value)` updates the timestamp for that key.
    *   `encode/encode_all` omits expired entries.
    *   `remove_outdated` must be called manually (in Rust) or via timer (in JS wrapper) to purge expired entries.
2.  **Current Architecture**:
    *   `Synchronizer` (Runtime) manages `EphemeralStore` instances.
    *   `DocHandle` provides a convenience API (`ephemeral.set`).
    *   `useEphemeral` (React) wraps `DocHandle`.

## Implementation Plan
We will move the heartbeat logic into the **`Synchronizer`**, making presence maintenance implicit and automatic.

1.  **Implicit Heartbeat in `Synchronizer`**:
    *   When `setEphemeral(docId, key, value)` is called, the `Synchronizer` checks if the peer has any active state.
    *   If state exists, it starts a heartbeat timer (e.g., every 15s) for that `docId`.
    *   The heartbeat re-applies the current local state to the `EphemeralStore`, refreshing the timestamps.
    *   If state becomes empty (all keys deleted), the timer is stopped.

2.  **Cleanup**:
    *   `Synchronizer.reset()` or `removeDocument()` stops the heartbeat.

3.  **Application Update**:
    *   Remove manual `setInterval` from the Chat App.
    *   Calling `setSelf` once is sufficient to maintain presence until the session ends or state is cleared.

Does this summary accurately reflect our direction?