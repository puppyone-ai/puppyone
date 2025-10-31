# Template Resource Contract - Architecture Design Document

> **Status**: Draft  
> **Created**: 2025-10-20  
> **Author**: Architecture Team  
> **Type**: Architecture Decision Record (ADR)

## Executive Summary

This document defines the **Template Resource Contract**, a standardized system for managing, packaging, and distributing workflow templates with their associated resources across the PuppyAgent ecosystem.

**Problem**: Templates contain hardcoded resource references (e.g., `userId/blockId/versionId`) that fail authentication when instantiated by new users.

**Solution**: A contract-based system that decouples templates from user identity, enables Git-based version control, and supports both local and cloud deployment models.

---

## Table of Contents

- [1. Problem Analysis](#1-problem-analysis)
- [2. System Architecture](#2-system-architecture)
- [3. Contract Specification](#3-contract-specification)
- [4. Implementation Phases](#4-implementation-phases)
- [5. Future Extensions](#5-future-extensions)
- [6. References](#6-references)

---

## 1. Problem Analysis

### 1.1 Current State

**Symptom**: Workflow execution fails after template instantiation with authentication errors.

**Root Cause**:

```
Template JSON contains hardcoded resource keys:
  "resource_key": "8f3dbdc0-e742-4c6e-b041-a52fb32a2181/WzK6iT/20250918..."
                  ↑ Original creator's userId

New user instantiates → JSON copied directly → References not rewritten
                                              ↓
                                    Workflow execution fails
                                              ↓
                    PuppyStorage: check_resource_ownership(newUserId, oldUserId/...)
                                              ↓
                                      ❌ Authentication denied
```

**Impact**:

- 4 out of 5 templates fail to execute
- 28 hardcoded resource_key references found
- Blocks user adoption of templates

### 1.2 Workspace Lifecycle

```
┌─────────────┬──────────────┬──────────────┬──────────────┐
│  Creation   │   Editing    │  Execution   │   Deletion   │
├─────────────┼──────────────┼──────────────┼──────────────┤
│ Template    │ User adds    │ Engine reads │ Workspace    │
│ Selection   │ resources    │ resources    │ deleted      │
│     ↓       │     ↓        │     ↓        │     ↓        │
│ Create WS   │ Upload files │ Auth check   │ Orphaned     │
│     ↓       │     ↓        │     ↓        │ resources    │
│ ❌ Copy JSON│ ✅ New keys  │ ❌ Old keys  │ ⚠️ Not GC'd  │
└─────────────┴──────────────┴──────────────┴──────────────┘
```

### 1.3 Resource Types

| Type | Storage | Format | Key Pattern | Needs Copy |
|------|---------|--------|-------------|------------|
| External Storage | PuppyStorage | chunks + manifest | `${userId}/${blockId}/${versionId}/*` | ✅ Yes |
| Uploaded Files | PuppyStorage | Raw files | `${userId}/${workspaceId}/${fileId}` | ✅ Yes |
| Vector Data | Workflow JSON + Vector DB | Embedded metadata + vectors | `collection_{userId}_{model}_{setName}` | ❌ No (re-embed) |
| Inline Text | Workflow JSON | String | N/A | ❌ No |

#### Vector Data: Why Not Copy?

Vector data requires special handling due to its two-layer architecture:

**Layer 1: Metadata (Stored in Workflow JSON)**

```typescript
{
  type: 'vector',
  entries: [],                // ❌ Empty in template - generated at runtime
  status: 'pending',          // User needs to trigger indexing
  key_path: [...],            // ✅ Rules for extracting index content from source
  value_path: [...],          // ✅ Rules for extracting metadata
  index_name: '',             // Empty until user creates collection
  collection_configs: {}      // ❌ Empty in template - populated after re-embedding
}

// Entries are dynamically generated from content using key_path:
// entries = content.map(item => ({
//   content: getValueByPath(item, key_path),
//   metadata: { retrieval_content: getValueByPath(item, value_path) }
// }))
```

**Layer 2: Vectors (Stored in Vector Database)**

```python
# In PuppyStorage Vector DB
collection_{userId}_{model}_{setName}:
  - vector[0]: [0.123, -0.456, ..., 0.789]  # 1536-dim embedding
  - vector[1]: [0.234, -0.567, ..., 0.890]
  ...
```

**Critical Technical Reasons:**

1. **Latent Space Incompatibility**
   - Different deployments may use different embedding models
   - OpenAI ada-002 (1536-dim) ≠ Sentence-BERT (384-dim)
   - Copying vectors between incompatible latent spaces produces meaningless results

   ```text
   Template Creator: Uses OpenAI ada-002 → Latent Space A
   New User: Uses local Sentence-BERT → Latent Space B

   If vectors are copied: Query in Space B against vectors from Space A = ❌ Invalid
   ```

2. **Collection Ownership Isolation**
   - Collections are scoped to `user_id` for security and isolation
   - User B cannot access `collection_userA_model_set` without auth bypass
   - Creating new collection requires re-embedding anyway

3. **Vector Dimension Mismatch**
   - Vector DB enforces dimension consistency per collection
   - Attempting to query 384-dim against 1536-dim collection fails at API level

   ```python
   # This will fail if dimensions don't match
   collection = client.get_or_create_collection(
       name=collection_name,
       dimension=len(query_vector)  # Must match stored vectors
   )
   ```

4. **Performance and Cost Trade-offs**

   ```text
   Copying vectors:
   - 100 chunks × 1536 dims × 4 bytes = 600KB per template
   - S3 transfer time: ~2 seconds
   - Storage: 600KB × N users
   - Risk: Incompatible if target uses different model

   Re-embedding (MVP approach):
   - Copy chunks only: ~10KB
   - User re-embeds on demand: ~5 seconds
   - Storage: 10KB × N users
   - Benefit: Always compatible with target environment
   ```

**MVP Strategy:**

- Template includes `content` (source data) and `indexing_config` (key_path, value_path)
- Entries are NOT pre-generated or stored in template
- During instantiation:
  1. Upload content to user's external storage (partitioned for storage)
  2. Copy indexing_config to workflow JSON
  3. User's first access triggers: content → generate entries (using key_path) → re-embed
- Ensures entries always sync with content (single source of truth)
- Acceptable trade-off: 5-second embed time vs. guaranteed correctness + content-entry consistency

**Future Optimization (Phase 3):**

- Detect model compatibility before instantiation
- Conditionally copy vectors if source and target use identical embedding setup
- Provide UI warning if re-embedding is required

---

## 2. System Architecture

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  Template Ecosystem                     │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────┐      ┌──────────────┐              │
│  │   Official   │      │  User-Gen    │              │
│  │  Templates   │      │  Templates   │              │
│  │  (Git)       │      │  (S3/DB)     │              │
│  └──────┬───────┘      └──────┬───────┘              │
│         │                     │                       │
│         └─────────┬───────────┘                       │
│                   ↓                                   │
│         ┌─────────────────────┐                       │
│         │  Template Loader    │                       │
│         │  (Local/Cloud)      │                       │
│         └─────────┬───────────┘                       │
│                   ↓                                   │
│         ┌─────────────────────┐                       │
│         │  Instantiation      │                       │
│         │  Service            │                       │
│         │  - Extract resources│                       │
│         │  - Copy & rewrite   │                       │
│         │  - Create workspace │                       │
│         └─────────┬───────────┘                       │
│                   ↓                                   │
│         ┌─────────────────────┐                       │
│         │  User Workspace     │                       │
│         │  (with owned        │                       │
│         │   resources)        │                       │
│         └─────────────────────┘                       │
└─────────────────────────────────────────────────────────┘
```

### 2.2 Component Interactions

```
PuppyFlow (Frontend)
  └─ BlankWorkspace.tsx
       └─ POST /api/workspace/instantiate
            └─ CloudTemplateLoader
                 ├─ loadTemplate() → Git/CDN
                 └─ instantiateTemplate()
                      ├─ Read resources from Git
                      ├─ Upload to PuppyStorage
                      └─ Rewrite references

PuppyStorage (Backend)
  └─ StorageAdapter
       ├─ copy_resource() → S3 server-side copy
       └─ check_resource_ownership() → Auth

PuppyEngine (Execution)
  └─ Env.storage_client
       └─ Access resources with new keys ✅
```

### 2.3 Deployment Modes

| Mode | Template Source | Resource Storage | Loader Type | CDN |
|------|----------------|------------------|-------------|-----|
| **Local** | Git repo (local FS) | `local_storage/` | LocalTemplateLoader | ❌ No |
| **Cloud (MVP)** | Git repo (packaged) | S3/PuppyStorage | CloudTemplateLoader | ❌ No (Phase 3) |
| **Cloud (Full)** | CDN + Git | S3/PuppyStorage | UnifiedTemplateLoader | ✅ Yes |

---

## 3. Contract Specification

### 3.1 Template Package Structure

```typescript
interface TemplatePackage {
  metadata: TemplateMetadata;
  workflow: WorkflowDefinition;
  resources: ResourceManifest;
}

interface TemplateMetadata {
  id: string;                    // "agentic-rag"
  version: string;               // "1.0.0" (semver)
  name: string;
  description: string;
  author: string;
  created_at: string;
  
  // Deployment requirements
  requirements?: {
    min_engine_version?: string;
    min_storage_version?: string;
    required_features?: string[]; // ["vector_db", "file_upload"]
  };
  
  // Source tracking
  source?: {
    type: 'official' | 'user_generated' | 'community';
    author_id?: string;
    source_workspace_id?: string;
  };
}

interface ResourceManifest {
  format: 'embedded' | 'separate';
  resources: ResourceDescriptor[];
}

interface ResourceDescriptor {
  id: string;                    // "knowledge-base-content"
  type: ResourceType;
  block_id: string;              // Which block uses this
  mounted_path: string;          // Resource mount point in workflow (e.g., "data.external_metadata.resource_key")
  mounted_paths?: {              // For complex resources with multiple mount points
    content?: string;
    entries?: string;            // For vector collections: path to entries array
    indexing_config?: string;
  };
  
  source: ResourceSource;
  target: InstantiationTarget;
}

type ResourceType = 
  | 'external_storage'           // General data storage (text/structured)
  | 'file'                       // File resource (binary/text, always uploaded)
  | 'vector_collection';         // Vector indexing (structured only)

// Note: There is NO 'inline' ResourceType!
// "inline" is a storage_class state (internal vs external),
// determined at runtime based on content size.
// external_storage resources can be stored inline if < 1MB.

interface ResourceSource {
  path: string;                  // "resources/knowledge-base.json"
  format: 'text' | 'structured' | 'binary';
  mime_type?: string;            // Optional MIME type for binary files
}

// Format meanings:
// - 'text': Plain text files (.txt)
// - 'structured': JSON or other parsable data (.json, arrays/objects)
// - 'binary': Binary files like PDF, images (.pdf, .png, etc.)

interface InstantiationTarget {
  pattern: string;               // "${userId}/${blockId}/${versionId}"
  requires_user_scope: boolean;
  
  // Optional: Special handling for vector collections
  vector_handling?: 'preserve_entries_only' | 'none';
}

// Note: No 'strategy' field, no 'force_storage_class' override!
// Storage class is ALWAYS automatically inferred from:
//   - ResourceType (external_storage, file, vector_collection)
//   - source.format (text, structured, binary)
//   - Content size (< 1MB → internal/inline, ≥ 1MB → external)
// See: PuppyFlow/lib/storage/STORAGE_SPEC.md - "Inference Rules"
```

### 3.2 File System Layout

```
PuppyAgent-Jack/
└── PuppyFlow/
    ├── templates/                    # Git-managed templates
    │   ├── _schema.json             # JSON Schema for validation
    │   │
    │   ├── personal-rss/
    │   │   ├── package.json         # Template definition
    │   │   └── resources/           # (Optional: no resources for this template)
    │   │
    │   ├── agentic-rag/
    │   │   ├── package.json
    │   │   └── resources/
    │   │       ├── knowledge-base.json    # Raw, not chunked
    │   │       └── embeddings.json        # Vector data
    │   │
    │   ├── getting-started/
    │   │   ├── package.json
    │   │   └── resources/
    │   │       ├── guide-step1.json
    │   │       └── guide-step2.json
    │   │
    │   └── seo-blog/
    │       ├── package.json
    │       └── resources/
    │           ├── seo-knowledge.json
    │           └── writing-samples.json
    │
    ├── lib/
    │   ├── storage/
    │   │   ├── partitioning.ts      # PartitioningService (protocol-aligned)
    │   │   └── STORAGE_SPEC.md      # Storage & Partitioning protocol specification
    │   │
    │   ├── indexing/
    │   │   └── vector-indexing.ts   # VectorIndexing (direct implementation)
    │   │
    │   └── templates/
    │       ├── types.ts             # TypeScript interfaces
    │       ├── loader.ts            # TemplateLoader interface
    │       ├── local.ts             # LocalTemplateLoader
    │       ├── cloud.ts             # CloudTemplateLoader
    │       └── instantiator.ts      # Instantiation logic
    │
    └── app/api/
        └── workspace/
            └── instantiate/
                └── route.ts         # Instantiation API endpoint
```

### 3.3 Authentication for Resource Operations

**Critical Design Principle**: All resource uploads to PuppyStorage must use **user JWT token** (not SERVICE_KEY).

**Authentication Strategy**:

| Environment | Auth Header Source | Value | PuppyStorage Validation |
|-------------|-------------------|-------|------------------------|
| **Cloud** | `extractAuthHeader(request)` | User's real JWT token | RemoteAuthProvider verifies with PuppyUserSystem |
| **Localhost** | Fallback if no cookie | `Bearer local-dev` | LocalAuthProvider accepts (loose mode) |

**Implementation Pattern**:

```typescript
// In CloudTemplateLoader
private getUserAuthHeader(): string {
  if (this.userAuthHeader) {
    return this.userAuthHeader;  // Passed from /api/workspace/instantiate
  }
  
  // Localhost fallback (consistent with Engine proxy)
  if ((process.env.DEPLOYMENT_MODE || '').toLowerCase() !== 'cloud') {
    return 'Bearer local-dev';
  }
  
  throw new Error('Cloud deployment requires user authentication header');
}

// In /api/workspace/instantiate
const authHeader = extractAuthHeader(request);
const finalAuthHeader = authHeader || 
  ((process.env.DEPLOYMENT_MODE || '').toLowerCase() !== 'cloud' 
    ? 'Bearer local-dev' 
    : undefined);
const loader = TemplateLoaderFactory.create(undefined, finalAuthHeader);
```

**Why User Token (Not SERVICE_KEY)**:

1. **Resource Ownership**: Files must belong to the user's namespace (`${userId}/${blockId}/${versionId}`)
2. **Security Model**: PuppyStorage enforces user-scoped access control
3. **Consistency**: Same auth pattern as runtime file uploads (frontend → API → PuppyStorage)

**Comparison with PuppyEngine**:

| Component | Auth Source | Localhost Fallback | Implemented |
|-----------|-------------|-------------------|-------------|
| **PuppyEngine** | User JWT via proxy | ✅ `Bearer local-dev` | ✅ Yes |
| **CloudTemplateLoader** | User JWT from API | ✅ `Bearer local-dev` | ⚠️ Phase 3.5 |

**Reference Implementations**:

- ✅ Correct: `PuppyFlow/app/api/engine/[[...path]]/route.ts` (`filterRequestHeadersAndInjectAuth`)
- ✅ Correct: `PuppyEngine/Server/middleware/auth_middleware.py` (localhost handling)
- ✅ Correct: `PuppyStorage/server/auth.py` (`LocalAuthProvider` loose mode)

---

### 3.4 Resource Instantiation Flow

```
1. Load Template
   ├─ Read package.json from Git
   └─ Validate against schema

2. For each resource in manifest:
   ├─ Read source file (resources/*.json or resources/*.pdf)
   │
   ├─ Infer storage processing (automatic, see STORAGE_SPEC.md):
   │   ├─ type='file' → ALWAYS external + manifest.json
   │   │   ├─ Upload file to PuppyStorage (multipart upload)
   │   │   ├─ Create manifest.json with file metadata
   │   │   ├─ Upload manifest.json
   │   │   └─ Set storage_class='external' + external_metadata
   │   │
   │   └─ type='external_storage' or 'vector_collection' → check content size:
   │       ├─ < 1MB → storage_class='internal' (embed in JSON)
   │       └─ ≥ 1MB → storage_class='external' + partitioning (upload)
   │
   ├─ Generate new resource key:
   │   └─ ${newUserId}/${blockId}/${newVersionId}
   │
   └─ Update workflow reference:
       ├─ external_storage: 
       │   ├─ IF external: block.data.external_metadata.resource_key = newKey
       │   └─ IF inline: block.data.content = resourceContent
       │
       ├─ file (ALWAYS external, standard contract):
       │   ├─ block.data.external_metadata = {
       │   │     resource_key: '${userId}/${blockId}/${versionId}',
       │   │     content_type: 'files'
       │   │   }
       │   ├─ block.data.storage_class = 'external'
       │   └─ DO NOT set block.data.content (prefetch will handle it)
       │
       └─ vector_collection: 
            ├─ IF external: upload content, set external_metadata
            ├─ IF inline: block.data.content = resourceContent
            ├─ Keep indexingList[].key_path and value_path (extraction rules)
            ├─ Set indexingList[].entries = [] (empty, will be generated on-demand)
            ├─ Set indexingList[].status = 'notStarted' (NOT 'pending' - enum type)
            └─ Set indexingList[].collection_configs = {
                  set_name: '',
                  model: '',
                  vdb_type: 'pgvector',
                  user_id: userId,
                  collection_name: ''
                } (complete structure required for delete operation)

3. Create Workspace
   ├─ Call workspace store API
   └─ Save instantiated workflow JSON (all resources configured)

4. Return to user
   └─ { workspace_id, success: true }

---

---

## 3.5 Execution Flow (Runtime)

When user executes workflow with file/external resources:

### File Block Execution:
1. **Env.run()** detects block with `storage_class='external'`
2. **_start_prefetching()** triggers prefetch for file block
3. **ExternalStorageStrategy.resolve()** runs:
   - Fetches manifest.json from `${resource_key}/manifest.json`
   - Downloads each file to local temp directory
   - Updates block.data.content with: `[{ local_path, file_name, mime_type, ... }]`
   - Sets block.is_resolved = true
4. **ExecutionPlanner** marks block as "processed" (has content + resolved)
5. **Load Edge** executes:
   - Reads content[].local_path
   - Parses files from local temp
   - Returns parsed content

### Vector Collection Execution:
- User opens workspace → sees content in external storage
- User triggers indexing → entries generated from content using key_path
- System embeds entries → creates collection with user_id
- User can now use vector search

This ensures:
  ✓ File blocks follow standard prefetch mechanism
  ✓ Content is fetched just-in-time before execution
  ✓ Load edge always receives local_path (not remote keys)
  ✓ Consistent behavior between runtime upload and template instantiation
  ✓ Vector content is single source of truth
  ✓ Vector entries always sync with content
```

---

## 4. Implementation Phases

### Phase 0: Template Resources (1.5h)

**Deliverables**:

- 4 templates converted to package.json format
- 12 resource files extracted to Git
- Vector data corrected (content as SoT)

### Phase 1: Core Infrastructure (8h)

**Deliverables**:

- StorageAdapter.copy_resource() method
- /files/copy_resource API endpoint
- /api/storage/copy proxy endpoint
- Template whitelist security
- 9 comprehensive tests

### Phase 1.5: Clean Infrastructure (2.5h)

**Deliverables**:

- PartitioningService (protocol-aligned with PuppyEngine)
- VectorIndexing (direct implementation, Rule of Three)
- mounted_path naming (clearer semantics)
- STORAGE_SPEC.md protocol documentation

### Phase 1.7: Semantic Separation (10h) ✅ COMPLETED

**Deliverables**:

- Vector indexing terminology: `chunks` → `entries` (semantic units)
- Storage terminology: `chunks` → `parts` (physical storage units)
- Workflow chunk edges: kept as `chunks` (user-facing concept)
- Full backward compatibility (manifest fields, file names, env vars)
- Updated 30 files (~540 changes) across PuppyStorage, PuppyEngine, PuppyFlow
- Templates directory fully aligned
- STORAGE_SPEC.md v1.1 (semantic separation documented)

**Impact**:

- Clear semantic distinction between vector entries, storage parts, and workflow chunks
- 100% backward compatible with existing data
- Improved code maintainability and clarity

### Phase 1.9: Auto-Rebuild Vector Indexes (6-7h) ✅ COMPLETED

**Deliverables**:

- Extended Template Contract (`types.ts`) with embedding model configuration
- Model Bridge (`model-bridge.ts`) for type compatibility between Template Contract and AppSettingsContext
- Model Compatibility Service (`model-compatibility.ts`) for compatibility checking and model selection
- Vector Auto-Rebuild Service (`vector-auto-rebuild.ts`) for automatic index rebuilding
- Template Loader Interface (`loader.ts`) and Instantiation Context (`instantiation-context.ts`)
- Comprehensive test suite (3 test files, 57 test cases, 100% passing)
- Testing environment fully configured (Jest + ts-jest + jest-environment-jsdom)
- Updated all 4 templates with embedding requirements
- Documentation updates

**Technical Implementation**:

1. **Template Contract Extension**:
   - Added `embedding_model` field to `ResourceDescriptor.target`
   - Added `requirements.embedding_models` to `TemplateMetadata`
   - 100% backward compatible (all fields optional)

2. **Model Compatibility Detection**:
   - Exact match (high confidence) → auto_rebuild
   - Provider match (medium confidence) → warn_and_rebuild
   - Fallback strategy (low confidence) → auto_rebuild or manual_select or skip
   - Handles missing/inactive models gracefully

3. **Auto-Rebuild Logic**:
   - Checks compatibility before attempting rebuild
   - Extracts entries from content using VectorIndexing service
   - Triggers embedding (placeholder for Phase 2 integration)
   - Returns detailed result (success/pending/failed/skipped)

4. **Type Bridge**:
   - Normalizes Model from AppSettingsContext
   - Infers provider from model_id when missing
   - Filters embedding models only
   - Maps between template requirements and runtime models

**Impact**:

- Reduces user friction for template instantiation
- Automatic vector index rebuilding when compatible models available
- Clear fallback strategies for incompatible scenarios
- Comprehensive test coverage for compatibility scenarios (57/57 tests passing)
- Full testing environment configured and validated
- Ready for Phase 2 CloudTemplateLoader integration

**Files Created** (11 files):

- New: `PuppyFlow/lib/templates/model-bridge.ts` (186 lines, type bridge)
- New: `PuppyFlow/lib/templates/model-compatibility.ts` (221 lines, compatibility service)
- New: `PuppyFlow/lib/templates/vector-auto-rebuild.ts` (391 lines, auto-rebuild logic)
- New: `PuppyFlow/lib/templates/loader.ts` (16 lines, interface definition)
- New: `PuppyFlow/lib/templates/instantiation-context.ts` (13 lines, context types)
- New: `PuppyFlow/lib/templates/__tests__/model-compatibility.test.ts` (367 lines, 27 tests ✅)
- New: `PuppyFlow/lib/templates/__tests__/vector-auto-rebuild.test.ts` (367 lines, 17 tests ✅)
- New: `PuppyFlow/lib/templates/__tests__/integration.test.ts` (463 lines, 13 tests ✅)
- New: `PuppyFlow/jest.config.js` (39 lines, Jest configuration)
- New: `PuppyFlow/jest.setup.js` (2 lines, test setup)

**Files Modified** (6 files):

- Modified: `PuppyFlow/lib/templates/types.ts` (+20 lines, embedding model config)
- Modified: `PuppyFlow/templates/agentic-rag/package.json` (+18 lines, embedding requirements)
- Modified: `PuppyFlow/templates/file-load/package.json` (+3 lines, no embedding required)
- Modified: `PuppyFlow/templates/getting-started/package.json` (+3 lines, no embedding required)
- Modified: `PuppyFlow/templates/seo-blog/package.json` (+3 lines, no embedding required)
- Modified: `PuppyFlow/package.json` (+3 lines, test scripts)

### Phase 2: Template Loader (3h)

**Deliverables**:

- CloudTemplateLoader implementation
- Resource processing (external_storage, vector, file)
- Workflow reference mounting

### Phase 3: Integration (4h)

**Deliverables**:

- `/api/workspace/instantiate` endpoint
- Frontend integration (BlankWorkspace, CreateWorkspaceModal)
- Basic smoke test

### Phase 3.5: File Block Standard Compliance (4-6h) ✅ COMPLETED

**Status**: ✅ **Completed** (2025-10-31)

**Deliverables**:

- Fixed CloudTemplateLoader authentication (user JWT + localhost fallback)
- Rewrote file upload to use standard manifest.json flow
- Removed frontend workaround for internal file blocks
- File blocks now ALWAYS use external storage + prefetch mechanism

**Key Changes**:

- Authentication: `getUserAuthHeader()` with `Bearer local-dev` fallback
- File upload: `/upload/chunk/direct` API with manifest.json creation
- Frontend: Removed internal mode handling from `buildFileNodeJson()`
- Standards: Full compliance with FILE-BLOCK-CONTRACT.md

### Phase 3.7: Vector Collection Metadata Fix (0.5-1.5h) 🔍 DISCOVERED

**Status**: 🔍 **DISCOVERED** (Pre-implementation analysis: 2025-10-31)

**Issue Discovered**: During pre-testing review of agentic-rag template

**Problems Identified**:

1. **collection_configs missing or incomplete** → Delete index operation fails
2. **status enum mismatch** (`"pending"` should be `"notStarted"`)
3. **storage_class inconsistency** (semantic contradiction in template)

**Proposed Deliverables**:

**Option A (Minimal - 0.5h)**:

- Fix `agentic-rag/package.json` template metadata
- Add complete `collection_configs` structure
- Correct `status` enum value
- Fix `storage_class` contradiction

**Option B (Complete - 1-1.5h)**:

- All of Option A
- Improve `CloudTemplateLoader.processVectorCollection()` to ensure complete structure
- Add validation for vector collection metadata

**Impact**: Medium priority - does not block initial testing, but required for delete index functionality

**Decision**: Test first, implement fix if needed during agentic-rag testing

### Phase 4: Testing & Refinement (3h)

**Deliverables**:

- E2E testing (all 4 templates)
- Bug fixes
- Documentation finalization

**Success Criteria**:

- All 4 templates instantiate successfully
- Workflows execute without auth errors
- Resource keys correctly rewritten

### Phase 2: User-Generated Templates (+ 1 week)

**Scope**:

- ✅ Export workspace as template
- ✅ Private template sharing
- ✅ Template storage in user namespace
- ❌ No public marketplace yet
- ❌ No CDN yet

**New Capabilities**:

- `exportWorkspaceAsTemplate(workspaceId, metadata)`
- `shareTemplateWithUser(templateId, targetUserId)`
- User template storage: S3 or database

### Phase 3: Template Marketplace + CDN (+ 2 weeks)

**Scope**:

- ✅ Public template marketplace
- ✅ CDN distribution for popular templates
- ✅ Template discovery and search
- ✅ Usage statistics and ratings
- ✅ Template versioning

**New Components**:

- Template marketplace service
- CDN sync pipeline (CI/CD)
- UnifiedTemplateLoader (CDN + S3)
- Template analytics dashboard

**CDN Strategy**:

```
Tier 1: Official Templates
  → Auto-sync to CDN on release

Tier 2: Popular User Templates (downloads > 1000)
  → Auto-promote to CDN after review

Tier 3: Private/Unpopular User Templates
  → Remain in S3, no CDN overhead
```

### Phase 4: Advanced Features (+ 1 month)

- Template composition (dependencies)
- Paid templates
- Template update notifications
- A/B testing for templates
- Template analytics and recommendations

---

## 5. Future Extensions

### 5.1 Template Marketplace Architecture

```
┌──────────────────────────────────────────────────────┐
│                Template Marketplace                  │
├──────────────────────────────────────────────────────┤
│                                                      │
│  Discovery              Publishing             CDN   │
│  ┌────────┐           ┌─────────┐          ┌─────┐  │
│  │ Browse │           │ Publish │          │Cache│  │
│  │ Search │  ←────→   │ Review  │  ────→   │ &   │  │
│  │ Filter │           │ Version │          │Serve│  │
│  └────────┘           └─────────┘          └─────┘  │
│                                                      │
│  Analytics             Monetization                  │
│  ┌────────┐           ┌─────────┐                   │
│  │Downloads│          │ Pricing │                   │
│  │Ratings  │          │ Revenue │                   │
│  │Usage    │          │ Payouts │                   │
│  └────────┘           └─────────┘                   │
└──────────────────────────────────────────────────────┘
```

### 5.2 Template Dependencies

```json
{
  "metadata": {
    "id": "advanced-rag-with-tools",
    "dependencies": [
      {
        "template_id": "agentic-rag",
        "version": "^1.0.0",
        "required": true
      },
      {
        "template_id": "web-search-tool",
        "version": "~2.1.0",
        "required": false
      }
    ]
  }
}
```

### 5.3 Template Versioning

```
agentic-rag/
├── v1.0.0/
│   ├── package.json
│   └── resources/
├── v1.1.0/
│   ├── package.json
│   └── resources/
└── v2.0.0/
    ├── package.json
    └── resources/

Migration strategy:
- Breaking changes → Major version bump
- New features → Minor version bump
- Bug fixes → Patch version bump
- Auto-update policy configurable by user
```

### 5.4 Cross-Deployment Support

**Goal**: Single template works in both local and cloud deployments

```typescript
class UniversalTemplateLoader implements TemplateLoader {
  private mode: 'local' | 'cloud';
  
  async loadTemplate(templateId: string): Promise<TemplatePackage> {
    if (this.mode === 'local') {
      return this.loadFromFileSystem(templateId);
    } else {
      return this.loadFromCDN(templateId);
    }
  }
  
  async instantiateTemplate(pkg: TemplatePackage, userId: string) {
    // Universal logic works for both modes
    const resources = await this.copyResources(pkg.resources, userId);
    return this.rewriteReferences(pkg.workflow, resources);
  }
}
```

---

## 6. References

### 6.1 Related Documents

- [Getting Started with Templates](../getting-started.md)
- [Template Development Guide](../guides/template-development.md)
- [Storage Architecture](./storage-architecture.md)
- [Workspace Management](./workspace-management.md)

### 6.2 API Specifications

- [Template Instantiation API](../api/workspace-instantiate.md)
- [Template Loader Interface](../api/template-loader.md)
- [Storage Copy API](../api/storage-copy.md)

### 6.3 Code References

- Template Types: `PuppyFlow/lib/templates/types.ts`
- PartitioningService: `PuppyFlow/lib/storage/partitioning.ts`
- VectorIndexing: `PuppyFlow/lib/indexing/vector-indexing.ts`
- Cloud Loader: `PuppyFlow/lib/templates/cloud.ts`
- Instantiation API: `PuppyFlow/app/api/workspace/instantiate/route.ts`
- Storage Adapter: `PuppyStorage/storage/base.py`

### 6.4 External Resources

- [Semantic Versioning](https://semver.org/)
- [JSON Schema](https://json-schema.org/)
- [S3 Copy Object API](https://docs.aws.amazon.com/AmazonS3/latest/API/API_CopyObject.html)

---

## Appendix A: Migration Guide

### From Current System to Template Contract

```bash
# Step 1: Extract resources from existing templates
python tools/extract_template_resources.py

# Step 2: Convert to new format
python tools/convert_templates.py

# Step 3: Validate
python tools/validate_templates.py

# Step 4: Deploy
git add templates/
git commit -m "chore: migrate to Template Resource Contract"
git push
```

### Backward Compatibility

Old API will be deprecated but remain functional for 3 months:

```typescript
// Deprecated (will be removed in v2.0)
createWorkspaceWithContent(template)

// New API
instantiateTemplate(templateId, userId, workspaceName)
```

---

## Appendix B: Performance Benchmarks

| Operation | Current (Direct Copy) | With Contract | Target |
|-----------|----------------------|---------------|--------|
| Template Load | 50ms | 80ms | <100ms |
| Resource Copy (5MB) | N/A | 500ms (local) / 200ms (S3) | <1s |
| Total Instantiation | 100ms | 600ms | <2s |
| CDN-enabled Load | N/A | 30ms | <50ms |

---

## Change Log

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 0.1 | 2025-01-20 | Architecture Team | Initial draft |
| 0.1.1 | 2025-01-20 | Architecture Team | Added detailed technical explanation for Vector Data handling (§1.3) |
| 0.1.2 | 2025-01-23 | Architecture Team | Updated Phase breakdown, added Phase 1.5, renamed to mounted_path |
| 0.1.3 | 2025-01-25 | Architecture Team | Phase 1.7 semantic separation: chunks→entries (vector), chunks→parts (storage) |
| 0.1.4 | 2025-01-27 | Architecture Team | Phase 1.9 completed: Auto-rebuild vector indexes with 57 tests passing |
| 0.1.5 | 2025-10-31 | Architecture Team | Clarified file block contract: ALWAYS external + manifest.json (§3.4) |
|       |            |                   | Added execution flow documentation for file blocks and prefetch mechanism (§3.5) |
|       |            |                   | Documented Phase 3.5 refactoring plan for file block standard compliance |
| 0.1.6 | 2025-10-31 | Architecture Team | Added authentication section (§3.3) for resource operations |
|       |            |                   | Documented user JWT token requirement vs SERVICE_KEY |
|       |            |                   | Added localhost fallback strategy and comparison with PuppyEngine |
| 0.1.7 | 2025-10-31 | Architecture Team | Documented vector collection metadata requirements (Phase 3.7) |
|       |            |                   | Identified template state inconsistencies (collection_configs, status enum) |
|       |            |                   | Added clarification on storage_class semantics for vector collections |
| 0.2 | TBD | - | After MVP implementation |
| 1.0 | TBD | - | Production release |

---

**Document Status**: Draft  
**Next Review**: After MVP completion  
**Feedback**: Please file issues on GitHub or discuss in #architecture channel
