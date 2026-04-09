# Research: PuppyOne vs Alternatives

## Comparison Matrix

### Git-based Solutions
- **GitHub/GitLab**: Great for code, terrible for AI agents
  - Requires SSH/PAT setup per agent
  - No per-path permissions (all-or-nothing repo access)
  - Merge conflicts require manual resolution
  - Not designed for structured data (JSON, configs)

### File Storage (S3, GCS)
- No versioning (must build yourself)
- No merge/conflict resolution
- No access scoping below bucket level
- No audit trail

### Databases (PostgreSQL, MongoDB)
- Good for structured data
- No tree structure
- No branching/merging
- Schema migrations are painful

### PuppyOne MUT
- **Versioning**: Built-in, every write creates a version
- **Scoping**: Per-path read/write permissions
- **Merging**: Automatic 3-way merge with conflict records
- **Access**: One URL + key per agent (Access Points)
- **Audit**: Full who/what/when trail
- **Rollback**: One API call to revert any version

## Key Differentiator
> "PuppyOne treats AI agent data like source code — versioned, scoped, mergeable — but without requiring agents to understand git."
