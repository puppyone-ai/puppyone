# Versions & Permissions

When agents write to your context, you need a safety net. PuppyOne records
every write as a versioned commit and lets you scope each agent's reach.

## Version control

Every write through the Content API creates a commit, automatically — no
manual `commit` needed.

| Capability | What it gives you |
|------------|-------------------|
| **History** | Full commit log per file: who, when, what message |
| **Diff** | Compare any two versions side-by-side |
| **Rollback** | Restore any historical version with one call (rollback itself becomes a new commit, so history is never lost) |
| **Audit log** | Every read, write, and delete is recorded with the agent identity |

```bash
# View commit history of a file
curl -X GET "https://api.puppyone.ai/api/v1/content/{project_id}/versions?path=/docs/spec.md" \
  -H "Authorization: Bearer {token}"

# Diff version 2 vs 5
curl -X GET "https://api.puppyone.ai/api/v1/content/{project_id}/diff?path=/docs/spec.md&v1=2&v2=5"

# Rollback to version 3
curl -X POST "https://api.puppyone.ai/api/v1/content/{project_id}/rollback" \
  -d '{"path": "/docs/spec.md", "version": 3}'
```

## Why this matters

A common scenario:

> An agent rewrote our pricing doc with hallucinated numbers.

Without versioning, that's a real problem. With PuppyOne:

1. Open the file's history
2. Diff the bad commit against the previous one
3. Rollback in one click
4. Check the audit log to see which agent did it
5. Tighten that agent's permissions if needed

## Auth: two models

| Identity | Auth | Used for |
|----------|------|----------|
| **Human users** | JWT (Supabase Auth) | Dashboard, interactive CLI |
| **Agents / machines** | Access Key (per access point) | MCP endpoints, sandboxes, file sync, agents |

Each agent gets its own Access Key — never share keys across agents.

## File-level security (FLS)

Permissions are checked in two layers:

```
Request enters
   |
   v
[ Layer 1: Tool permissions ]
  Which operations can this agent call?
  (read, create, update, delete)
   | pass
   v
[ Layer 2: Path permissions ]
  Which Content Nodes can it touch?
  (/products allowed, /internal denied)
   | pass
   v
Execute
```

### The "doesn't exist" principle

If an agent isn't allowed to access `/internal`, it doesn't see a 403 — that
path **simply doesn't exist** in its view of the tree. The agent doesn't
know there's anything there to ask about.

This is much stronger than traditional deny-after-discover access control.

---

## 📚 Read more

- [Version control overview](https://puppyone.ai/doc/en/version-control)
- [Versions and rollback](https://puppyone.ai/doc/en/version-control/versions)
- [Version diff](https://puppyone.ai/doc/en/version-control/diff)
- [Auth for agents overview](https://puppyone.ai/doc/en/auth-for-agents)
- [FLS permissions](https://puppyone.ai/doc/en/auth-for-agents/permissions)
- [Audit logs](https://puppyone.ai/doc/en/audit/logs)
