
The user is asking me to architect an elegant solution for a change function that needs to:

1. Provide mutative-like UX: `change(doc, draft => { draft.foo = "bar" })`
2. Support Loro CRDT operations like `counter.increment()`
3. Integrate with TEA-style updates

They've proposed a "Dual-Mode Proxy" approach that would simplify the current 899-line implementation. I need to:

1. First gather information about the current implementation
2. Understand the existing codebase structure
3. Ask clarifying questions to better understand the requirements
4. Create a todo list for the architectural plan

## Elegant Solution: Dual-Mode Proxy

We can create a simpler architecture:

```typescript
export function change<T>(doc: ExtendedLoroDoc<T>, callback: ChangeFn<T>): ExtendedLoroDoc<T> {
  const currentState = doc.toJSON()
  const crdtProxy = createCRDTProxy(doc.getMap("doc"))
  
  // Use mutative to track POJO changes, but let CRDT operations bypass it
  const [, patches] = create(currentState, draft => {
    const hybridDraft = createHybridDraft(draft, crdtProxy)
    callback(hybridDraft as T)
  }, { enablePatches: true })
  
  return applyPatches(doc, patches)
}
```

This approach:
- Leverages mutative's proven patch generation for POJO operations
- Provides direct CRDT access for special operations
- Eliminates the need to reimplement array methods
- Creates a clean bridge for TEA observability


The main idea here is that the dual-mode proxy seems like a good fit, because it would offload the complexity of most of our code to mutative, which already does the work we need it to for POJOs+Map+Set. The driving factor is a desire to be able to apply a set of Patch[] objects to a LoroDoc: this interop unlocks the ability to represent internal TEA patches to a LoroDoc-based debug model. The debug model would then be "shareable" to react components or even other machines over the network, for debug purposes.


Now let me present the architectural plan with a Mermaid diagram to illustrate the dual-mode proxy concept:

## Architectural Plan: Dual-Mode Proxy for @loro-extended/change

### Vision Summary

The goal is to refactor the current 899-line complex proxy system into an elegant **dual-mode proxy** that:
1. **Leverages mutative** for POJO operations (objects, arrays, primitives)
2. **Provides direct CRDT access** for Loro-specific operations (counters, text)
3. **Generates clean mutative patches** that can be applied to LoroDoc for debugging
4. **Enables TEA patch sharing** across components and networks

### Core Architecture

```mermaid
graph TB
    subgraph "Dual-Mode Proxy System"
        A[change() function] --> B[Hybrid Draft]
        B --> C[Mutative Mode]
        B --> D[CRDT Mode]
        
        C --> E[POJO Operations]
        E --> F[Mutative Patches]
        F --> G[Patch Application]
        G --> H[LoroDoc]
        
        D --> I[CRDT Operations]
        I --> J[Direct Loro API]
        J --> H
        
        H --> K[Debug Model]
        K --> L[TEA Integration]
        K --> M[Network Sharing]
    end
    
    subgraph "Benefits"
        N[Simpler Code] --> O[~200 lines vs 899]
        P[Better Performance] --> Q[Offload to mutative]
        R[Clean Patches] --> S[TEA Debug Integration]
        T[Direct CRDT] --> U[Full Loro API Access]
    end
    
    O --> A
    Q --> A
    S --> A
    U --> A
```

### Key Components

#### 1. **Hybrid Draft System**
The core innovation is a dual-mode draft that seamlessly switches between mutative and CRDT modes:

```typescript
interface HybridDraft<T> {
  // POJO operations go through mutative
  [key: string]: any
  
  // CRDT operations bypass mutative entirely
  counter: {
    increment(amount: number): void
    decrement(amount: number): void
  }
  
  text: {
    insert(pos: number, text: string): void
    delete(pos: number, length: number): void
  }
}
```

#### 2. **Simplified change() Function**
The new `change()` function will be dramatically simpler (~20 lines vs 200+):

```typescript
export function change<T>(
  doc: ExtendedLoroDoc<T>, 
  callback: ChangeFn<T>
): ExtendedLoroDoc<T> {
  const currentState = doc.toJSON()
  const crdtProxy = createCRDTProxy(doc.getMap("doc"))
  
  // Use mutative to track POJO changes
  const [, patches] = create(currentState, draft => {
    const hybridDraft = createHybridDraft(draft, crdtProxy)
    callback(hybridDraft as T)
  }, { enablePatches: true })
  
  // Apply patches to LoroDoc for debugging integration
  return applyPatches(doc, patches)
}
```

#### 3. **Patch Application System**
This is the key innovation that enables TEA integration:

```typescript
function applyPatches<T>(doc: ExtendedLoroDoc<T>, patches: Patch[]): ExtendedLoroDoc<T> {
  // Convert mutative patches to LoroDoc operations
  for (const patch of patches) {
    applyMutativePatchToLoroDoc(doc, patch)
  }
  
  // These same patches can be sent to DebugModel for TEA integration
  if (doc.debugMode) {
    doc.debugModel.applyPatches(patches)
  }
  
  return doc
}
```

#### 4. **CRDT Proxy Layer**
Direct access to CRDT operations without proxy overhead:

```typescript
function createCRDTProxy(rootMap: LoroMap): CRDTProxy {
  return new Proxy(rootMap, {
    get(target, prop) {
      const value = target.get(String(prop))
      
      if (value instanceof LoroCounter) {
        return value // Direct access to counter.increment()
      }
      
      if (value instanceof LoroText) {
        return value // Direct access to text.insert()
      }
      
      // For POJOs, return mutative-compatible values
      return convertToMutativeValue(value)
    }
  })
}
```

### Implementation Strategy

#### Phase 1: Core Architecture (Week 1)
1. **Design the hybrid draft interface** with clear separation between POJO and CRDT operations
2. **Implement the simplified change() function** using mutative for POJO operations
3. **Create the patch application system** that converts mutative patches to LoroDoc operations
4. **Build the CRDT proxy layer** for direct CRDT access

#### Phase 2: TEA Integration (Week 2)
1. **Integrate with DebugModel** to enable patch sharing across components
2. **Create network sharing capabilities** for distributed debugging
3. **Implement patch serialization** for cross-machine debugging
4. **Add performance monitoring** for patch generation and application

#### Phase 3: Testing & Optimization (Week 3)
1. **Comprehensive test suite** covering all hybrid scenarios
2. **Performance benchmarking** vs current implementation
3. **Memory usage optimization** for large documents
4. **Edge case handling** for complex nested structures

### Key Benefits

#### ✅ **Dramatic Simplification**
- **From 899 lines to ~200 lines** (75% reduction)
- **Eliminate complex array method reimplementations**
- **Leverage mutative's proven patch generation**

#### ✅ **Better Performance**
- **POJO operations**: Mutative's optimized proxy system
- **CRDT operations**: Direct Loro API access (no proxy overhead)
- **Patch generation**: Zero-cost when debugging is disabled

#### ✅ **Superior TEA Integration**
- **Clean patch generation** compatible with existing `makeMutableUpdate`
- **DebugModel integration** for real-time state sharing
- **Network sharing** of debug state across machines
- **Time-travel debugging** via patch history

#### ✅ **Enhanced Developer Experience**
- **Familiar mutative API** for POJO operations
- **Full CRDT access** for specialized operations
- **Type safety** throughout the hybrid system
- **Backward compatibility** with existing code

### Migration Path

The new architecture will maintain backward compatibility:

```typescript
// Current code continues to work
change(doc, draft => {
  draft.name = "Alice"        // POJO operation → mutative patches
  draft.counter.increment(5) // CRDT operation → direct API
})

// New debugging capabilities unlocked
const debugModel = new DebugModel()
const doc = from(initialState, { debugModel })
change(doc, draft => {
  // Changes are automatically tracked in debugModel
  // Patches can be shared across components and networks
})
```

### Risk Mitigation

1. **Comprehensive Testing**: Ensure all existing tests pass
2. **Performance Monitoring**: Benchmark against current implementation

This architectural plan achieves the core goals of **better TEA integration** and **reduced complexity** while unlocking powerful new debugging capabilities through patch-based state sharing.
