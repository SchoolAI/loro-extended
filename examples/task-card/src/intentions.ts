// ═══════════════════════════════════════════════════════════════════════════
// TaskIntention - Pure Data Describing User Actions
// ═══════════════════════════════════════════════════════════════════════════
// Intentions are pure data objects that describe what the user wants to do.
// They are interpreted by the `interpret` function which applies them to
// the CRDT state. This separation enables:
// - Easy testing of state transitions
// - Clear audit trail of user actions
// - Potential for undo/redo at the intention level

export type TaskIntention =
  // Content updates (allowed in certain states)
  | { type: "UPDATE_TITLE"; title: string }
  | { type: "UPDATE_DESCRIPTION"; description: string }

  // State transitions
  | { type: "PUBLISH" } // draft → todo
  | { type: "START" } // todo → in_progress
  | { type: "BLOCK"; reason: string } // in_progress → blocked
  | { type: "UNBLOCK" } // blocked → in_progress
  | { type: "COMPLETE" } // in_progress → done
  | { type: "REOPEN" } // done → todo
  | { type: "ARCHIVE" } // any (except archived) → archived
