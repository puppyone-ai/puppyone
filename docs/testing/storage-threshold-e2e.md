# Storage Threshold E2E Testing Guide

> **Purpose**: Verify storage_class decisions are consistent across Template Instantiation, Frontend Runtime, and Backend Computation

**Last Updated**: 2025-01-30  
**Related**: `docs/architecture/STORAGE_CONSISTENCY_BEST_PRACTICES.md`

---

## Quick Reference

| Content Size | Expected storage_class | Rationale |
|--------------|------------------------|-----------|
| < 1MB | `internal` | Inline in JSON, no network overhead |
| ≥ 1MB | `external` | Partitioned upload to PuppyStorage |

**Critical**: All three write operations must agree on storage_class for the same content.

---

## Test Scenarios

### Scenario 1: Small Content (<1MB) Stays Inline Throughout

**Objective**: Verify content <1MB uses internal storage consistently

**Steps**:

1. **Template Instantiation**
   ```bash
   # Start dev server
   npm run dev
   ```
   
   - Navigate to "New" → Select "Getting Started" template
   - Open browser DevTools → Console
   - Verify instantiation logs: `[CloudTemplateLoader] Resource ... inline storage`
   - Check all blocks: `storage_class='internal'`
   - Verify NO `external_metadata` or it's empty
   - Check Network tab: NO requests to PuppyStorage

2. **Frontend Runtime (First Edit)**
   - Select any text block with ~10KB content
   - Add 1 character, wait 2 seconds (auto-save debounce)
   - Verify in console: Block remains `storage_class='internal'`
   - Check Network tab: NO upload requests
   - **CRITICAL**: Should NOT upgrade to external on first edit!

3. **Backend Computation**
   - Add LLM edge outputting <1MB text
   - Run workflow
   - Verify output block: `storage_class='internal'`
   - Content displays immediately (no loading from PuppyStorage)

**Success Criteria**:
- ✅ Template → internal
- ✅ First edit → stays internal (no upgrade)
- ✅ Backend output → internal
- ✅ No "File not found" errors from PuppyStorage

---

### Scenario 2: Large Content (≥1MB) Uses External Storage

**Objective**: Verify content ≥1MB uses external storage with partitioning

**Steps**:

1. **Prepare Test Content**
   ```javascript
   // In browser console, generate 2MB text
   const twoMB = "x".repeat(2 * 1024 * 1024);
   console.log('2MB content ready');
   ```

2. **Frontend Runtime (Large Content)**
   - Create new workspace → Add text block
   - Paste 2MB content, wait 2 seconds
   - Verify in console: `Switching to external storage`
   - Check Network tab: POST requests to `/api/storage/upload/part/direct`
   - Verify block data: `storage_class='external'`, `external_metadata.resource_key` exists

3. **Backend Computation (Large Output)**
   - Create workflow: LLM edge configured to output 5MB content
   - Run workflow
   - Verify: `[BlockUpdateService] Block ... updated with external storage`
   - Check output block: `storage_class='external'`
   - Verify content loads from PuppyStorage (see loading indicator briefly)

4. **Verify Partitioning**
   ```bash
   # Check PuppyStorage files
   ls -lh PuppyStorage/data/local-user/<block-id>/<version-id>/
   
   # Should see:
   # part_000000.txt  (~1MB)
   # part_000001.txt  (~1MB)
   # ...
   # manifest.json
   ```

**Success Criteria**:
- ✅ Content ≥1MB triggers external storage
- ✅ Multiple parts created (1MB each)
- ✅ Manifest.json exists
- ✅ Frontend successfully loads from PuppyStorage

---

### Scenario 3: Boundary Testing (Exact 1MB)

**Objective**: Verify threshold boundary behavior is consistent

**Steps**:

1. **Just Below Threshold (1MB - 1 byte)**
   ```javascript
   const justBelow = "x".repeat(1024 * 1024 - 1);
   // Paste into text block
   ```
   - Wait for auto-save
   - Verify: `storage_class='internal'`
   - NO network requests

2. **Exact Threshold (1MB)**
   ```javascript
   const exactOneMB = "x".repeat(1024 * 1024);
   // Paste into same block (add 1 character)
   ```
   - Wait for auto-save
   - Verify: `storage_class='external'`
   - Upload triggered

3. **Just Above Threshold (1MB + 1 byte)**
   ```javascript
   const justAbove = "x".repeat(1024 * 1024 + 1);
   ```
   - Verify: `storage_class='external'`

**Success Criteria**:
- ✅ 1,048,575 bytes → internal
- ✅ 1,048,576 bytes → external
- ✅ 1,048,577 bytes → external

---

### Scenario 4: Template vs Runtime Consistency

**Objective**: Ensure template-created inline content doesn't upgrade unnecessarily

**Steps**:

1. **Instantiate Template**
   - Create workspace from "SEO Blog Generator" template
   - Note blocks with inline content (check sizes in console)
   - Record: `block-id: {size: 10KB, storage_class: 'internal'}`

2. **Minor Edit (No Size Change)**
   - Edit one inline block: change 1 character
   - Wait for auto-save
   - Verify: **Still `storage_class='internal'`** (no upgrade!)
   - This is the key test: template and runtime must agree

3. **Major Edit (Cross Threshold)**
   - Same block: paste 2MB content
   - Wait for auto-save
   - Verify: Now `storage_class='external'` (legitimate upgrade)

**Success Criteria**:
- ✅ Template creates inline content for <1MB
- ✅ Minor edits preserve inline storage
- ✅ Only legitimate size increase triggers external upgrade
- ✅ NO unnecessary upgrades on first edit

---

### Scenario 5: Backend Computation Consistency

**Objective**: Verify backend computation respects same threshold

**Test Cases**:

| Edge Type | Output Size | Expected storage_class |
|-----------|-------------|------------------------|
| LLM | 5KB | internal |
| Transform | 50KB | internal |
| LLM (long) | 2MB | external |
| Batch | 10MB | external |

**Steps**:
1. Create workflows for each edge type above
2. Run and verify output block `storage_class`
3. Check consistency with frontend threshold

---

## Verification Commands

### Browser Console Commands

```javascript
// Get current workspace blocks
const blocks = /* current workspace state */.blocks;

// Check all block storage classes
blocks.forEach(block => {
  const storageClass = block.data?.storage_class || 'unknown';
  const contentSize = block.data?.content?.length || 0;
  const hasMetadata = !!block.data?.external_metadata?.resource_key;
  
  console.log(`${block.id}: ${storageClass} (${contentSize} bytes) ${hasMetadata ? '[has metadata]' : ''}`);
});

// Find mismatches (should be empty array)
const mismatches = blocks.filter(b => {
  const size = b.data?.content?.length || 0;
  const storageClass = b.data?.storage_class;
  const expectedClass = size >= 1024 * 1024 ? 'external' : 'internal';
  return storageClass !== expectedClass;
});

console.log('Mismatches:', mismatches);
```

### PuppyStorage File Verification

```bash
# List all user blocks
ls -lh PuppyStorage/data/local-user/

# Check specific block's storage
BLOCK_ID="<block-id>"
ls -lh PuppyStorage/data/local-user/$BLOCK_ID/

# Verify part sizes (should be ~1MB each)
VERSION_ID="<version-id>"
ls -lh PuppyStorage/data/local-user/$BLOCK_ID/$VERSION_ID/

# Count parts
ls PuppyStorage/data/local-user/$BLOCK_ID/$VERSION_ID/part_*.txt | wc -l
```

### Backend Logs Verification

```bash
# Start PuppyEngine with verbose logging
cd PuppyEngine
python -m uvicorn app:app --reload --log-level debug

# Look for these logs:
# ✅ "Block ... updated with internal storage" (for <1MB)
# ✅ "Block ... updated with external storage" (for ≥1MB)
# ❌ "Switching storage strategy unexpectedly"
```

---

## Common Issues and Debugging

### Issue 1: 10KB Content Being Externalized

**Symptom**: Content <1MB uses `storage_class='external'`

**Cause**: Frontend or Backend still using old 1KB threshold

**Fix**:
```bash
# Verify frontend threshold
grep -n "CONTENT_LENGTH_THRESHOLD" PuppyFlow/app/components/workflow/utils/dynamicStorageStrategy.ts
# Should see: CONTENT_LENGTH_THRESHOLD = 1024 * 1024

# Verify backend threshold
grep -n "STORAGE_THRESHOLD_MB" PuppyEngine/Server/HybridStoragePolicy.py
# Should see: STORAGE_THRESHOLD_MB = 1024 * 1024
```

### Issue 2: File Not Found Errors

**Symptom**: PuppyStorage errors: "File not found: .../manifest.json"

**Cause**: Old `external_metadata` from template not cleaned up

**Check**:
```javascript
// In browser console
const block = /* problematic block */;
console.log('storage_class:', block.data.storage_class);
console.log('external_metadata:', block.data.external_metadata);

// If storage_class='internal' but external_metadata exists → BUG
```

**Expected**: Template instantiation should delete `external_metadata` when creating inline blocks

### Issue 3: Threshold Mismatch Between Template and Runtime

**Symptom**: Template creates inline block, first edit upgrades to external

**Cause**: Frontend threshold ≠ Template threshold

**Verification**:
```bash
# Check template threshold
grep -n "STORAGE_THRESHOLD" PuppyFlow/lib/templates/cloud.ts

# Check frontend threshold
grep -n "CONTENT_LENGTH_THRESHOLD" PuppyFlow/app/components/workflow/utils/dynamicStorageStrategy.ts

# Both should be: 1024 * 1024
```

---

## Automated Test Verification

Before manual E2E testing, run automated tests to catch threshold mismatches:

```bash
# Frontend tests
cd PuppyFlow
npm test -- storage-threshold-consistency.test.ts

# Backend tests
cd PuppyEngine
python -m pytest Server/test_storage_consistency.py -v

# All tests should PASS
```

---

## Success Checklist

After completing all scenarios:

- [ ] Small content (<1MB) uses internal storage in all three operations
- [ ] Large content (≥1MB) uses external storage with proper partitioning
- [ ] Boundary (exactly 1MB) triggers external storage consistently
- [ ] Template-created inline blocks don't upgrade on first edit
- [ ] Backend computation respects same threshold as frontend
- [ ] No "File not found" errors from PuppyStorage
- [ ] No threshold mismatches detected in console
- [ ] Automated tests pass (Frontend + Backend)

---

## Reporting Issues

If you find inconsistencies:

1. **Collect Evidence**:
   - Browser console logs (storage_class, sizes)
   - Network tab (upload requests)
   - PuppyStorage logs (errors)
   - Backend logs (BlockUpdateService)

2. **Create Issue**:
   - Title: "Storage threshold inconsistency: [specific scenario]"
   - Include: content size, expected vs actual storage_class
   - Attach: console logs, screenshots

3. **Reference**:
   - `docs/architecture/STORAGE_CONSISTENCY_BEST_PRACTICES.md`
   - PR that implemented alignment: #[TBD]

---

## Next Steps After Verification

Once all tests pass:

1. Update `docs/implementation/template-contract-mvp.md` with completion notes
2. Create PR for threshold alignment changes
3. Add to release notes: "Fixed storage threshold inconsistency"
4. Monitor production metrics: inline vs external storage ratio

Expected metric after fix:
- **Before**: ~80% external (due to 1KB threshold bug)
- **After**: ~10% external (only truly large content)
- **Impact**: 70% reduction in storage requests, faster workspace loading

