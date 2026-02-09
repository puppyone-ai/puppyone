<p align="center">
  <img src="frontend/public/puppyonetitle.png" alt="PuppyOne"  />
</p>

# puppyone

<a href="https://www.puppyone.ai" target="_blank">
  <img src="https://img.shields.io/badge/Web-puppyone.ai-39BC66?style=flat&logo=google-chrome&logoColor=white" alt="Homepage" height="22" />
</a>
&nbsp;
<a href="https://doc.puppyagent.com" target="_blank">
  <img src="https://img.shields.io/badge/Docs-doc.puppyagent.com-D7F3FF?style=flat&logo=readthedocs&logoColor=white" alt="Docs" height="22" />
</a>
&nbsp;
<a href="https://x.com/puppyone_ai" target="_blank">
  <img src="https://img.shields.io/badge/X-@puppyone-000000?style=flat&logo=x&logoColor=white" alt="X (Twitter)" height="22" />
</a>
&nbsp;
<a href="https://discord.gg/eRjwqZpjBT" target="_blank">
  <img src="https://img.shields.io/badge/Discord-Join-5865F2?style=flat&logo=discord&logoColor=white" alt="Discord" height="22" />
</a>


The File System for Agent Context.

Puppyone is the file-based context infrastructure for AI agents. Connect fragmented context, transform raw data into a unified file system, and enable Agents to access all context via Bash and MCP.


<img src="assert/puppy-filesystem-demo.png" alt="PuppyOne Context Filesystem" width="100%" />

In 2026, with the rise of agents such as OpenClaw and Claude Code, "Bash and Files" has become the new standard. Yet, today's context infrastructure is still built for humans, creating a bottleneck for agents:

1. SaaS Silos: Deep context is locked away in fragmented softwares, making it inaccessible for agents.

2. Collaboration Friction: Traditional file systems weren't built for the demands of multi-agent teamwork.

3. The Auth Gap: Production-ready agents require security, but legacy protocols like SSH are too stupid for agents management.

Therefore, puppyone (Born Feb 2026) is reimagining context infrastructure for the agentic age. We provide a virtual file system engineered specifically for the next generation of intelligence.


## Connect. Convert. File.

**Connect Notion, GitHub, Airtable, Google Drive, and local files.** We turn your scattered SaaS silos into a unified file tree.

<img src="assert/connect-demo.gif" alt="Supported Data Sources" width="100%" />

## File Level Security (FLS)

**Think of it as Row Level Security (RLS), but for Agent context.**

PuppyOne enforces strict isolation by dynamically mounting only authorized files into the Agent's sandbox. **If an Agent doesn't have permission, the file physically doesn't exist in its environment.**

<img src="assert/auth-demo.gif" alt="File Level Security Demo" width="100%" />

## Quick Start

### 1. Cloud (Hosted) — No Setup

Create an account at [puppyone.ai](https://www.puppyone.ai) and mount your first data source in minutes.

### 2. Self-Hosted (Local)

Run the backend locally using Docker or Python.

See docs for detailed steps:
- [Getting Started](docs/getting-started.md)
- [Configuration](docs/configuration.md)
- [Docker Compose](docs/deployment/docker-compose.md)

---


## Architecture

We bridge the gap between SaaS APIs and File System calls.

```
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│  Notion  │  │  GitHub  │  │ Airtable │  │  Files   │
└─────┬────┘  └─────┬────┘  └─────┬────┘  └─────┬────┘
      │             │             │             │
      └─────────────▼─────────────▼─────────────┘
                    │
            ╔═══════▼═══════╗
            ║   puppyone    ║  ◄── Virtual File System Layer
            ║  Files / JSON ║      (The "Mount" Point)
            ╚═══════▲═══════╝
                    │
      ┌─────────────┼─────────────┐
      │             │             │
  ┌───▼───┐     ┌───▼───┐     ┌───▼───┐
  │  MCP  │     │  API  │     │Sandbox│
  └───┬───┘     └───┬───┘     └───┬───┘
      │             │             │
┌─────▼────┐  ┌─────▼────┐  ┌─────▼────┐
│ Cursor   │  │ Python   │  │ E2B      │
│ Claude   │  │ Scripts  │  │ Agents   │
└──────────┘  └──────────┘  └──────────┘
```

---

## Contributing

- Issues and feature requests are welcome.
- Please open a PR for small fixes; for larger changes, file an issue first to discuss the design.

---

## License

This repository uses the Puppyone Sustainable Use License (SUL).

Summary (for convenience; the License controls):
1. Personal use (individual): Allowed, free.
2. Internal business use (single-tenant, per organization): Allowed, free.
3. Self-hosted multi-tenant: Not allowed.
4. Commercial redistribution: Not allowed.

See `LICENSE` for full terms.
