# How PuppyOne Works

PuppyOne is a **Context File System** — a cloud file system designed
specifically for AI agents.

## The problem

Today's most capable agents read, write, and execute through Bash and a local
file system. But traditional file systems were never designed to be context
infrastructure for agents:

- **No connectors.** Your data lives across Notion, GitHub, Google Drive, and
  dozens of other tools. Agents cannot see any of it by default.
- **No backup or rollback.** If a hallucinating agent overwrites a critical
  file, the previous version is just gone.
- **No file-level permissions.** Controlling what each agent can read and
  write with `chmod` and SSH keys does not scale to many agents.

## The PuppyOne approach

A unified file tree that all your data — internal and external — flows into,
plus the governance layer agents need:

- **15+ connectors** mount data from Notion, GitHub, Gmail, Google Drive,
  Airtable, and more, automatically converted to Markdown, JSON, or raw
  files.
- **Version control** records every write as a commit. Diff and roll back any
  change in one click.
- **Auth for Agents** gives each agent its own identity and its own view of
  the file tree. Paths an agent can't access don't even exist for it.
- **Audit logs** track which agent read or wrote which file, and when.
- **Multiple distribution channels** — MCP, file sync, REST, sandbox — so
  every agent connects in the way that fits it best.

## In one diagram

```
                    Your Context Space
                            |
        +-------------------+--------------------+
        v                   v                    v
  Connectors        Content (Mut tree)     Distribution
  (Notion, GitHub,  (folders, JSON, MD,    (MCP, file sync,
   Gmail, Drive...)  files - versioned)     REST, sandbox)
                            |
                            v
                    Auth + Audit + FLS
                  (per-agent permissions
                   and access tracing)
```

---

## 📚 Read more

- [Product overview](https://puppyone.ai/doc/en) — the full pitch
- [Core concepts](https://puppyone.ai/doc/en/concepts) — content nodes, connections, MCP
- [Cloud quickstart](https://puppyone.ai/doc/en/quickstart/cloud) — the original 5-minute walkthrough
