# PuppyAgent Documentation

> **Welcome to PuppyAgent technical documentation**

This directory contains architecture designs, implementation plans, and technical guides for the PuppyAgent ecosystem.

---

## 📚 Documentation Structure

```
docs/
├── architecture/           # System design and ADRs
│   └── template-resource-contract.md
│
├── implementation/         # Implementation plans
│   └── template-contract-mvp.md
│
├── guides/                # Developer guides (coming soon)
│   ├── template-development.md
│   └── workspace-management.md
│
└── api/                   # API specifications (coming soon)
    ├── workspace-instantiate.md
    └── storage-copy.md
```

---

## 🚀 Quick Start

### For Understanding the System

1. **Start here**: [Template Resource Contract Architecture](./architecture/template-resource-contract.md)
   - Comprehensive system design
   - Problem analysis and solution
   - All implementation phases (MVP → Full)

### For Implementation

2. **Then read**: [Template Contract MVP Plan](./implementation/template-contract-mvp.md)
   - Focused on Phase 1 (2-3 days)
   - Step-by-step tasks
   - Code samples and file changes

---

## 📖 Key Documents

### Architecture

| Document | Description | Audience | Status |
|----------|-------------|----------|--------|
| [Template Resource Contract](./architecture/template-resource-contract.md) | Complete system design for template management | Architects, Senior Devs | Draft |

### Implementation

| Document | Description | Audience | Status |
|----------|-------------|----------|--------|
| [Template Contract MVP](./implementation/template-contract-mvp.md) | Phase 1 implementation plan | All Developers | Ready |

### API (Coming Soon)

- Template Instantiation API
- Storage Copy API
- Template Loader Interface

---

## 🎯 Current Focus: Template Resource Contract MVP

**Goal**: Fix template authentication issues by implementing resource ownership management.

**Timeline**: 2-3 days

**Key Deliverables**:

- Template Contract TypeScript interfaces
- CloudTemplateLoader implementation
- Storage copy APIs
- 4 templates converted to new format
- Frontend integration

**Track Progress**: See [MVP Plan](./implementation/template-contract-mvp.md)

---

## 🔗 Related Documentation

### In Code

- Template types: `PuppyFlow/lib/templates/types.ts`
- Template loader: `PuppyFlow/lib/templates/cloud.ts`
- Storage adapter: `PuppyStorage/storage/base.py`

### External

- [Project README](../README.md)
- [Contributing Guide](../CONTRIBUTING.md)
- [Security Policy](../SECURITY.md)

---

## 📝 Documentation Standards

### Creating New Docs

1. **Architecture docs**: Use ADR template
   - Problem statement
   - Proposed solution
   - Alternatives considered
   - Decision and rationale

2. **Implementation plans**: Use task-based format
   - Prerequisites
   - Step-by-step tasks
   - Code samples
   - Testing checklist

3. **Guides**: Use tutorial format
   - Prerequisites
   - Step-by-step instructions
   - Common issues and solutions

### File Naming

- Architecture: `kebab-case` (e.g., `template-resource-contract.md`)
- Implementation: `{feature}-mvp.md` or `{feature}-phase{n}.md`
- Guides: `{action}-{subject}.md` (e.g., `developing-templates.md`)

---

## 🤝 Contributing to Documentation

1. **Adding new docs**: Place in appropriate directory
2. **Updating existing docs**: Update "Change Log" section
3. **Cross-references**: Use relative links
4. **Code samples**: Include language tags for syntax highlighting

---

## 📊 Documentation Status

| Category | Coverage | Quality | Up-to-date |
|----------|----------|---------|------------|
| Architecture | 30% | High | ✅ Current |
| Implementation | 20% | High | ✅ Current |
| API Specs | 0% | N/A | ⏳ Planned |
| Developer Guides | 10% | Medium | ⚠️ Needs update |

---

## 🔄 Recent Updates

| Date | Document | Change |
|------|----------|--------|
| 2025-01-20 | Template Resource Contract | Initial architecture design |
| 2025-01-20 | Template Contract MVP | Implementation plan created |
| 2025-01-20 | docs/README.md | Documentation index created |

---

## 💬 Feedback

Found an issue or have suggestions for improving documentation?

- File an issue: [GitHub Issues](https://github.com/puppyagent/PuppyAgent-Jack/issues)
- Discuss: #documentation channel on Discord
- Email: <docs@puppyagent.com>

---

**Last Updated**: 2025-01-20  
**Maintained By**: Architecture & Documentation Team
