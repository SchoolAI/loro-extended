---
"@loro-extended/change": patch
"@loro-extended/repo": patch
"@loro-extended/hooks-core": patch
"@loro-extended/react": patch
---

Externalize `loro-crdt` from bundle output to fix Bun compatibility

Added `external: ["loro-crdt"]` to tsup configs for all core packages. This prevents `loro-crdt` from being bundled into the dist output, allowing bundlers like Bun to resolve it separately and handle WASM initialization correctly.

This fixes the `examples/todo-minimal` example which uses Bun's bundler and was failing due to top-level await issues when `loro-crdt` was bundled inline.
