# Template Resource Contract - Architecture Design Document

> **Status**: Draft  
> **Created**: 2025-01-20  
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
  chunks: [...],              // ✅ Original text - copied with JSON
  collection_configs: {
    user_id: string,          // ← Owner identity
    model: string,            // ← Embedding model (e.g., 'text-embedding-ada-002')
    vdb_type: string,         // ← Vector DB type (pgvector/pinecone)
    collection_name: string   // → Reference to actual vectors
  }
}
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

- Template includes original text `chunks` (embedded in JSON, ~10KB)
- User re-embeds chunks with their own embedding model on instantiation
- Ensures compatibility across different deployment configurations
- Acceptable trade-off: 5-second embed time vs. guaranteed correctness

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
  reference_path: string;        // JSONPath to the reference
  
  source: ResourceSource;
  target: InstantiationTarget;
}

type ResourceType = 
  | 'external_storage'           // Chunked content (needs copy)
  | 'file'                       // Single file (needs copy)
  | 'vector_collection'          // Vector embeddings (re-embed, not copy)
  | 'inline_data';               // Embedded in JSON (copied with JSON)

interface ResourceSource {
  path: string;                  // "resources/knowledge-base.json"
  format: 'raw_json' | 'pdf' | 'embeddings' | 'text';
  checksum?: string;             // SHA256 for verification
}

interface InstantiationTarget {
  strategy: 'copy_and_chunk'     // For external_storage: copy + chunk
           | 'copy_raw'          // For files: copy as-is
           | 're-embed'          // For vector_collection: re-compute embeddings
           | 'reference'         // Keep original reference (rare)
           | 'skip';             // No action needed (inline data)
  pattern: string;               // "${userId}/${blockId}/${versionId}"
  requires_user_scope: boolean;
}
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

### 3.3 Resource Instantiation Flow

```
1. Load Template
   ├─ Read package.json from Git
   └─ Validate against schema

2. For each resource in manifest:
   ├─ Read source file (resources/*.json)
   │
   ├─ Apply instantiation strategy:
   │   ├─ copy_and_chunk → Upload to PuppyStorage with chunking
   │   ├─ copy_raw → Upload as-is
   │   ├─ re-embed → Keep chunks in JSON, user re-embeds later
   │   └─ skip → Keep as inline data
   │
   ├─ Generate new resource key (if applicable):
   │   └─ ${newUserId}/${blockId}/${newVersionId}
   │
   └─ Update workflow reference:
       ├─ external_storage: block.data.external_metadata.resource_key = newKey
       ├─ files: block.data.uploadedFiles[].key = newKey
       └─ vector: block.data.indexingList[].collection_configs.user_id = newUserId

3. Create Workspace
   ├─ Call workspace store API
   └─ Save instantiated workflow JSON (includes vector chunks)

4. Return
   └─ { workspace_id, success: true }

Note: Vector embeddings are NOT copied. Users will re-embed chunks when:
  - First accessing the block with indexing
  - Running workflow that uses vector search
  - Explicitly triggering "Re-index" in UI
```

---

## 4. Implementation Phases

### Phase 1: MVP - Official Templates + Cloud (2-3 days)

**Scope**:

- ✅ Official templates only (Git-managed)
- ✅ Cloud deployment (no local support yet)
- ✅ Basic resource copying
- ❌ No CDN
- ❌ No user-generated templates

**Deliverables**:

1. Template Contract TypeScript interfaces
2. CloudTemplateLoader implementation
3. Storage copy APIs (S3 + Local)
4. 4 templates converted to new format
5. `/api/workspace/instantiate` endpoint
6. Frontend integration

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
| 0.2 | TBD | - | After MVP implementation |
| 1.0 | TBD | - | Production release |

---

**Document Status**: Draft  
**Next Review**: After MVP completion  
**Feedback**: Please file issues on GitHub or discuss in #architecture channel
