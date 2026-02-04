These tests were removed from loro.test.ts; were the corresponding tests added to ext.test.ts?

```ts
  49     :     it("should access docShape", () => {
  50     :       const doc = createTypedDoc(schema)
  51     :
  52     :       const docShape = loro(doc).docShape
  53     :       expect(docShape).toBe(schema)
  54     :     })
  55     :
  56     :     it("should access rawValue", () => {
  57     :       const doc = createTypedDoc(schema)
  58     :       doc.title.insert(0, "Hello")
  59     :
  60     :       const rawValue = loro(doc).rawValue
  61     :       expect(rawValue).toHaveProperty("title", "Hello")
  62     :     })
  63     :
  64     :     it("should apply JSON patches", () => {
  65     :       const doc = createTypedDoc(schema)
  66     :
  67     :       // Use add operation for counter since it's a container
  68     :       loro(doc).applyPatch([
  69     :         { op: "add", path: ["items", 0], value: "test-item" },
  70     :       ])
  71     :
  72     :       expect(doc.items.toJSON()).toContain("test-item")
  73     :     })
```

1. The Plan Conflated "Removing Handle.change()" with Actually Removing It
The plan stated:

✅ Remove Handle.change() from repo (use change(handle.doc, fn) instead)

But Handle.change() was kept and simply updated to use ext(this._doc).change(fn) internally. We need to completely remove handle.change. The new way forward is the `change` function helper.


2. Three Ways to Mutate Creates Cognitive Load
change(doc, fn) — functional helper (kept)
ext(doc).change(fn) — via ext namespace
handle.change(fn) — on Handle objects (kept despite plan)

Let's use `change(doc, fn)` as primary, canonical since it's most concise. Remove `ext(doc).change` and `handle.change`.

3. Test Coverage for ext() Is Implicit, Not Explicit
The plan called for ext.test.ts with comprehensive tests. Instead, existing tests were updated to use ext(), which provides coverage but doesn't explicitly test the API surface.

Recommendation: Create dedicated ext.test.ts that explicitly tests:

Each ExtDocRef method
Each ExtRefBase method
ExtListRef.pushContainer() and ExtMapRef.setContainer()
That ext(ref).doc returns the correct LoroDoc
