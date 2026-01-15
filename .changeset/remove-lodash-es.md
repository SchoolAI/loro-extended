---
"@loro-extended/repo": patch
---

Remove lodash-es dependency to fix "WeakMap is not a constructor" error in Next.js with Turbopack

The bundled lodash-es code used `Function("return this")()` for global detection, which breaks under Turbopack's strict mode handling. Replaced with a native `omit` helper function.
