# [Future] CRDT Support: Partitioning Strategy Re-evaluation

> **Status**: Future Consideration (Phase 4+)  
> **Priority**: Low (Not blocking MVP)  
> **Type**: Architecture / Performance  
> **Created**: 2025-01-25

---

## Background

During Phase 1.5 infrastructure design, we analyzed the partitioning (chunking) strategy for external storage. A deep question was raised: **What if we need to support CRDT (Conflict-Free Replicated Data Types) for collaborative editing in the future?**

This document records the analysis and provides guidance for future CRDT implementation.

---

## Current Design (MVP)

### Partitioning Strategy

**Structured Data** (JSONL):

- Split by JSON records (semantic-aware)
- Target: 1MB per part
- Part boundaries are **dynamic** (depend on cumulative size)
- **Never split a single JSON object** ✅

**Text Data**:

- Split by bytes (not semantic-aware)
- Fixed 1MB per part
- May split mid-word/sentence

**Binary Data**:

- No partitioning (upload as-is)

### Current Granularity

- **Coarse-grained**: ~100 records per 1MB part
- **Dynamic boundaries**: Part boundaries shift when content changes
- **No version tracking**: Parts don't have independent version vectors

### Performance

**2MB FAQ (200 records) read time:**

```
Network IO: ~400ms (2 parts download) ← Bottleneck (95%)
Parsing: ~20ms (streaming JSONL)
Reassembly: ~1ms (array concat) ← Negligible!
Total: ~421ms
```

**Key insight**: Reassembly cost is **negligible**, current design is optimized for single-user scenarios.

---

## CRDT Compatibility Analysis

### ❌ Problem 1: Dynamic Boundaries

**Issue**: Part boundaries shift when content changes

```
Initial: 200 records
  part_000000.jsonl: records 0-99
  part_000001.jsonl: records 100-199

User A inserts record at #50:
  part_000000.jsonl: records 0-99 (same)
  part_000001.jsonl: records 100-200 (shifted +1)

User B inserts record at #150:
  part_000001.jsonl: records 100-200 (different +1)

Merge conflict: part_000001 has diverged!
```

**CRDT Requirement**: Stable boundaries (don't shift on inserts)

### ❌ Problem 2: Coarse Granularity

**Issue**: High conflict probability

```
part_000000.jsonl contains 100 FAQ records

User A modifies FAQ #1  → updates entire part (1MB)
User B modifies FAQ #50 → updates entire part (1MB)

Conflict probability = 50/100 = 50% ❌ Too high!
```

**CRDT Requirement**: Fine-grained parts (ideally per-record)

**Trade-off**:

```
Fine-grained (per record):
  Conflict probability: 1/200 = 0.5% ✅
  File count: 200 files ❌

Coarse-grained (current, ~100 records/part):
  Conflict probability: 50% ❌
  File count: 2 files ✅
```

### ✅ Advantage: Mergeable Structure

**Good news**: Parts are already JSONL (parseable, mergeable structure)

- Each part can be independently parsed
- Record-level merge is possible within parts

---

## CRDT-Friendly Design Options

### Option A: Stable Boundaries Partitioning

```typescript
// Fixed records per part (not size-based)
const RECORDS_PER_PART = 100;

function partitionWithStableBoundaries(data: any[]) {
  const parts = [];
  for (let i = 0; i < data.length; i += RECORDS_PER_PART) {
    parts.push({
      index: Math.floor(i / RECORDS_PER_PART),
      records: data.slice(i, i + RECORDS_PER_PART),
      range: [i, i + RECORDS_PER_PART - 1]  // Stable range
    });
  }
  return parts;
}
```

**Pros**:

- ✅ Stable boundaries (inserts don't shift part ranges)
- ✅ Predictable (record #X always in part #Y)

**Cons**:

- ❌ Part sizes vary (may violate 1MB limit)
- ❌ Still coarse-grained (conflict probability ~50%)

### Option B: Fine-Grained Partitioning

```
One record per part:
  part_000000.jsonl: FAQ #0
  part_000001.jsonl: FAQ #1
  part_000002.jsonl: FAQ #2
  ...
```

**Pros**:

- ✅ Minimal conflict probability (1/200 = 0.5%)
- ✅ Granular updates
- ✅ Perfect for CRDT

**Cons**:

- ❌ Many files (200 parts for 200 records)
- ❌ Manifest complexity
- ❌ Higher S3 API call overhead

### Option C: Part-Level CRDT (Hybrid)

```typescript
// Keep current partitioning, add CRDT at part level
interface PartWithCRDT {
  index: number;
  version_vector: {[user_id: string]: number};
  records: any[];  // Merged using Automerge/Yjs
}

// Merge function
function mergeParts(partA: Part, partB: Part): Part {
  return CRDT.merge(partA.records, partB.records, {
    type: 'array',
    element_type: 'object'
  });
}
```

**Pros**:

- ✅ Backward compatible with current storage format
- ✅ CRDT logic in application layer
- ✅ Moderate complexity

**Cons**:

- ⚠️ Conflicts within parts still need record-level CRDT resolution
- ⚠️ Conflict probability still ~50%

### Option D: Dedicated CRDT Backend

Use specialized CRDT storage (Automerge Storage, Yjs persistence, etc.)

**Pros**:

- ✅ Purpose-built for collaboration
- ✅ Optimal conflict resolution

**Cons**:

- ❌ Complete architecture change
- ❌ Migration complexity

---

## Decision Matrix

| Scenario | Part Granularity | Boundary Strategy | CRDT Friendly | Current Design |
|----------|-----------------|-------------------|---------------|----------------|
| **Single-user editing** | Coarse (1MB) | Dynamic | N/A | ✅ Current |
| **Low-frequency collab** | Coarse (1MB) | Dynamic | ⚠️ Medium | ✅ + Option C |
| **High-frequency collab** | Fine (per record) | Stable | ✅ High | ❌ Need redesign |

---

## Recommendations

### For MVP (Current Phase)

✅ **Keep current design**

**Rationale**:

- No collaborative editing in MVP scope
- Current algorithm is semantic-aware (doesn't split JSON objects)
- Reassembly cost is negligible (~1ms for 2MB)
- **YAGNI**: Don't optimize for unconfirmed future requirements
- Premature optimization is the root of all evil

### For Future CRDT Implementation (Phase 4+)

⏸️ **Decide based on actual requirements**

**When CRDT becomes a real requirement**:

1. **Measure collaboration patterns first**:
   - How many concurrent editors? (2-5 users vs 50+ users)
   - Edit frequency? (once per hour vs real-time typing)
   - Conflict tolerance? (occasional vs must-be-zero)

2. **Choose strategy based on data**:
   - **Low-frequency (< 5 concurrent users)**: Option C (Part-level CRDT)
     - Easiest to implement
     - Backward compatible
     - Acceptable conflict probability

   - **High-frequency (>= 10 concurrent users)**: Option B (Fine-grained) or Option D (Dedicated backend)
     - Lower conflicts
     - May require storage migration

3. **Migration path**:
   - Current design allows evolution
   - Can add version vectors to existing parts (Option C)
   - Can re-partition data when needed (Option B)

---

## Current Design Strengths

Despite CRDT limitations, current design has advantages:

- ✅ **Semantic-aware for structured data** (按record分割)
- ✅ **Streaming aggregation** (efficient reassembly)
- ✅ **Simple** (easy to understand and maintain)
- ✅ **Optimized for single-user** (99% of current use cases)

---

## Action Items (When CRDT is Needed)

- [ ] Profile actual collaboration patterns
- [ ] Benchmark conflict rates with current partitioning
- [ ] Evaluate CRDT libraries (Automerge, Yjs, Diamond Types)
- [ ] Design part-level version tracking
- [ ] Implement merge resolution UI
- [ ] Consider dedicated CRDT storage backend

---

## Related Files

- `PuppyFlow/lib/storage/CHUNKING_SPEC.md` - Current protocol
- `PuppyFlow/lib/storage/chunking.ts` - Current implementation
- `PuppyEngine/Persistence/ExternalStorageStrategy.py` - Backend counterpart

---

## Technical Debt Note

This is **NOT** technical debt - it's a **conscious design decision**:

✅ **Optimize for current requirements** (single-user, MVP)  
⏸️ **Defer CRDT complexity** until Phase 4+ when requirements are clear  
✅ **Document the trade-offs** (this issue)

**Design Philosophy**: YAGNI + Informed Future Decisions

---

## Discussion

For discussion and questions, see original analysis in Phase 1.5 implementation session.

**Key question to answer before implementing CRDT**:
> Do we really need fine-grained CRDT at the storage layer, or can we handle collaboration at the application layer with coarser granularity?

---

**Labels**: `enhancement`, `phase-4`, `crdt`, `performance`, `architecture`, `future`  
**Milestone**: Phase 4: Advanced Features  
**Assignee**: (To be determined when CRDT work begins)
