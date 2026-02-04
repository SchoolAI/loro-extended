# LEA for Web Applications

This document describes web-specific patterns for LEA (Loro Extended Architecture). For core concepts, see [LEA: The Loro Extended Architecture](./lea.md).

## The View Doc: Routing and Per-Peer State

A complete LEA web application typically uses **multiple documents** to separate concerns:

```
┌───────────────────────────────────────────────────────────────┐
│                        LEA Application                        │
├───────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐         ┌─────────────────┐              │
│  │   App Doc       │         │   View Doc      │              │
│  │   (Shared)      │         │   (Per-Peer)    │              │
│  │                 │         │                 │              │
│  │  • Domain data  │         │  • Current route│              │
│  │  • User content │         │  • Scroll pos   │              │
│  │  • Permissions  │         │  • Panel sizes  │              │
│  │  • Sensors      │         │  • Selections   │              │
│  │  • Actuators    │         │  • Focus state  │              │
│  └────────┬────────┘         └────────┬────────┘              │
│           │                           │                       │
│           │ sync to all peers         │ local only (usually)  │
│           ▼                           ▼                       │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │                    Loro Documents                       │  │
│  └─────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
```

### The Orthogonal State Spaces

**What exists** (App Doc) and **what I'm looking at** (View Doc) are orthogonal concerns:

- **App Doc** - The collaborative truth. Domain data, user content, permissions. Synced to all peers.
- **View Doc** - My personal viewport into that truth. Routes, selections, scroll positions. Usually local-only.

This separation is crucial because:

1. Multiple peers may want to view the same app state from different perspectives
2. Multiple tabs on the same device should share app state but have independent views
3. View state changes (scrolling, selecting) shouldn't create sync traffic
4. Navigation history is inherently per-peer

> **Across Domains**
> This pattern of separating "shared truth" from "local perspective" applies beyond web:
> - **Backend**: Shared job queue (App Doc) vs. worker's current task focus (View Doc)
> - **Agents**: Shared world state vs. agent's current attention/goals

### The View Doc Schema

The View Doc uses Loro's **UndoManager** for navigation history instead of manual stacks. This is cleaner because browser back/forward is conceptually equivalent to undo/redo of navigation operations.

```typescript
const ViewDocSchema = Shape.doc({
  // The current route (discriminated union for type safety)
  // Each route variant includes scrollY for scroll position restoration
  navigation: Shape.struct({
    route: Shape.plain.discriminatedUnion("type", {
      home: Shape.plain.struct({
        type: Shape.plain.literal("home"),
        scrollY: Shape.plain.number(),
      }),
      document: Shape.plain.struct({
        type: Shape.plain.literal("document"),
        docId: Shape.plain.string(),
        section: Shape.plain.string().nullable(),
        scrollY: Shape.plain.number(),
      }),
      settings: Shape.plain.struct({
        type: Shape.plain.literal("settings"),
        tab: Shape.plain.string(),
        scrollY: Shape.plain.number(),
      }),
      search: Shape.plain.struct({
        type: Shape.plain.literal("search"),
        query: Shape.plain.string(),
        page: Shape.plain.number(),
        scrollY: Shape.plain.number(),
      }),
      notFound: Shape.plain.struct({
        type: Shape.plain.literal("notFound"),
        attemptedPath: Shape.plain.string(),
        scrollY: Shape.plain.number(),
      }),
    }),
  }),

  // Navigation history is handled by Loro's UndoManager, not manual stacks.
  // The UndoManager automatically tracks route changes and can undo/redo them.

  // UI state
  ui: Shape.struct({
    sidebarCollapsed: Shape.plain.boolean(),
    selectedItems: Shape.list(Shape.plain.string()),
    panelSizes: Shape.record(Shape.plain.number()),
    expandedSections: Shape.list(Shape.plain.string()),
  }),

  // Modal/dialog state
  modal: Shape.plain
    .discriminatedUnion("type", {
      none: Shape.plain.struct({ type: Shape.plain.literal("none") }),
      confirm: Shape.plain.struct({
        type: Shape.plain.literal("confirm"),
        title: Shape.plain.string(),
        message: Shape.plain.string(),
        confirmAction: Shape.plain.string(),
      }),
      settings: Shape.plain.struct({
        type: Shape.plain.literal("settings"),
        tab: Shape.plain.string(),
      }),
    })
    .default({ type: "none" }),
});
```

**Why scrollY on the route?** Storing scroll position directly on each route variant means:
- Single source of truth - the route IS the view state
- Automatic undo/redo - when UndoManager reverts the route, scroll reverts too
- No key derivation needed - no `getRouteKey()` function
- Cleaner schema - no separate scrollPositions map

### View Messages

With UndoManager-based navigation, NAVIGATE_BACK and NAVIGATE_FORWARD are no longer needed as messages. The browser history reactor calls `undoManager.undo()/redo()` directly on popstate events.

```typescript
type ViewMsg =
  // Navigation
  | { type: "NAVIGATE"; route: Route; currentScrollY: number } // Creates undo step
  | { type: "REPLACE_ROUTE"; route: Route } // No undo step (for redirects, URL sync)

  // UI state
  | { type: "TOGGLE_SIDEBAR" }
  | { type: "SELECT_ITEMS"; ids: string[] }
  | { type: "CLEAR_SELECTION" }
  | { type: "RESIZE_PANEL"; panelId: string; size: number }
  | { type: "TOGGLE_SECTION"; sectionId: string }

  // Modals
  | { type: "OPEN_MODAL"; modal: Modal }
  | { type: "CLOSE_MODAL" };
```

**Key insight**: The NAVIGATE message includes `currentScrollY` because only the caller knows the current scroll position when navigation is triggered. This value is saved to the current route before navigating, so undo restores both the route AND scroll position.

### The View Update Function

With UndoManager, the update function is simpler. The key insight is that NAVIGATE must use **two separate `change()` calls** so UndoManager captures both the scroll position save and the route change:

```typescript
const viewUpdate = createUpdate<typeof ViewDocSchema, ViewMsg>(
  (doc, msg, timestamp) => {
    switch (msg.type) {
      case "NAVIGATE": {
        // Step 1: Save scroll position to current route before leaving
        // This is a separate change() so UndoManager captures it
        change(doc, (draft) => {
          (draft.navigation.route as any).scrollY = msg.currentScrollY;
        });

        // Step 2: Navigate to new route with scrollY: 0
        // UndoManager captures this as part of the same undo step
        change(doc, (draft) => {
          draft.navigation.route = { ...msg.route, scrollY: 0 };
        });
        break;
      }

      case "REPLACE_ROUTE": {
        // Replace without creating undo step (e.g., redirects, URL sync)
        change(doc, (draft) => {
          draft.navigation.route = msg.route;
        });
        break;
      }

      // NAVIGATE_BACK and NAVIGATE_FORWARD are no longer needed!
      // The browser history reactor calls undoManager.undo()/redo() directly.

      case "SELECT_ITEMS": {
        change(doc, (draft) => {
          draft.ui.selectedItems = msg.ids;
        });
        break;
      }

      case "TOGGLE_SIDEBAR": {
        change(doc, (draft) => {
          draft.ui.sidebarCollapsed = !doc.ui.sidebarCollapsed;
        });
        break;
      }

      case "OPEN_MODAL": {
        change(doc, (draft) => {
          draft.modal = msg.modal;
        });
        break;
      }

      case "CLOSE_MODAL": {
        change(doc, (draft) => {
          draft.modal = { type: "none" };
        });
        break;
      }
    }
  },
);
```

**Why two-step NAVIGATE?** If you only do one `change()` call, undo will restore the route but not the scroll position that was saved. The two-step approach ensures UndoManager captures both operations, so undo restores the old route WITH its scroll position.

## URL ↔ Route Bidirectional Mapping

Routes must map to URLs (for the address bar) and URLs must parse to routes (on page load):

```typescript
// Route → URL (for browser address bar)
function routeToUrl(route: Route): string {
  switch (route.type) {
    case "home":
      return "/";
    case "document":
      return `/doc/${route.docId}${route.section ? `#${route.section}` : ""}`;
    case "settings":
      return `/settings/${route.tab}`;
    case "search":
      return `/search?q=${encodeURIComponent(route.query)}&page=${route.page}`;
    case "notFound":
      return route.attemptedPath;
  }
}

// URL → Route (for initial load and popstate)
function urlToRoute(url: string): Route {
  const parsed = new URL(url, window.location.origin);

  if (parsed.pathname === "/") {
    return { type: "home" };
  }

  const docMatch = parsed.pathname.match(/^\/doc\/([^/]+)$/);
  if (docMatch) {
    return {
      type: "document",
      docId: docMatch[1],
      section: parsed.hash.slice(1) || null,
    };
  }

  const settingsMatch = parsed.pathname.match(/^\/settings\/([^/]+)$/);
  if (settingsMatch) {
    return { type: "settings", tab: settingsMatch[1] };
  }

  if (parsed.pathname === "/search") {
    return {
      type: "search",
      query: parsed.searchParams.get("q") || "",
      page: parseInt(parsed.searchParams.get("page") || "1", 10),
    };
  }

  return { type: "notFound", attemptedPath: parsed.pathname };
}
```

## The Browser History Reactor with UndoManager

The browser history reactor uses UndoManager for back/forward navigation. It tracks browser history position to determine how many undo/redo calls to make:

```typescript
function createBrowserHistoryReactor(
  undoManager: UndoManager,
  options: {
    viewDoc: TypedDoc<typeof ViewDocSchema>;
    routeToUrl: (route: Route) => string;
    urlToRoute: (url: string) => Route;
  },
) {
  let historyPosition = 0;
  let isHandlingPopstate = false;

  // Route changed → update browser URL
  const routeSyncReactor: Reactor<ViewState, ViewMsg> = ({ before, after }) => {
    if (isHandlingPopstate) return; // Don't push during popstate handling

    const beforeUrl = routeToUrl(before.navigation.route);
    const afterUrl = routeToUrl(after.navigation.route);

    if (beforeUrl !== afterUrl) {
      historyPosition++;
      window.history.pushState({ position: historyPosition }, "", afterUrl);
    }
  };

  // Handle browser back/forward buttons
  window.addEventListener("popstate", async (event) => {
    const newPosition = event.state?.position ?? 0;
    const delta = newPosition - historyPosition;

    if (delta === 0) return;

    isHandlingPopstate = true;
    historyPosition = newPosition;

    // Call undo/redo based on delta
    if (delta < 0) {
      for (let i = 0; i < Math.abs(delta); i++) {
        undoManager.undo();
      }
    } else {
      for (let i = 0; i < delta; i++) {
        undoManager.redo();
      }
    }

    // Restore scroll position from route after undo/redo
    const route = options.viewDoc.navigation.route;
    window.scrollTo(0, route.scrollY);

    isHandlingPopstate = false;
  });

  // Handle initial URL on page load
  const initialRoute = urlToRoute(window.location.href);
  change(viewDoc, (draft) => {
    draft.navigation.route = { ...initialRoute, scrollY: 0 };
  });
  window.history.replaceState({ position: 0 }, "", window.location.href);

  return { routeSyncReactor };
}
```

**Key insights:**
- **Position tracking**: Store position in `pushState` to calculate delta on popstate
- **Delta-based undo/redo**: `delta < 0` means back (undo), `delta > 0` means forward (redo)
- **Scroll restoration**: After undo/redo, restore scroll from `route.scrollY`
- **No NAVIGATE_BACK/FORWARD messages**: UndoManager handles this directly

## Cross-Doc Reactors

The key architectural pattern: reactors in one program that respond to state in another document. This enables coordination between App Doc and View Doc:

```typescript
// Reactor in View Program that watches App Doc for deletions
function createAppWatcherReactor(
  appDoc: TypedDoc<typeof AppDocSchema>,
): Reactor<ViewState, ViewMsg> {
  return ({ before, after }, dispatch) => {
    // If viewing a document that was deleted, navigate away
    if (after.route.type === "document") {
      const docExists = appDoc.documents[after.route.docId];
      if (!docExists) {
        dispatch({ type: "NAVIGATE", route: { type: "home" } });
      }
    }
  };
}

// Reactor that loads app data based on current route
function createRouteLoaderReactor(repo: Repo): Reactor<ViewState, ViewMsg> {
  return async ({ before, after }, dispatch) => {
    // Route changed to a document view
    if (
      after.route.type === "document" &&
      (before.route.type !== "document" ||
        before.route.docId !== after.route.docId)
    ) {
      // Ensure the document is loaded in the repo
      await repo.loadDoc(after.route.docId);
    }
  };
}

// Reactor that syncs selection to app doc (for collaborative features)
function createSelectionSyncReactor(
  appDoc: TypedDoc<typeof AppDocSchema>,
  peerId: string,
): Reactor<ViewState, ViewMsg> {
  return ({ before, after }, dispatch) => {
    // Selection changed - update presence in app doc
    if (!deepEqual(before.ui.selectedItems, after.ui.selectedItems)) {
      change(appDoc, (draft) => {
        draft.presence[peerId] = {
          selectedItems: after.ui.selectedItems,
          lastSeen: Date.now(),
        };
      });
    }
  };
}
```

## The Two-Program Architecture

A complete LEA web application runs two coordinated programs:

```typescript
// Create both documents
const appDoc = createTypedDoc(AppDocSchema);
const viewDoc = createTypedDoc(ViewDocSchema);

// Connect app doc to network (shared)
const repo = new Repo({ doc: appDoc });
repo.connect(websocketAdapter);

// View doc stays local (no network sync)
// But we could persist it to localStorage for tab restore

// Define the App Program
const appProgram: Program<typeof AppDocSchema, AppMsg> = {
  doc: appDoc,
  state: (frontier) => state(appDoc, frontier),
  update: (frontier, msg) => appUpdate(appDoc, frontier, msg),
  reactors: [
    appViewReactor,
    apiReactor,
    // ... other app reactors
  ],
};

// Define the View Program
const viewProgram: Program<typeof ViewDocSchema, ViewMsg> = {
  doc: viewDoc,
  state: (frontier) => state(viewDoc, frontier),
  update: (frontier, msg) => viewUpdate(viewDoc, frontier, msg),
  reactors: [
    browserSyncReactor,
    createAppWatcherReactor(appDoc),
    createRouteLoaderReactor(repo),
    createSelectionSyncReactor(appDoc, peerId),
    // ... other view reactors
  ],
};

// Start both runtimes
const appRuntime = runtime(appProgram);
const viewRuntime = runtime(viewProgram);

// Initialize browser adapter
browserAdapter(viewDoc);

// The combined view receives both states
function AppShell() {
  const appState = useAppState(appDoc);
  const viewState = useViewState(viewDoc);

  return (
    <Router
      route={viewState.route}
      appState={appState}
      dispatch={viewRuntime.dispatch}
      appDispatch={appRuntime.dispatch}
    />
  );
}
```

## React Integration

```typescript
function useTimer(handle: Handle<typeof TimerSchema>) {
  const [timerState, setTimerState] = useState(() =>
    state(handle.doc, loro(handle.doc).frontiers()),
  );
  const runtimeRef = useRef<{
    dispatch: Dispatch<TimerMsg>;
    dispose: Disposer;
  }>();

  useEffect(() => {
    const viewReactor: Reactor<TimerState, TimerMsg> = ({ after }) => {
      setTimerState(after);
    };

    runtimeRef.current = runtime({
      doc: handle.doc,
      state: (frontier) => state(handle.doc, frontier),
      update: (frontier, msg) => update(handle.doc, frontier, msg),
      reactors: [viewReactor],
    });

    return () => runtimeRef.current?.dispose();
  }, [handle]);

  const dispatch = useCallback((msg: TimerMsg) => {
    runtimeRef.current?.dispatch(msg);
  }, []);

  return { state: timerState, dispatch };
}

// Usage in component
function TimerView() {
  const { state, dispatch } = useTimer(handle);

  return (
    <div>
      <div>Elapsed: {state.elapsed}s</div>
      <div>Status: {state.status}</div>
      {state.status === "stopped" && (
        <button onClick={() => dispatch({ type: "START" })}>Start</button>
      )}
      {state.status === "running" && (
        <button onClick={() => dispatch({ type: "PAUSE" })}>Pause</button>
      )}
      {state.status === "paused" && (
        <>
          <button onClick={() => dispatch({ type: "START" })}>Resume</button>
          <button onClick={() => dispatch({ type: "RESET" })}>Reset</button>
        </>
      )}
    </div>
  );
}
```

## The "Follow Me" Pattern (Proposed)

> **Status: Proposed Pattern**
> This pattern is theoretical and may not be implemented in all LEA systems.

Sometimes you want to share view state--for presentations, guided tours, or collaborative debugging. This requires a third document:

```typescript
const FollowDocSchema = Shape.doc({
  // Who is currently leading (null = no active leader)
  leader: Shape.plain.string().nullable(),

  // The leader's current view state
  leaderView: Shape.struct({
    route: RouteSchema,
    scrollPosition: Shape.plain.number(),
    selections: Shape.list(Shape.plain.string()),
  }).nullable(),

  // Who is following the leader
  followers: Shape.list(Shape.plain.string()),

  // Follow mode settings
  settings: Shape.struct({
    allowFollowerNavigation: Shape.plain.boolean(), // Can followers navigate independently?
    syncScrollPosition: Shape.plain.boolean(),
    syncSelections: Shape.plain.boolean(),
  }),
});

// Reactor that follows the leader
function createFollowReactor(
  followDoc: TypedDoc<typeof FollowDocSchema>,
  viewDispatch: Dispatch<ViewMsg>,
  myPeerId: string,
): Reactor<FollowState, FollowMsg> {
  return ({ before, after }, dispatch) => {
    const amFollowing = after.followers.includes(myPeerId);
    const leaderViewChanged = !deepEqual(before.leaderView, after.leaderView);

    if (amFollowing && leaderViewChanged && after.leaderView) {
      // Update my view to match leader
      viewDispatch({
        type: "REPLACE_ROUTE", // Don't add to my history
        route: after.leaderView.route,
      });

      if (after.settings.syncScrollPosition) {
        viewDispatch({
          type: "SET_SCROLL_POSITION",
          key: "main",
          position: after.leaderView.scrollPosition,
        });
      }

      if (after.settings.syncSelections) {
        viewDispatch({
          type: "SELECT_ITEMS",
          ids: after.leaderView.selections,
        });
      }
    }
  };
}

// Reactor that broadcasts leader's view (runs only for the leader)
function createLeaderBroadcastReactor(
  followDoc: TypedDoc<typeof FollowDocSchema>,
  myPeerId: string,
): Reactor<ViewState, ViewMsg> {
  return ({ before, after }, dispatch) => {
    // Only broadcast if I'm the leader
    if (followDoc.leader !== myPeerId) return;

    // Broadcast my view state changes
    if (
      !deepEqual(before.route, after.route) ||
      !deepEqual(before.ui.selectedItems, after.ui.selectedItems)
    ) {
      change(followDoc, (draft) => {
        draft.leaderView = {
          route: after.route,
          scrollPosition: after.ui.scrollPositions.main || 0,
          selections: after.ui.selectedItems,
        };
      });
    }
  };
}
```

## The Time Travel Doc (Proposed)

> **Status: Proposed Pattern**
> This pattern is theoretical and may not be implemented in all LEA systems.

For debugging and playback features, a third document tracks which frontier we're viewing:

```typescript
const TimeDocSchema = Shape.doc({
  // Are we in time travel mode?
  mode: Shape.plain.discriminatedUnion("type", {
    live: Shape.plain.struct({ type: Shape.plain.literal("live") }),
    viewing: Shape.plain.struct({
      type: Shape.plain.literal("viewing"),
      frontier: Shape.plain.string(), // Serialized frontier
      appDocId: Shape.plain.string(),
    }),
    playing: Shape.plain.struct({
      type: Shape.plain.literal("playing"),
      fromFrontier: Shape.plain.string(),
      toFrontier: Shape.plain.string(),
      currentFrontier: Shape.plain.string(),
      speed: Shape.plain.number(), // Playback speed multiplier
    }),
  }),
});

// Time travel doesn't trigger app reactors - it's read-only inspection
function deriveStateAtFrontier(
  appDoc: TypedDoc<typeof AppDocSchema>,
  timeDoc: TypedDoc<typeof TimeDocSchema>,
): AppState {
  const timeState = state(timeDoc, timeDoc.frontiers());

  if (timeState.mode.type === "live") {
    // Normal operation - use current frontier
    return state(appDoc, appDoc.frontiers());
  } else {
    // Time travel - fork at historical frontier
    const frontier = JSON.parse(timeState.mode.frontier);
    return state(appDoc, frontier);
  }
}
```

## Route Guards and Permissions

Routes may require permission checks:

```typescript
function canAccessRoute(route: Route, appState: AppState): boolean {
  switch (route.type) {
    case "settings":
      return appState.user?.role === "admin";
    case "document":
      return appState.documents[route.docId]?.permissions.canView ?? false;
    default:
      return true;
  }
}

// Guard reactor that redirects unauthorized access
const routeGuardReactor: Reactor<ViewState, ViewMsg> = (
  { before, after },
  dispatch,
) => {
  if (!deepEqual(before.route, after.route)) {
    const appState = state(appDoc, appDoc.frontiers());
    if (!canAccessRoute(after.route, appState)) {
      dispatch({
        type: "REPLACE_ROUTE",
        route: { type: "home" }, // Or a "not authorized" route
      });
    }
  }
};
```

## Summary: The Multi-Doc Architecture

A complete LEA web application uses 2-3 documents:

| Document       | Purpose                      | Sync Behavior        | Typical Contents                        |
| -------------- | ---------------------------- | -------------------- | --------------------------------------- |
| **App Doc**    | Collaborative truth          | Synced to all peers  | Domain data, user content, permissions  |
| **View Doc**   | Per-peer viewport            | Local only (usually) | Route (with scrollY), selections, UI state |
| **Follow Doc** | Shared viewing (optional)    | Synced when active   | Leader, followers, shared view state    |
| **Time Doc**   | Time travel debug (optional) | Local only           | Current viewing frontier, playback mode |

**Key insights:**

- **Orthogonal concerns** - What exists vs. what I'm looking at
- **Cross-doc reactors** - Programs coordinate through document subscriptions
- **UndoManager for history** - Browser back/forward = undo/redo of navigation operations
- **Scroll on route** - scrollY stored directly on route for automatic restoration
- **Browser as adapter** - URL bar is just another external system writing to sensors
- **Follow mode** - View state can be shared when explicitly desired

---

*For core LEA concepts, see [LEA: The Loro Extended Architecture](./lea.md).*
