# Adapter Documentation

For comprehensive documentation on creating adapters, see:

**[Creating Adapters Guide](../../../../docs/creating-adapters.md)**

This guide covers:
- What adapters are and how they work
- Network adapters vs storage adapters
- The Channel abstraction
- Step-by-step implementation guide
- Testing strategies
- Best practices

## Quick Reference

Adapters provide the Repo with access to:
- **Storage** (e.g., IndexedDB, LevelDB, PostgreSQL)
- **Network** (e.g., SSE, WebSocket, WebRTC)

Key interfaces:
- `Adapter` - Base class for all adapters
- `StorageAdapter` - Extended base for storage adapters
- `Channel` - Communication channel abstraction

See the source files in this directory for implementation details:
- [`adapter.ts`](./adapter.ts) - Base Adapter class
- [`adapter-manager.ts`](./adapter-manager.ts) - Adapter lifecycle management
- [`bridge-adapter.ts`](./bridge-adapter.ts) - Example in-memory adapter
