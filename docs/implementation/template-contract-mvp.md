# Template Resource Contract - MVP Implementation Plan

> **Phase**: MVP (Phase 1)  
> **Duration**: 2-3 days  
> **Status**: Ready for implementation  
> **Architecture Reference**: [Template Resource Contract Architecture](../architecture/template-resource-contract.md)

---

## Quick Links

- 📐 **Full Architecture**: [template-resource-contract.md](../architecture/template-resource-contract.md)
- 📋 **Task Tracking**: See TODOs section below
- 🧪 **Testing Guide**: See Testing section

---

## MVP Scope

### ✅ In Scope

- Official templates only (4 templates: personal-rss, agentic-rag, getting-started, seo-blog)
- Cloud deployment target
- Basic resource copying (S3 server-side copy)
- Template Contract core interfaces
- Git-based template storage
- Frontend integration

### ❌ Out of Scope (Future Phases)

- Local deployment support
- CDN distribution
- User-generated templates
- Template marketplace
- Resource cleanup/GC
- Workspace divergence refactoring

---

## Prerequisites

### Environment Confirmation

```bash
# Verify cloud deployment mode
echo $DEPLOYMENT_MODE  # Should be "cloud"

# Verify PuppyStorage access
curl http://localhost:8002/health

# Verify PuppyUserSystem access
curl http://localhost:8001/health
```

### Resource Preparation

**Critical Pre-step**: Extract existing template resources from current userIds.

Found hardcoded resources in templates:

- `8f3dbdc0-e742-4c6e-b041-a52fb32a2181` (RAG template)
- `110789d4-265d-4d70-97da-89c7a93bd580` (SEO, Getting Started, File Load)

**Action Required**: Confirm if these resources exist in PuppyStorage, or use example data.

---

## Implementation Tasks

### Phase 0: Resource Preparation (3-4 hours)

#### Task 0.1: Extract Resources

```bash
# Create extraction tool
cd PuppyAgent-Jack/tools
touch extract_template_resources.py
```

**Script logic**:

1. Parse existing template JSONs
2. Extract all `external_metadata.resource_key` references
3. Download resources from PuppyStorage (if accessible)
4. Save to `templates/*/resources/` in raw format

#### Task 0.2: Organize Directory Structure

```bash
mkdir -p PuppyFlow/templates/{agentic-rag,getting-started,seo-blog,personal-rss}/resources
```

Expected structure:

```
templates/
├── agentic-rag/
│   └── resources/
│       └── knowledge-base.json  # Combined from chunks
├── getting-started/
│   └── resources/
│       ├── guide-step1.json
│       └── guide-step2.json
├── seo-blog/
│   └── resources/
│       ├── seo-knowledge.json
│       └── ...
└── personal-rss/
    └── (no resources needed)
```

---

### Phase 1: Core Infrastructure (8h)

#### Task 1.1: Define TypeScript Interfaces (1h)

**File**: `PuppyFlow/lib/templates/types.ts`

```typescript
export interface TemplatePackage {
  metadata: TemplateMetadata;
  workflow: WorkflowDefinition;
  resources: ResourceManifest;
}

export interface TemplateMetadata {
  id: string;
  version: string;
  name: string;
  description: string;
  author: string;
  created_at: string;
}

export interface ResourceManifest {
  format: 'separate';
  resources: ResourceDescriptor[];
}

export interface ResourceDescriptor {
  id: string;
  type: 'external_storage' | 'file' | 'vector_data' | 'inline';
  block_id: string;
  reference_path: string;
  
  source: {
    path: string;
    format: 'raw_json' | 'pdf' | 'text';
  };
  
  target: {
    pattern: string;
    requires_user_scope: boolean;
    force_storage_class?: 'external' | 'internal';  // Optional override
  };
}

export interface WorkflowDefinition {
  blocks: any[];
  edges: any[];
  viewport: any;
  version: string;
}
```

#### Task 1.2: Extend StorageAdapter (1.5h)

**File**: `PuppyStorage/storage/base.py`

```python
@abstractmethod
def copy_resource(self, source_key: str, target_key: str) -> bool:
    """Copy resource (server-side for S3, file copy for local)"""
    pass
```

**File**: `PuppyStorage/storage/S3.py`

```python
def copy_resource(self, source_key: str, target_key: str) -> bool:
    try:
        copy_source = {'Bucket': self.bucket, 'Key': source_key}
        self.client.copy_object(
            CopySource=copy_source,
            Bucket=self.bucket,
            Key=target_key
        )
        return True
    except Exception as e:
        log_error(f"S3 copy failed: {e}")
        return False
```

**File**: `PuppyStorage/storage/local.py`

```python
def copy_resource(self, source_key: str, target_key: str) -> bool:
    import shutil
    source_path = self._get_file_path(source_key)
    target_path = self._get_file_path(target_key)
    self._ensure_directory_exists(target_path)
    shutil.copy2(source_path, target_path)
    return True
```

#### Task 1.3: Add Storage Copy API (1h)

**File**: `PuppyStorage/server/routes/management_routes.py`

```python
@management_router.post("/copy_resource")
async def copy_resource(
    source_key: str,
    target_key: str,
    storage: StorageAdapter = Depends(get_storage_adapter),
    current_user: User = Depends(verify_auth)
):
    # Validate: target must belong to current user
    if not target_key.startswith(f"{current_user.user_id}/"):
        raise HTTPException(403, "Unauthorized target namespace")
    
    success = storage.copy_resource(source_key, target_key)
    if not success:
        raise HTTPException(500, "Copy failed")
    
    return {"success": True, "target_key": target_key}
```

#### Task 1.4: Add PuppyFlow Proxy (0.5h)

**File**: `PuppyFlow/app/api/storage/copy/route.ts`

```typescript
export async function POST(request: Request) {
  const { sourceKey, targetKey } = await request.json();
  const userId = await getCurrentUserId(request);
  
  // Forward to PuppyStorage
  const response = await fetch(`${STORAGE_URL}/files/copy_resource`, {
    method: 'POST',
    headers: {
      ...authHeaders(request),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ source_key: sourceKey, target_key: targetKey })
  });
  
  return NextResponse.json(await response.json());
}
```

---

### Phase 1.5: Clean Infrastructure (2.5h)

**Completed**: ✅

**Deliverables**:

- PartitioningService (lib/storage/partitioning.ts)
  - Protocol-aligned with PuppyEngine
  - Unified partitioning logic
  - STORAGE_SPEC.md protocol documentation
  
- VectorIndexing (lib/indexing/vector-indexing.ts)
  - Direct implementation (YAGNI + Rule of Three)
  - extractEntries(), createPendingEntry(), validate()
  - No registry pattern (will abstract in Phase 4)
  
- Type updates
  - reference_path → mounted_path (clearer naming)
  - Updated in all template package.json files

**Key Design Decisions**:

- Direct implementation (no premature abstraction)
- Protocol SSOT (TypeScript ↔ Python alignment)
- mounted_path semantics (resource mount points)

**Benefits for Phase 2**:

- CloudTemplateLoader avoids ~150 lines of duplicate partitioning code
- Clean API for vector pending entry creation
- Clearer naming throughout

---

### Phase 1.7: Semantic Separation (10h)

**Completed**: ✅

**Deliverables**:

- Semantic disambiguation across entire codebase
  - Vector indexing: `chunks` → `entries` (semantic units for embedding)
  - Storage: `chunks` → `parts` (physical storage units)
  - Workflow edges: kept as `chunks` (user-facing concept)
  
- PuppyStorage API updates
  - New `/upload/part/direct` endpoint
  - Full backward compatibility with old `/upload/chunk/direct`
  
- Backend updates (3 Python files)
  - ExternalStorageStrategy.py: `_create_part_generator()`, `part_000000.*` naming
  - streaming_json_handler.py: `parse_jsonl_part()`, manifest fallback
  - EventFactory.py: `STORAGE_PART_SIZE` with env var fallback
  
- Frontend updates (5 TypeScript files)
  - vector-indexing.ts: `VectorEntry`, `extractEntries()`
  - UI components: `VectorIndexingItem.entries`
  - dynamicStorageStrategy.ts: `partitionContent()`, `uploadPartList()`
  - externalStorage.ts: manifest.parts with backward compat
  
- Documentation updates
  - STORAGE_SPEC.md v1.1 (renamed from CHUNKING_SPEC.md)
  - templates/ directory: README, MAINTENANCE, CHANGELOG
  - .env.example files: `STORAGE_PART_SIZE` with deprecation notes
  
- Files modified: 30 files, ~540 changes
- Backward compatibility: 100% (manifest fields, file names, env vars)

**Key Benefits**:

- Clear semantic distinction eliminates confusion
- Improved code maintainability and clarity
- Zero breaking changes for existing data
- Foundation for future CRDT partitioning work

---

### Phase 1.9: Auto-Rebuild Vector Indexes (6-7h)

**Completed**: ✅

**Deliverables**:

- Extended Template Contract with embedding model configuration
  - `types.ts`: Added `embedding_model` field to `ResourceDescriptor.target`
  - `types.ts`: Added `requirements.embedding_models` to `TemplateMetadata`
  - All fields optional for 100% backward compatibility
  
- Model Bridge and Compatibility Service
  - `model-bridge.ts`: Type compatibility layer between Template Contract and AppSettingsContext
  - `model-compatibility.ts`: Compatibility checking and model selection logic
  - Handles exact match, provider match, and fallback strategies
  
- Vector Auto-Rebuild Service
  - `vector-auto-rebuild.ts`: Automatic index rebuilding during template instantiation
  - Integrates with VectorIndexing service for entry extraction
  - Returns detailed results (completed/pending/failed/skipped)
  
- Template Loader Interface
  - `loader.ts`: Interface definition for Phase 2 implementation
  - `instantiation-context.ts`: Context data for template instantiation
  - Prepared for CloudTemplateLoader integration
  
- Comprehensive Testing (✅ All tests passing)
  - `__tests__/model-compatibility.test.ts`: 27 test cases for compatibility checking
  - `__tests__/vector-auto-rebuild.test.ts`: 17 test cases for auto-rebuild logic
  - `__tests__/integration.test.ts`: 13 end-to-end integration scenarios
  - **Total: 57 tests across 3 test suites, 100% passing**
  
- Testing Environment Configuration
  - Jest + ts-jest + jest-environment-jsdom configured
  - `jest.config.js` and `jest.setup.js` created
  - Test scripts added to `package.json` (test, test:watch, test:coverage)
  
- Template Configuration Updates
  - `templates/agentic-rag/package.json`: Added embedding requirements and fallback strategy
  - `templates/file-load/package.json`: Marked as no embedding required
  - `templates/getting-started/package.json`: Marked as no embedding required
  - `templates/seo-blog/package.json`: Marked as no embedding required

**Files Created** (11 files):

```
PuppyFlow/lib/templates/
├── model-bridge.ts                  (186 lines, type bridge)
├── model-compatibility.ts           (221 lines, compatibility service)
├── vector-auto-rebuild.ts           (391 lines, auto-rebuild logic)
├── loader.ts                        (16 lines, interface definition)
├── instantiation-context.ts         (13 lines, context types)
└── __tests__/
    ├── model-compatibility.test.ts  (367 lines, 27 tests ✅)
    ├── vector-auto-rebuild.test.ts  (367 lines, 17 tests ✅)
    └── integration.test.ts          (463 lines, 13 tests ✅)

PuppyFlow/
├── jest.config.js                   (39 lines, Jest configuration)
└── jest.setup.js                    (2 lines, test setup)
```

**Files Modified** (6 files):

```
PuppyFlow/lib/templates/types.ts                      (+20 lines, embedding model config)
PuppyFlow/templates/agentic-rag/package.json          (+18 lines, embedding requirements)
PuppyFlow/templates/file-load/package.json            (+3 lines, no embedding required)
PuppyFlow/templates/getting-started/package.json      (+3 lines, no embedding required)
PuppyFlow/templates/seo-blog/package.json             (+3 lines, no embedding required)
PuppyFlow/package.json                                (+3 lines, test scripts)
```

**Key Benefits**:

- Reduces user friction for template instantiation
- Automatic vector index rebuilding when compatible models available
- Clear fallback strategies for incompatible scenarios (auto/manual/skip)
- Type-safe bridge between Template Contract and AppSettingsContext
- Comprehensive test coverage (57 test cases, 100% passing)
- Full testing environment configured (Jest + ts-jest)
- Ready for Phase 2 CloudTemplateLoader integration

**Technical Highlights**:

- Compatibility Detection: 4 levels (exact match, provider match, fallback, skip)
- Model Normalization: Handles optional fields and infers provider from model_id
- Batch Operations: Support for multiple vector resources
- Error Handling: Graceful degradation for missing/inactive models
- Placeholder Integration: Embedding API call prepared for Phase 2

**Phase 2 Integration Points**:

- CloudTemplateLoader will call `VectorAutoRebuildService.attemptAutoRebuild()`
- `availableModels` will be passed from frontend via InstantiationContext
- Embedding API endpoint (`/api/storage/vector/embed`) will be implemented
- Auto-rebuild results will be displayed in UI after instantiation

**Testing Framework Note**:

Phase 1.9 currently uses **Jest + ts-jest + jsdom** for testing. The team is implementing a unified **Vitest** framework for frontend testing. Migration is planned after Phase 2-3 completion to:

- Unify testing strategy across the codebase
- Leverage Vitest's performance benefits (2-5x faster)
- Minimize disruption during active Phase 2 development

**Migration Plan** (Post Phase 2-3):

- ✅ Tests are API-compatible (0 code changes needed)
- ✅ Estimated migration time: 2-3 hours
- ✅ Expected performance gain: 2-5x faster execution
- 📋 Will migrate alongside other test suites for consistency

---

### Phase 2: Template Loader & Instantiation (7h actual)

**Status**: ✅ **Completed**

**Actual Duration**: ~7 hours (vs 3h estimated)

**Completed**: January 28, 2025

---

#### Task 2.1: Implement CloudTemplateLoader ✅

**File**: `PuppyFlow/lib/templates/cloud.ts` (548 lines)

**Implemented Methods**:

- ✅ `loadTemplate(templateId)` - Load templates from filesystem (`templates/${templateId}/package.json`)
- ✅ `instantiateTemplate(pkg, userId, workspaceId, availableModels)` - Process resources and clone workflow
- ✅ `processResource(resource, userId, workspaceId, workflow, availableModels)` - Handle different resource types
- ✅ `uploadWithPartitioning(content, format, targetKey)` - Partition and upload with PartitioningService
- ✅ `updateWorkflowReference(workflow, blockId, path, newValue)` - JSONPath updates using lodash.set
- ✅ `processExternalStorage()` - Handle external_storage resources with automatic storage strategy
- ✅ `processVectorCollection()` - Integrate with VectorAutoRebuildService for vector resources
- ✅ `processFile()` - Handle file resources (placeholder for future implementation)

**Key Implementation Details**:

- **Automatic Storage Strategy**: 1MB threshold for inline vs external storage (aligned with STORAGE_SPEC.md)
- **Vector Auto-Rebuild Integration**: Calls `VectorAutoRebuildService.attemptAutoRebuild()` for vector_collection resources
- **Error Handling**: Comprehensive try-catch with detailed error messages
- **Validation**: `validateTemplatePackage()` ensures correct structure before processing

**Technical Highlights**:

- No resources to process: Direct workflow return (e.g., getting-started template)
- External storage: Automatic partitioning for content >1MB
- Vector collections: Model compatibility check and auto-rebuild
- File resources: Prepared for Phase 3+ implementation

---

#### Task 2.2: Template Migration ✅

**Completed Template**: `getting-started` (prioritized for validation)

**File**: `PuppyFlow/templates/getting-started/package.json` (722 lines)

**Migration Source**: 
- ❌ Original plan: `onboarding_guide.json` (3 simple blocks)
- ✅ Actual source: `finalgetstarted.json` (18 blocks, 6 tutorial sections)

**Template Content**:
```json
{
  "metadata": {
    "id": "getting-started",
    "version": "1.0.0",
    "name": "Getting Started",
    "description": "A comprehensive introduction to PuppyFlow with 6 tutorial sections.",
    "author": "PuppyAgent Team",
    "created_at": "2025-01-23T00:00:00Z",
    "tags": ["onboarding", "tutorial", "guide", "beginner", "comprehensive"],
    "requirements": {
      "embedding_models": null
    }
  },
  "workflow": {
    "blocks": [18 blocks],
    "edges": [10 edges],
    "viewport": { ... }
  },
  "resources": {
    "format": "inline",
    "resources": []
  }
}
```

**Template Sections**:
1. ✅ Text Block - Unstructured content
2. ✅ Structured Text Block - JSON-like structure
3. ✅ File Block - File handling
4. ✅ LLM - Language model integration
5. ✅ Structure Content - Chunking demonstration
6. ✅ Retrieve and Generation - Complete RAG workflow

---

### Phase 3: Integration (Completed with Phase 2)

**Status**: ✅ **Completed**

---

#### Task 3.1: Create Instantiation API ✅

**File**: `PuppyFlow/app/api/workspace/instantiate/route.ts` (184 lines)

**Implementation**:

```typescript
export async function POST(request: Request) {
  const body = await request.json();
  const { templateId, workspaceName, availableModels } = body;
  
  const userId = await getCurrentUserId(request);
  const loader = TemplateLoaderFactory.create();
  
  // Load template
  const pkg = await loader.loadTemplate(templateId);
  
  // Generate workspace ID (backend-controlled)
  const workspaceId = uuidv4();
  
  // Instantiate template with user-specific resources
  const content = await loader.instantiateTemplate(
    pkg,
    userId,
    workspaceId,
    availableModels || []
  );
  
  // Save to database with retry logic
  const store = getWorkspaceStore();
  const authHeader = extractAuthHeader(request);
  const timestamp = new Date().toISOString();
  
  try {
    await store.addHistory(workspaceId, { history: content, timestamp }, { authHeader });
  } catch (e) {
    // Retry logic: Create workspace if not found, then retry save
    if (isNotFound(e)) {
      await store.createWorkspace(userId, { workspace_id: workspaceId, workspace_name: workspaceName }, { authHeader });
      await store.addHistory(workspaceId, { history: content, timestamp }, { authHeader });
    } else {
      throw e;
    }
  }
  
  return NextResponse.json({
    success: true,
    workspace_id: workspaceId,
    template_id: templateId,
    template_name: pkg.metadata.name,
    template_version: pkg.metadata.version,
    blocks_count: content.blocks.length,
    edges_count: content.edges.length,
  });
}
```

**Critical Bug Fix #1**: **Retry Logic for Workspace Creation**

**Problem**: `addHistory` could fail if workspace didn't exist yet, but error was silently swallowed.

**Solution**: Added try-catch with retry:
- Try `addHistory` first
- If 404 (workspace not found), create workspace and retry
- Throw error if it's not a "not found" error

---

#### Task 3.2: Update Frontend ✅

**Files Modified**: 3 files

**File 1**: `PuppyFlow/app/components/blankworkspace/BlankWorkspace.tsx`

**Changes**:
- ✅ Added `createWorkspaceFromTemplate(templateId, workspaceName)` method
- ✅ Updated `templates` array with `templateId` field for each template
- ✅ Integrated with `workspaceManagement.switchToWorkspace()` for data fetching
- ✅ Passed `availableModels` from `useAppSettings()` to API

**File 2**: `PuppyFlow/app/components/blankworkspace/CreateWorkspaceModal.tsx`

**Changes**:
- ✅ Added `onCreateWorkspaceFromTemplate` prop
- ✅ Updated `handleCreateOption` to check for `templateId` and route accordingly
- ✅ Backward compatible with old `onCreateWorkspace` flow

**File 3**: `PuppyFlow/app/components/sidebar/AddNewWorkspaceButton.tsx`

**Changes**:
- ✅ Added `createWorkspaceFromTemplate` method (mirrors BlankWorkspace)
- ✅ Passed `availableModels` from `useAppSettings()`
- ✅ Updated to fetch content after API success

**Critical Bug Fix #2**: **Workspace ID Mismatch**

**Problem**: Frontend generated ID-A, backend generated ID-B, causing data fetch to fail.

**Solution**: 
- Backend generates workspace ID
- Frontend uses `result.workspace_id` from API response
- Ensures consistency between creation and fetching

**Critical Bug Fix #3**: **Data Flow断裂**

**Problem**: Frontend only set `pullFromDatabase: true` flag without actually fetching content.

**Solution**:
```typescript
// After API success, fetch actual content
const switchResult = await workspaceManagement.switchToWorkspace(workspaceId, optimistic);

// Update workspace with real content
updateWorkspace(workspaceId, {
  content: switchResult.content,  // 18 blocks!
  pullFromDatabase: true,
});
```

---

### Phase 4: Testing & Bug Fixes ✅

**Status**: ✅ **Completed**

---

#### Task 4.1: End-to-End Testing ✅

**Test Results** (getting-started template):

| Test Case | Status | Result |
|-----------|--------|--------|
| Create workspace | ✅ Pass | Workspace created with correct ID |
| Content loading | ✅ Pass | 18 blocks + 10 edges loaded |
| UI rendering | ✅ Pass | All 6 tutorial sections displayed |
| Data persistence | ✅ Pass | Content saved to PuppyDB |
| Workspace switching | ✅ Pass | Content loads correctly on switch |
| No empty workspace | ✅ Pass | No "Clearing ReactFlow canvas" errors |

**Console Validation**:
```
[AddNewWorkspaceButton] ✅ API returned success. Workspace ID: xxx
[AddNewWorkspaceButton] 📦 Created optimistic workspace
[AddNewWorkspaceButton] 🔄 Fetching workspace content from database...
[AddNewWorkspaceButton] ✅ Fetched content with 18 blocks
[AddNewWorkspaceButton] ✅ Successfully instantiated template
```

---

#### Task 4.2: Critical Bug Fixes ✅

**Bug #1: Workspace ID Mismatch**

**Symptoms**: Empty workspace displayed, data not found

**Root Cause**: 
```typescript
// Frontend generated ID-A
const workspaceId = uuidv4();

// Backend generated ID-B (different!)
const workspaceId = uuidv4();

// Frontend tried to fetch with ID-A → 404
```

**Fix**: Backend-controlled ID generation
```typescript
// Backend returns ID
return { success: true, workspace_id: backendGeneratedId };

// Frontend uses it
const workspaceId = result.workspace_id;
```

**Files Modified**: 
- `app/api/workspace/instantiate/route.ts`
- `app/components/blankworkspace/BlankWorkspace.tsx`
- `app/components/sidebar/AddNewWorkspaceButton.tsx`

---

**Bug #2: Data Save Failure Silently Swallowed**

**Symptoms**: API returned success, but workspace was empty

**Root Cause**:
```typescript
try {
  await store.addHistory(...);
} catch (error) {
  console.warn("Failed but return success anyway");
}
return { success: true };  // ❌ Lie!
```

**Fix**: Retry logic with workspace creation
```typescript
try {
  await store.addHistory(...);
} catch (e) {
  if (isNotFound(e)) {
    await store.createWorkspace(...);
    await store.addHistory(...);  // Retry
  } else {
    throw e;  // Real error
  }
}
```

**Inspiration**: Copied pattern from existing `/api/workspace` POST endpoint

**Files Modified**: `app/api/workspace/instantiate/route.ts`

---

**Bug #3: Data Flow断裂 (Missing Content Fetch)**

**Symptoms**: ReactFlow cleared canvas for "empty workspace"

**Root Cause**:
```typescript
// Only set flag, no actual data
updateWorkspace(workspaceId, {
  pullFromDatabase: true,  // ❌ Just a flag!
});
```

**Fix**: Actually fetch content
```typescript
// Fetch from database
const switchResult = await workspaceManagement.switchToWorkspace(workspaceId);

// Update with real content
updateWorkspace(workspaceId, {
  content: switchResult.content,  // ✅ 18 blocks!
  pullFromDatabase: true,
});
```

**Inspiration**: Copied pattern from `FlowElement.tsx` workspace switching logic

**Files Modified**:
- `app/components/blankworkspace/BlankWorkspace.tsx`
- `app/components/sidebar/AddNewWorkspaceButton.tsx`

---

**Bug #4: Wrong Template Source File**

**Symptoms**: Only 3 simple blocks instead of 18 tutorial blocks

**Root Cause**: Used `onboarding_guide.json` instead of `finalgetstarted.json`

**Fix**: 
```bash
# Copy correct source
cp app/components/blankworkspace/templete/finalgetstarted.json \
   templates/getting-started/workflow.json

# Merge into package.json
python3 merge_workflow.py
```

**Result**: 18 blocks with 6 complete tutorial sections

**Files Modified**: `templates/getting-started/package.json`

---

## Phase 2 File Changes Summary

### New Files (Phase 2)

```
PuppyFlow/lib/templates/cloud.ts                       (548 lines, CloudTemplateLoader)
PuppyFlow/app/api/workspace/instantiate/route.ts       (184 lines, Instantiation API)
```

### Modified Files (Phase 2)

```
PuppyFlow/lib/templates/loader.ts                      (+8 lines, TemplateLoaderFactory)
PuppyFlow/templates/getting-started/package.json       (722 lines, complete template)
PuppyFlow/app/components/blankworkspace/BlankWorkspace.tsx        (+80 lines, new flow)
PuppyFlow/app/components/blankworkspace/CreateWorkspaceModal.tsx  (+15 lines, templateId support)
PuppyFlow/app/components/sidebar/AddNewWorkspaceButton.tsx        (+80 lines, new flow)
docs/architecture/template-resource-contract.md        (updated)
docs/implementation/template-contract-mvp.md           (updated)
```

### Deferred to Phase 3+ (Not in Phase 2)

```
PuppyFlow/app/api/storage/copy/route.ts                (copy API for resources with external files)
PuppyStorage/server/routes/management_routes.py        (copy_resource endpoint)
PuppyStorage/storage/base.py                           (+ copy_resource method)
PuppyStorage/storage/S3.py                             (+ copy_resource implementation)
PuppyStorage/storage/local.py                          (+ copy_resource implementation)
PuppyFlow/templates/agentic-rag/package.json           (template with resources)
PuppyFlow/templates/agentic-rag/resources/*.json       (actual resource files)
PuppyFlow/templates/seo-blog/package.json              (template with resources)
PuppyFlow/templates/personal-rss/package.json          (template with resources)
tools/extract_template_resources.py                    (resource extraction tool)
```

### Deprecated Files (to remove later)

```
PuppyFlow/lib/templates/workspaceTemplates.json
PuppyFlow/app/components/blankworkspace/templete/*.json
```

---

## Testing Checklist

### Phase 1.9 Tests ✅

- [x] 57 unit and integration tests passing (Jest)
- [x] Model compatibility detection working
- [x] Vector auto-rebuild logic validated
- [x] Type bridge between Template Contract and AppSettingsContext verified

### Phase 2-3 Integration Tests ✅

- [x] All TypeScript interfaces compile without errors
- [x] Template loads from filesystem successfully
- [x] Workflow JSON references rewritten correctly (for resources)
- [x] Frontend creates workspace successfully
- [x] getting-started template instantiates with 18 blocks
- [x] No empty workspace issue
- [x] No regressions in existing workspace operations
- [ ] Storage copy API works for both S3 and local (deferred to Phase 3+)
- [ ] Resources instantiate with correct keys (deferred to Phase 3+)
- [ ] All 4 templates execute workflows without auth errors (getting-started ✅, others deferred)

### Post Phase 2-3: Vitest Migration

- [ ] Migrate Jest tests to Vitest (2-3h)
- [ ] Verify all 57+ tests pass under Vitest
- [ ] Update CI/CD pipeline for Vitest
- [ ] Document performance improvements

---

## Rollback Plan

If critical issues arise:

1. **Revert frontend changes**: Restore old `createWorkspaceWithContent` flow
2. **Keep new APIs**: They don't break existing functionality
3. **Templates remain**: New format is additive, old format still works
4. **Emergency fix window**: 2 hours to identify issue and revert

---

## Success Metrics

1. **Functional**: All 4 templates work end-to-end
2. **Performance**: Instantiation completes in <2 seconds
3. **Reliability**: 0 authentication errors during workflow execution
4. **Code Quality**: All linter checks pass
5. **Documentation**: Architecture and implementation docs complete

---

## Post-MVP Actions

1. Create GitHub issue for Phase 2 (User-Generated Templates)
2. Document any technical debt or workarounds
3. Gather user feedback on template experience
4. Plan workspace divergence cleanup (separate effort)
5. **Migrate Phase 1.9 tests from Jest to Vitest** (2-3h, after team Vitest framework is ready)
   - Coordinate with frontend team on unified testing strategy
   - Verify all 57 tests pass under Vitest
   - Update documentation and CI/CD configuration

---

## Questions & Decisions Log

| Question | Decision | Rationale | Date |
|----------|----------|-----------|------|
| Use CDN in MVP? | ❌ No | Premature optimization, adds complexity | 2025-01-20 |
| Support local deployment in MVP? | ❌ No | Focus on cloud users first | 2025-01-20 |
| Clean up workspace divergence now? | ❌ No | Orthogonal concern, separate PR | 2025-01-20 |
| Resource format in Git? | Raw JSON, not chunked | Easier to edit and review | 2025-01-20 |

---

**Ready to start implementation?** All prerequisites documented, architecture defined, tasks clearly scoped.

**Estimated completion**: 2-3 days with focused effort.
