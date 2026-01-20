---
"@loro-extended/asks": major
---

Renamed package from `@loro-extended/askforce` to `@loro-extended/asks`.

**Breaking Changes:**
- Package renamed from `@loro-extended/askforce` to `@loro-extended/asks`
- Class renamed from `Askforce` to `Asks`
- Types renamed:
  - `AskforceOptions` → `AsksOptions`
  - `AskforceError` → `AsksError`
  - `AskforceErrorContext` → `AsksErrorContext`
- Schema factory renamed from `createAskforceSchema` to `createAskSchema`

**Migration:**
```typescript
// Before
import { Askforce, createAskforceSchema, AskforceError } from "@loro-extended/askforce"
const askforce = new Askforce(recordRef, ephemeral, options)

// After
import { Asks, createAskSchema, AsksError } from "@loro-extended/asks"
const asks = new Asks(recordRef, ephemeral, options)
```
