# PuppyFlow Templates

This directory contains template packages for PuppyFlow, following the Template Resource Contract architecture.

## Directory Structure

```
templates/
├── agentic-rag/           # RAG workflow with FAQ knowledge base
│   ├── package.json       # Template metadata, workflow, and resource manifest
│   └── resources/
│       ├── web-content.txt
│       ├── faq-extracted.json
│       ├── faq-schema.json
│       └── faq-vector-kb.json
│
├── seo-blog/              # SEO blog generation from search results
│   ├── package.json
│   └── resources/
│       ├── query-rewrite-output.json
│       ├── search-result-1.json
│       ├── search-result-2.json
│       ├── search-result-3.json
│       └── generated-blog.txt
│
├── file-load/             # PDF processing demo
│   ├── package.json
│   └── resources/
│       ├── sample-local-pdf.pdf
│       ├── parsed-pdf-content.json
│       └── formatted-output.json
│
└── getting-started/       # Onboarding guide (no resources)
    └── package.json
```

## Template Package Format

Each template follows the Template Resource Contract specification:

```json
{
  "metadata": {
    "id": "template-id",
    "version": "1.0.0",
    "name": "Template Name",
    "description": "Description",
    "author": "PuppyAgent Team",
    "created_at": "2025-01-23T00:00:00Z",
    "tags": ["tag1", "tag2"]
  },
  "workflow": {
    "blocks": [...],
    "edges": [...],
    "viewport": {...},
    "version": "0.1.0"
  },
  "resources": {
    "format": "separate|inline",
    "resources": [...]
  }
}
```

## Resource Types

### 1. External Storage Resources

- **Type**: `external_storage`
- **Format**: `text` or `structured`
- **Strategy**: `copy_and_chunk`
- **Example**: Web content, FAQ data, search results

### 2. File Resources

- **Type**: `file`
- **Format**: `binary`
- **Strategy**: `copy_as_is`
- **Example**: PDF files, images

### 3. Vector Data Resources

- **Type**: `vector_collection`
- **Format**: `structured`
- **Special handling**: Preserves chunks for re-embedding, removes collection_configs
- **Example**: Knowledge base with vector search

## Key Design Decisions

1. **No hardcoded userIds**: All workflows have been cleaned of user-specific identifiers
2. **Separate resources**: Resources are stored as files, not embedded in workflow JSON
3. **Git-managed**: All templates and resources are version-controlled in Git
4. **Vector data strategy**: Original text chunks are preserved, but embeddings and collection configs are removed (users will re-embed with their own models)
5. **Format preservation**: Resources maintain their native format (JSON, text, PDF) until instantiation

## Template Instantiation Flow

When a user creates a workspace from a template:

1. **Load**: `CloudTemplateLoader` reads `package.json` from Git
2. **Upload**: Resources are uploaded to user's S3 space (`${userId}/${blockId}/${versionId}`)
3. **Chunk**: Large resources are automatically chunked by PuppyStorage
4. **Rewrite**: Workflow references are updated with new `resource_key` values
5. **Save**: Final workspace is saved to user's workspace directory

## Related Documentation

- [Template Resource Contract Architecture](../../docs/architecture/template-resource-contract.md)
- [MVP Implementation Plan](../../docs/implementation/template-contract-mvp.md)

## Version History

- **v1.0.0** (2025-01-23): Initial template extraction and organization
  - 4 templates converted from legacy format
  - 12 resource files extracted
  - All hardcoded userIds removed
