# Template Changelog

All notable changes to official templates will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and template versions adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Planned

- User-generated templates (Phase 2)
- Template marketplace (Phase 3)
- CDN distribution (Phase 3)

---

## [1.0.0] - 2025-01-23

### Added

- **agentic-rag** v1.0.0 - RAG workflow with FAQ knowledge base and vector search
  - Resources: web-content.txt, faq-vector-kb.json, faq-extracted.json, faq-schema.json
  - Features: Web scraping → FAQ extraction → Vector indexing → RAG Q&A
  
- **seo-blog** v1.0.0 - SEO blog generation from Google search results
  - Resources: query-rewrite, 3 search results, generated blog sample
  - Features: Query rewriting → Google search → Blog generation
  
- **file-load** v1.0.0 - PDF processing demonstration
  - Resources: sample PDF (49KB), parsed content, formatted output
  - Features: PDF upload → Parse → Format → Transform
  
- **getting-started** v1.0.0 - Onboarding guide for new users
  - Resources: None (inline content only)
  - Features: Interactive tutorial with LLM guidance

### Infrastructure

- Template Resource Contract v1.0.0 implemented
- Git-based template storage
- Resource extraction from legacy format
- Whitelist security mechanism
- Copy resource API endpoints

### Documentation

- `templates/README.md` - User guide
- `templates/MAINTENANCE.md` - Maintainer guide
- `docs/architecture/template-resource-contract.md` - Full architecture
- `docs/implementation/template-contract-mvp.md` - MVP plan

---

## Template Version History

### agentic-rag

- `1.0.0` (2025-01-23) - Initial release

### seo-blog

- `1.0.0` (2025-01-23) - Initial release

### file-load

- `1.0.0` (2025-01-23) - Initial release

### getting-started

- `1.0.0` (2025-01-23) - Initial release

---

## Maintenance Notes

- All templates extracted from legacy `workspaceTemplates.json`
- Hardcoded userIds removed: `8f3dbdc0-e742...`, `110789d4-265d...`
- Vector data strategy: Preserve chunks, remove collection_configs
- Template whitelist configured in PuppyStorage management_routes.py

---

[Unreleased]: https://github.com/puppyagent/PuppyAgent-Jack/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/puppyagent/PuppyAgent-Jack/releases/tag/templates-v1.0.0
