I want to pause here to discuss expected behavior. What does the user "want" out of this API? On the other hand, what is Loro constrained to do?

For example, I can imagine this being a perfectly legitimate operation (from our test file):

```ts
    const list = new LoroList();
    list.push({ tags: ["javascript", "typescript"], title: "Article" });
```

The idea here is that the user wants an object to exist inside the LoroList, complete and intact. There is no LoroMap inside a LoroList here--the object is either present within the list (presumably at the end, from the perspective of the local operation), or not.

OTOH I can imagine another example where the user wants to have a LoroList whose items are LoroMap objects:

```ts
    const list = new LoroList();
    const map = new LoroMap();
    map.set("tags", ["javascript", "typescript"]);
    map.set("title", "Article");
    list.pushContainer(map);
```

I could even imagine one step further, where the user wants to have a LoroList whose items are LoroMap objects, and arrays at the leaves are LoroList again:

```ts
    const list = new LoroList();
    const map = new LoroMap();
    const langList = new LoroList();
    langList.push("javascript");
    langList.push("typescript");
    map.setContainer("tags", langList);
    map.set("title", "Article");
    list.pushContainer(map);
```

Each of these situations is "valid" within Loro's constraints, and represents a possible intent of the developer (library user).

There are also some "invalid" configurations--for example, it is not possible to have a LoroList with a POJO object in it, that then contains a LoroText. The "Loro magic" of CRDT operations has to be rooted in Container linkages that go back to the root. i.e. in Loro, only containers (e.g., LoroMap, LoroList/MovableList, LoroText, LoroTree, etc.) participate in CRDT operations. Whenever you use a non-container value (a POJO, array, number, string, boolean, etc.), that value is a leaf in the document tree and Loro will not trace CRDT operations inside it. The APIs enforce this separation explicitly: there are “value” setters and “container” setters, and the value setters exclude containers. 

So for the purpose of our design--with nested structure handler in particular, and its accompanying tests that check--how do we preserve these various "intents" that are valid, and allowed by Loro?

Let's discuss the design further. In particular, I'm interested in the idea of a data "shape". We need a way to define the shape of the (possibly nested) data structure undergoing mutation via `change`. The library user likely knows exactly what the intended behavior should be at code time. This means we can have an object shape that represents both runtime and compile/type time information.

However, the one "oddity" about this is that the user's expectation will probably be "flipped" from what we first think of: the user, pulling in a Loro library, will expect everything to work as CRDTs by default, and ONLY in exceptional cases preserve full POJO behavior.

In other words, the user will expect this:

```ts
change(doc, draft => {
  draft.name = "Duane"
  draft.todos = [{title: "Shopping", done: false}]
})
```

... to result in a LoroMap containing a LoroText (name) and LoroList (todos) containing LoroMaps.

But there needs to be a way to express explicitly that this should NOT happen--that the intent is the preservation of the POJO.

Again, ideally, this should be expressed in a shape that is both runtime and compile-time type safe.

What do you suggest? What is an elegant API? What other resources/packages/ideas might aid us?


---


I see the design intent now. Looking at the README (lines 173-212), you've already documented the three valid patterns and the "CRDT by default" expectation. I suggest we implement a **Shape-Based Intent System** using TypeScript branded types. Here's my proposal:

```typescript
// Shape markers for explicit intent
type POJOLeaf<T> = T & { __pojo: true };
type CRDTDeep<T> = T & { __crdt: true };

// Factory functions
const Shape = {
  POJO: <T>(value: T): POJOLeaf<T> => value as POJOLeaf<T>,
  CRDT: <T>(value: T): CRDTDeep<T> => value as CRDTDeep<T>,
};

// Usage examples:
change(doc, draft => {
  // Default: CRDT everywhere
  draft.todos = [{title: "Shopping", done: false}]; // → LoroList<LoroMap>
  
  // Explicit POJO leaf
  draft.metadata = Shape.POJO({tags: ["js", "ts"], count: 5}); // → POJO leaf
  
  // Explicit deep CRDT
  draft.articles = Shape.CRDT([{title: "Article"}]); // → LoroList<LoroMap>
});
```

This provides:
1. **Runtime + Compile-time safety** via branded types
2. **CRDT by default** behavior (user expectation)
3. **Explicit escape hatches** for POJO leaves
4. **Elegant API** that's discoverable and type-safe

Should I implement this shape-based approach?