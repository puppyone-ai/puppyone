# Template Maintenance Guide

> **For**: Git maintainers managing official PuppyFlow templates  
> **Updated**: 2025-01-23  
> **Related**: [Template Resource Contract](../../docs/architecture/template-resource-contract.md)

---

## Overview

This guide defines the long-term maintenance strategy for the official template library in `PuppyFlow/templates/`. It ensures template quality, security, and sustainability.

---

## Maintainer Responsibilities

### 1. Template Quality Control

**Review Checklist for New/Updated Templates:**

- [ ] **Metadata complete**: id, version (semver), name, description, author, tags
- [ ] **No hardcoded userIds**: All workflows cleaned of user-specific identifiers
- [ ] **Resources in native format**: JSON not pre-partitioned, text files readable
- [ ] **Vector data handled correctly**: Entries preserved, collection_configs removed
- [ ] **File sizes reasonable**: JSON <100KB, resources <10MB total per template
- [ ] **Valid JSON**: All `.json` files pass `python3 -m json.tool`
- [ ] **Workflow tested**: At least one successful instantiation + execution test

**Testing Requirements:**

```bash
# Before merging template changes
cd PuppyFlow/templates

# Validate all package.json files
for f in */package.json; do
  python3 -m json.tool "$f" > /dev/null || echo "Invalid: $f"
done

# Check for hardcoded userIds (should return nothing)
grep -r "8f3dbdc0-e742\|110789d4-265d" .

# Verify no collection_configs with user_id
grep -r "collection_configs.*user_id" . && echo "⚠️ Found user_id in collection_configs"
```

---

### 2. Version Management Strategy

Follow **Semantic Versioning** (semver):

```
MAJOR.MINOR.PATCH
  |     |     └─ Bug fixes, typos, small improvements
  |     └─────── New blocks, enhanced prompts (backward compatible)
  └───────────── Breaking changes (workflow structure changes)
```

**Version Bump Guidelines:**

| Change Type | Version Bump | Example |
|-------------|--------------|---------|
| Fix typo in prompt | PATCH | 1.0.0 → 1.0.1 |
| Add optional block | MINOR | 1.0.1 → 1.1.0 |
| Change block IDs | MAJOR | 1.1.0 → 2.0.0 |
| Update resource file | PATCH/MINOR | Depends on impact |
| Remove required block | MAJOR | Breaking change |

**Update Process:**

```bash
# Example: Update agentic-rag template
cd PuppyFlow/templates/agentic-rag

# 1. Edit package.json - bump version
# From: "version": "1.0.0"
# To:   "version": "1.0.1"

# 2. Update resources if needed
nano resources/knowledge-base.json

# 3. Test locally (manual or script)

# 4. Commit with changelog
git add package.json resources/
git commit -m "feat(template): Update agentic-rag to v1.0.1

- Improved FAQ answers for pricing questions
- Added 2 new knowledge base entries
- Updated vector entries accordingly

Breaking: No
Migration: No action required for existing users
"

# 5. PR to qubits branch
```

---

### 3. Template Lifecycle

```
Proposal → Development → Review → Release → Maintenance → Deprecation
```

#### 3.1 Proposal Phase

**New Template Proposal Checklist:**

- [ ] GitHub Issue created with:
  - Use case description
  - Target audience
  - Similar existing templates (if any)
  - Required resources
  - Estimated maintenance effort
- [ ] Design review by 1+ maintainer
- [ ] Approved label added

#### 3.2 Development Phase

**File Structure:**

```
templates/
└── <template-id>/         # Use kebab-case
    ├── package.json       # Required
    ├── resources/         # Optional (if has resources)
    │   ├── *.json
    │   ├── *.txt
    │   └── *.pdf
    └── README.md          # Optional (for complex templates)
```

**Resource Guidelines:**

- **Size limits**:
  - Single resource: <5MB
  - Total per template: <20MB
  - PDF files: <10MB
- **Naming**: Descriptive, kebab-case (`faq-knowledge-base.json`, not `data.json`)
- **Format**: Native (not pre-processed)
  - JSON: Pretty-printed, 2-space indent
  - Text: UTF-8 encoding
  - Binary: Original format

#### 3.3 Review Phase

**PR Requirements:**

1. **Target branch**: `qubits` (dev)
2. **PR template**: Use `feature` template
3. **Required reviewers**: 1+ template maintainer
4. **CI checks**: All tests pass
5. **Manual test**: At least 1 reviewer tests template instantiation

**Review Focus:**

- Workflow logic makes sense
- Resources are appropriate and not duplicated
- No security issues (no API keys, PII, etc.)
- Compatible with existing system
- Documentation sufficient for users

#### 3.4 Release Phase

**Release Process:**

```bash
# After PR merged to qubits
git checkout qubits
git pull

# Test staging deployment
# (manual or automated smoke test)

# Promote to convergency
git checkout convergency
git merge qubits
git push origin convergency

# After staging validation (2-7 days)
git checkout main
git merge convergency --no-ff -m "release: Template updates $(date +%Y-%m-%d)"
git tag -a "templates-v$(date +%Y%m%d)" -m "Template release $(date +%Y-%m-%d)"
git push origin main --tags
```

**Release Notes:**

Maintain `PuppyFlow/templates/CHANGELOG.md`:

```markdown
## 2025-01-23

### Added
- `agentic-rag` v1.0.0 - RAG workflow with FAQ knowledge base

### Changed
- `getting-started` v1.0.0 → v1.1.0 - Improved onboarding prompts

### Fixed
- `seo-blog` v1.0.1 - Fixed query rewrite template

### Deprecated
- (none)
```

#### 3.5 Maintenance Phase

**Regular Tasks** (monthly):

- [ ] Review usage analytics (Phase 3+)
- [ ] Check for broken resources or outdated content
- [ ] Update dependencies (LLM models, API endpoints)
- [ ] Security audit (no leaked credentials, PII)
- [ ] Performance check (resource sizes, instantiation time)

**Reactive Tasks:**

- Bug reports → Fix within 1 week (patch version)
- Feature requests → Evaluate → Schedule
- Security issues → Hotfix immediately

#### 3.6 Deprecation Phase

**When to Deprecate:**

- Template no longer relevant
- Better alternative exists
- Maintenance burden too high
- Security cannot be maintained

**Deprecation Process:**

1. Add deprecation notice to `package.json`:

   ```json
   {
     "metadata": {
       "deprecated": true,
       "deprecation_reason": "Superseded by advanced-rag-v2",
       "alternative": "advanced-rag-v2",
       "sunset_date": "2025-12-31"
     }
   }
   ```

2. Keep template available for 6 months (grace period)
3. After grace period: Move to `templates/.archived/`
4. Update `CHANGELOG.md`

---

## 4. Governance

### 4.1 Who Can Merge Template Changes?

**Template Maintainers:**

- Designated team members (2-3 people)
- Rotation every 6 months to distribute knowledge
- Documented in `templates/CODEOWNERS`:

```
# Template Maintainers
/PuppyFlow/templates/ @maintainer1 @maintainer2
```

**Authority Matrix:**

| Action | Template Maintainer | Other Contributor |
|--------|---------------------|-------------------|
| Minor updates (typos, small fixes) | ✅ Direct commit | PR required |
| New template | ✅ After review | PR + 2 reviews |
| Breaking change | ✅ After discussion | PR + design review |
| Deprecation | ✅ With notice | Proposal only |

### 4.2 Template Whitelist Management

**Location**: `PuppyStorage/server/routes/management_routes.py`

```python
TEMPLATE_USER_IDS = [
    "template-official",
    "8f3dbdc0-e742-4c6e-b041-a52fb32a2181",  # RAG template
    "110789d4-265d-4d70-97da-89c7a93bd580",  # SEO, Getting Started, File Load
]
```

**Update Trigger:**

- When new official template is created
- When template user account changes
- Never remove unless template fully deprecated

**Update Process:**

1. Add new user ID to whitelist
2. Add comment explaining which templates
3. PR with security review
4. Deploy to staging first
5. Monitor audit logs for 24h before prod

---

## 5. Quality Standards

### 5.1 Workflow Design Principles

- **Clear purpose**: One primary use case per template
- **Minimal complexity**: <10 blocks for basic templates
- **Reusable patterns**: Prefer composition over duplication
- **User-friendly**: Clear labels, helpful placeholder content
- **LLM model agnostic**: Default to GPT-5 but support swapping

### 5.2 Resource Guidelines

**Content Quality:**

- **Example data**: Real enough to be useful, fake enough to be safe
- **No PII**: No real names, emails, phone numbers
- **No secrets**: No API keys, passwords, tokens
- **Licensing**: Only use content you have rights to
- **Attribution**: Credit sources in comments

**File Organization:**

```
resources/
├── primary-data.json      # Main data source
├── schema-template.json   # If showing a pattern
└── sample-output.txt      # Example of expected result
```

Not:

```
resources/
├── data1.json
├── data2.json
├── temp.json              # Unclear purpose
└── backup.json            # Should not be in Git
```

### 5.3 Documentation Requirements

**Minimal** (all templates):

- Clear `name` and `description` in metadata
- Tags for discoverability

**Recommended** (complex templates):

- `<template-id>/README.md` with:
  - What it does
  - When to use it
  - How to customize
  - Known limitations

**Example**:

```markdown
# Agentic RAG Template

## What it does
Implements a basic RAG (Retrieval-Augmented Generation) pipeline with vector search.

## When to use
- Building FAQ bots
- Document Q&A systems
- Knowledge base queries

## How to customize
1. Replace `faq-vector-kb.json` with your own Q&A pairs
2. Adjust `top_k` in the retriever block
3. Modify system prompt for domain-specific tone

## Limitations
- Requires re-embedding after instantiation (~5 seconds)
- Best with <1000 documents
```

---

## 6. Long-term Sustainability

### 6.1 Template Refresh Cycle

**Quarterly Review** (every 3 months):

1. Usage analytics review (Phase 3+)
2. Update LLM model defaults if newer models available
3. Refresh example content (avoid outdated references)
4. Performance check (instantiation time should remain <2s)

**Annual Audit** (once per year):

1. Full security review
2. Resource optimization (remove unused files)
3. Workflow simplification (remove redundant blocks)
4. Documentation update
5. Compatibility check with latest PuppyEngine/Storage versions

### 6.2 Backward Compatibility

**Breaking Change Policy:**

- Avoid breaking changes in existing templates
- If必须 break: Create new template ID (`agentic-rag-v2`)
- Deprecate old version gracefully (6-month notice)
- Provide migration guide

**Safe Changes:**

- ✅ Add new optional blocks
- ✅ Improve prompts (same structure)
- ✅ Add more example resources
- ✅ Update descriptions/documentation
- ❌ Remove blocks
- ❌ Change block IDs
- ❌ Change resource reference paths

### 6.3 Community Contributions

**Accepting External Templates:**

1. **Proposal**: Issue with template design
2. **Sandbox test**: Contributor provides working example
3. **Security review**: No malicious code, data
4. **Code review**: 2 maintainers approve
5. **Merge**: To `qubits` first
6. **Observation**: Monitor for 2 weeks in staging
7. **Promote**: To `main` after validation

**Credit Policy:**

- Original author listed in `metadata.author`
- Contributors added to template README
- Major contributions acknowledged in release notes

---

## 7. Monitoring and Metrics

### 7.1 Key Metrics to Track

**Health Metrics** (weekly):

- Template instantiation success rate (target: >99%)
- Average instantiation time (target: <2s)
- Resource copy failure rate (target: <1%)
- Workflow execution failure rate (target: <5%)

**Usage Metrics** (monthly, Phase 3+):

- Instantiations per template
- Most popular templates
- User feedback/ratings
- Abandonment rate (created but never ran)

**Quality Metrics** (quarterly):

- Bug reports per template
- Update frequency
- Documentation completeness
- Test coverage for template-specific features

### 7.2 Alert Triggers

**Critical** (immediate action):

- Template instantiation failure rate >10%
- Security vulnerability discovered
- Resource files corrupted/missing
- Whitelist bypass detected

**Warning** (review within 1 week):

- Template not used for 3 months
- Large resource files added (>10MB)
- Workflow execution failure rate >20%

---

## 8. Automation Opportunities

### 8.1 CI/CD Integration (Future)

**Template Validation Pipeline:**

```yaml
# .github/workflows/template-validation.yml
name: Template Validation

on:
  pull_request:
    paths:
      - 'PuppyFlow/templates/**'

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - name: Validate JSON
      - name: Check for hardcoded userIds
      - name: Verify semver
      - name: Test template instantiation (smoke test)
      - name: Check resource sizes
```

### 8.2 Automated Checks (Recommended)

**Pre-commit hooks** (add to `.git/hooks/pre-commit`):

```bash
#!/bin/bash
# Validate templates before commit

if git diff --cached --name-only | grep -q "PuppyFlow/templates"; then
  echo "Validating templates..."
  
  # Check for hardcoded userIds
  if git diff --cached | grep -E "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"; then
    echo "❌ Found potential hardcoded userId in template changes"
    echo "Review and remove user-specific identifiers"
    exit 1
  fi
  
  echo "✓ Template validation passed"
fi
```

---

## 9. Common Maintenance Tasks

### 9.1 Add New Template

```bash
# 1. Create directory
mkdir -p PuppyFlow/templates/new-template/resources

# 2. Create package.json
cat > PuppyFlow/templates/new-template/package.json << 'EOF'
{
  "metadata": {
    "id": "new-template",
    "version": "1.0.0",
    "name": "New Template",
    "description": "...",
    "author": "PuppyAgent Team",
    "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "tags": ["tag1", "tag2"]
  },
  "workflow": { ... },
  "resources": { ... }
}
EOF

# 3. Add resources
# (create resource files in resources/)

# 4. Update templates/README.md

# 5. Create PR to qubits

# 6. After merge: Update TEMPLATE_USER_IDS if needed
```

### 9.2 Update Existing Template

```bash
# 1. Checkout feature branch
git checkout -b fix/update-agentic-rag-prompt

# 2. Edit template
nano PuppyFlow/templates/agentic-rag/package.json
# Update version: 1.0.0 → 1.0.1

# 3. Test
# (manual instantiation + execution)

# 4. Commit
git add PuppyFlow/templates/agentic-rag/
git commit -m "fix(template): Improve agentic-rag prompt clarity

- Clearer system prompt for RAG assistant
- Better user prompt examples

Version: 1.0.0 → 1.0.1
Breaking: No
"

# 5. PR to qubits
```

### 9.3 Fix Resource Issue

```bash
# 1. Identify broken resource
# Example: faq-vector-kb.json has outdated data

# 2. Update resource file
nano PuppyFlow/templates/agentic-rag/resources/faq-vector-kb.json

# 3. Bump patch version in package.json
# 1.0.1 → 1.0.2

# 4. Test thoroughly
# (ensure entries still work after update)

# 5. Commit with clear description
git commit -m "fix(template): Update agentic-rag FAQ data

- Updated pricing information
- Fixed company location info
- Refreshed vector entries

Version: 1.0.1 → 1.0.2
Resource: faq-vector-kb.json
Impact: Existing users not affected (instantiation only)
"
```

### 9.4 Deprecate Template

```bash
# 1. Add deprecation metadata
# Edit package.json:
{
  "metadata": {
    "id": "old-template",
    "version": "1.2.0",
    "deprecated": true,
    "deprecation_reason": "Superseded by new-template",
    "alternative": "new-template",
    "sunset_date": "2025-12-31"
  }
}

# 2. Commit deprecation notice
git commit -m "chore(template): Deprecate old-template

Reason: Superseded by new-template
Sunset: 2025-12-31 (6 months grace period)
Migration: Use new-template instead
"

# 3. Update templates/README.md

# 4. After sunset date, move to archive
mkdir -p PuppyFlow/templates/.archived
git mv PuppyFlow/templates/old-template PuppyFlow/templates/.archived/
```

---

## 10. Emergency Procedures

### 10.1 Security Issue Discovered

**Immediate Actions:**

1. **Remove from main** (hotfix):

   ```bash
   git checkout main
   git rm -r PuppyFlow/templates/vulnerable-template/
   git commit -m "security: Remove vulnerable-template (CVE-2025-XXXX)"
   git push origin main
   ```

2. **Update whitelist** (if template user compromised):

   ```python
   # Remove from TEMPLATE_USER_IDS immediately
   # Deploy hotfix to PuppyStorage
   ```

3. **Notify users** (if already instantiated):
   - Email notification
   - In-app warning
   - Migration guide to safe alternative

### 10.2 Resource File Corruption

**Recovery:**

1. Check Git history: `git log --all --full-history -- path/to/resource.json`
2. Restore from last known good commit
3. Bump patch version
4. Hotfix to main if critical

### 10.3 Breaking Change Needed Urgently

**Only for critical bugs:**

1. Create `fix/critical-template-issue` branch from `main`
2. Make minimal fix
3. Bump major version
4. Fast-track review (1 maintainer approval)
5. Deploy to main
6. Immediate user notification
7. Back-merge to `convergency` and `qubits`

---

## 11. Handoff and Knowledge Transfer

### 11.1 Onboarding New Maintainers

**Required Reading:**

1. This document (MAINTENANCE.md)
2. Template Resource Contract Architecture
3. CONTRIBUTING.md (general process)
4. Existing templates/README.md

**Training Checklist:**

- [ ] Make a test template change (supervised)
- [ ] Review a template PR
- [ ] Fix a template bug
- [ ] Perform template release
- [ ] Handle a security issue (simulation)

### 11.2 Maintainer Rotation

**Recommended**: Rotate every 6 months to prevent knowledge silos

**Handoff Checklist:**

- [ ] Access to template admin accounts (if any)
- [ ] Understanding of whitelist management
- [ ] Familiarity with CI/CD pipelines
- [ ] Contact info for escalation
- [ ] Document any ongoing work
- [ ] Review open template proposals

---

## 12. Reference

### 12.1 Quick Commands

```bash
# Validate all templates
cd PuppyFlow/templates && for f in */package.json; do python3 -m json.tool "$f" > /dev/null && echo "✓ $f" || echo "✗ $f"; done

# Check hardcoded userIds
grep -r "8f3dbdc0\|110789d4" PuppyFlow/templates/*/package.json

# List template versions
grep -h "\"version\"" PuppyFlow/templates/*/package.json | sort

# Find large resources
find PuppyFlow/templates -type f -size +1M

# Count resources per template
for d in PuppyFlow/templates/*/; do echo "$(basename $d): $(find $d/resources -type f 2>/dev/null | wc -l) files"; done
```

### 12.2 Key Files

- `PuppyFlow/templates/README.md` - User-facing docs
- `PuppyFlow/templates/MAINTENANCE.md` (this file) - Maintainer guide
- `PuppyFlow/templates/CHANGELOG.md` - Version history
- `PuppyFlow/templates/CODEOWNERS` - Maintainer assignment
- `PuppyStorage/server/routes/management_routes.py` - Whitelist location

### 12.3 Related Processes

- **CONTRIBUTING.md**: General contribution process
- **SECURITY.md**: Security disclosure process
- **docs/architecture/template-resource-contract.md**: Full architecture
- **docs/implementation/template-contract-mvp.md**: Implementation guide

---

## 13. Continuous Improvement

### 13.1 Process Review

**Quarterly** (every 3 months):

- Review this document for accuracy
- Update based on lessons learned
- Propose process improvements
- Collect maintainer feedback

### 13.2 Metrics to Improve

- Time from proposal to release (target: <2 weeks)
- Template defect rate (target: <5% of instantiations fail)
- Maintainer response time (target: <48h for PRs)
- Documentation completeness (target: 100% have clear descriptions)

---

## Changelog

| Date | Maintainer | Change |
|------|------------|--------|
| 2025-01-23 | Initial | Created maintenance guide for MVP |
| TBD | - | After Phase 2 completion |

---

**Last Updated**: 2025-01-23  
**Next Review**: 2025-04-23 (quarterly)  
**Maintainers**: See CODEOWNERS
