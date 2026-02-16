---
"@loro-extended/change": patch
---

### PlainValueRef: Runtime value check and list integration

**Fixes:**
- Union and any value shapes now correctly return PlainValueRef for object values inside `change()`, enabling nested mutation tracking
- ListRef value shapes now use PlainValueRef with immediate writes, matching StructRef/RecordRef behavior
- `writeListValue` now correctly handles LoroList (delete+insert) vs LoroMovableList (.set())

**New exports:**
- `unwrap()` — helper to unwrap PlainValueRef or return value as-is

**Removed:**
- `JSON.parse(JSON.stringify())` cloning for list value shape items
- Deferred `absorbPlainValues()` logic for list value shapes

**Behavior unchanged:**
- Primitive values (string, number, boolean, null) still return raw values inside `change()` for boolean logic ergonomics
- Outside `change()`, all value shapes return PlainValueRef
- Predicate callbacks (`find`, `filter`, etc.) still receive raw values