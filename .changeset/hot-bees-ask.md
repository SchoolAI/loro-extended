---
"@loro-extended/change": minor
"@loro-extended/react": minor
"@loro-extended/hono": minor
---

Prevent empty state in useDocument or TypedDoc where empty state includes invalid state--for example, in `Record` or `List` Shape types. The type system previously implied you could pre-populate a list or record with empty state. This is not the case--empty state is not merged in for shape types that do not have pre-defined keys.
