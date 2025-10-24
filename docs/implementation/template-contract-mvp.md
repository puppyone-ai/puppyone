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
    strategy: 'copy_and_chunk' | 'copy_raw' | 'skip';
    pattern: string;
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
- ChunkingService (lib/storage/chunking.ts)
  - Protocol-aligned with PuppyEngine
  - Unified chunking logic
  - CHUNKING_SPEC.md protocol documentation
  
- VectorIndexing (lib/indexing/vector-indexing.ts)
  - Direct implementation (YAGNI + Rule of Three)
  - extractChunks(), createPendingEntry(), validate()
  - No registry pattern (will abstract in Phase 4)
  
- Type updates
  - reference_path → mounted_path (clearer naming)
  - Updated in all template package.json files

**Key Design Decisions**:
- Direct implementation (no premature abstraction)
- Protocol SSOT (TypeScript ↔ Python alignment)
- mounted_path semantics (resource mount points)

**Benefits for Phase 2**:
- CloudTemplateLoader avoids ~150 lines of duplicate chunking code
- Clean API for vector pending entry creation
- Clearer naming throughout

---

### Phase 2: Template Loader (3h)

#### Task 2.1: Implement CloudTemplateLoader (3h)

**File**: `PuppyFlow/lib/templates/cloud.ts`

Key methods:

- `loadTemplate(templateId)` - Read from Git
- `instantiateTemplate(pkg, userId, workspaceId)` - Copy resources & rewrite
- `uploadWithChunking(content, targetKey)` - Chunk and upload
- `updateReference(workflow, blockId, path, newValue)` - JSONPath update

See architecture doc for detailed implementation.

#### Task 2.2: Convert One Template (1h)

**File**: `PuppyFlow/templates/agentic-rag/package.json`

```json
{
  "metadata": {
    "id": "agentic-rag",
    "version": "1.0.0",
    "name": "Agentic RAG",
    "author": "PuppyAgent Team",
    "created_at": "2025-01-20T00:00:00Z"
  },
  "workflow": {
    "blocks": [...],
    "edges": [...]
  },
  "resources": {
    "format": "separate",
    "resources": [
      {
        "id": "knowledge-base",
        "type": "external_storage",
        "block_id": "knowledge_block",
        "reference_path": "data.external_metadata.resource_key",
        "source": {
          "path": "resources/knowledge-base.json",
          "format": "raw_json"
        },
        "target": {
          "strategy": "copy_and_chunk",
          "pattern": "${userId}/${blockId}/${versionId}"
        }
      }
    ]
  }
}
```

---

### Phase 3: Integration (4h)

#### Task 3.1: Create Instantiation API (2h)

**File**: `PuppyFlow/app/api/workspace/instantiate/route.ts`

```typescript
export async function POST(request: Request) {
  const { templateId, workspaceName } = await request.json();
  const userId = await getCurrentUserId(request);
  
  const loader = new CloudTemplateLoader();
  const pkg = await loader.loadTemplate(templateId);
  
  const workspaceId = uuidv4();
  const content = await loader.instantiateTemplate(pkg, userId, workspaceId);
  
  const store = getWorkspaceStore();
  await store.createWorkspace(userId, { workspace_id: workspaceId, workspace_name: workspaceName });
  await store.addHistory(workspaceId, { history: content, timestamp: new Date().toISOString() });
  
  return NextResponse.json({ success: true, workspace_id: workspaceId });
}
```

#### Task 3.2: Update Frontend (2h)

**File**: `PuppyFlow/app/components/blankworkspace/BlankWorkspace.tsx`

Replace `createWorkspaceWithContent()` with call to new API:

```typescript
const response = await fetch('/api/workspace/instantiate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify({ templateId, workspaceName })
});
```

**File**: `PuppyFlow/app/components/blankworkspace/CreateWorkspaceModal.tsx`

Update template selection to pass `templateId` instead of content.

---

### Phase 4: Testing & Refinement (3h)

#### Task 4.1: End-to-End Testing (3h)

Test matrix:

| Template | Test Case | Expected Result |
|----------|-----------|----------------|
| agentic-rag | Create workspace | ✅ Created |
| agentic-rag | Open workspace | ✅ Resources loaded |
| agentic-rag | Run workflow | ✅ Executes without auth error |
| agentic-rag | Check resource_key | ✅ Contains new userId |
| seo-blog | Create + Run | ✅ Success |
| getting-started | Create + Run | ✅ Success |
| personal-rss | Create + Run | ✅ Success (no resources) |

#### Task 4.2: Bug Fixes (1h)

Common issues to watch:

- Resource key path resolution
- Chunk upload failures
- Manifest format errors
- Frontend state updates

---

## File Changes Summary

### New Files

```
docs/architecture/template-resource-contract.md
docs/implementation/template-contract-mvp.md
PuppyFlow/lib/templates/types.ts
PuppyFlow/lib/templates/loader.ts
PuppyFlow/lib/templates/cloud.ts
PuppyFlow/templates/agentic-rag/package.json
PuppyFlow/templates/agentic-rag/resources/*.json
PuppyFlow/templates/getting-started/package.json
PuppyFlow/templates/seo-blog/package.json
PuppyFlow/templates/personal-rss/package.json
PuppyFlow/app/api/workspace/instantiate/route.ts
PuppyFlow/app/api/storage/copy/route.ts
PuppyStorage/server/routes/management_routes.py (copy_resource)
tools/extract_template_resources.py
```

### Modified Files

```
PuppyStorage/storage/base.py (+ copy_resource method)
PuppyStorage/storage/S3.py (+ copy_resource implementation)
PuppyStorage/storage/local.py (+ copy_resource implementation)
PuppyFlow/app/components/blankworkspace/BlankWorkspace.tsx
PuppyFlow/app/components/blankworkspace/CreateWorkspaceModal.tsx
```

### Deprecated Files (to remove later)

```
PuppyFlow/lib/templates/workspaceTemplates.json
PuppyFlow/app/components/blankworkspace/templete/*.json
```

---

## Testing Checklist

- [ ] All TypeScript interfaces compile without errors
- [ ] Storage copy API works for both S3 and local
- [ ] Template loads from Git successfully
- [ ] Resources instantiate with correct keys
- [ ] Workflow JSON references rewritten correctly
- [ ] Frontend creates workspace successfully
- [ ] All 4 templates execute workflows without auth errors
- [ ] No regressions in existing workspace operations

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
