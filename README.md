<img src="assert/puppyone.png" alt="Puppyone" width="100%" />

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
&nbsp;
<a href="mailto:guantum@puppyagent.com">
  <img src="https://img.shields.io/badge/FounderSupport-guantum@puppyagent.com-F44336?style=flat&logo=gmail&logoColor=white" alt="Support" height="22" />
</a>


**puppyone** is the #1 **Context Base for AI agents**.

A structured, agent-native context platform where all your agents collaborate seamlessly in real-time. It support: 1. data indexing


<img src="assert/puppycontextintro.png" alt="Puppyone Introduction" width="100%" />


## Why puppyone

### Agent Context Base vs. Knowledge Base
A traditional Knowledge Base (like Notion) is designed for human reading, focusing on layout, formatting and human-collaborating. An Agent Context Base (ACB) is designed for **AI agents**, focusing on fiendness for agents. Structure, Logic, and Deterministic Indexing.

### Agent Context Base vs. Vector Database
Vector Databases rely on probabilistic similarity, which is inherently "fuzzy" and prone to hallucinations when dealing with precise data like SKUs, prices, or complex logic. Puppyone provides **deterministic, structured context** for reliable agent operations.

### Key Differentiators

- **Context-centric**: Not flow orchestration; context is the interface, users face results
- **Agent-friendly**: Agent-oriented indexing, not a static knowledge base or database
- **Workflow as edge**: Workflows are edges between contexts; beyond orchestration, they embody agents
- **RAG & Deep Research**: On local knowledge; supporting data cleaning, structuring, indexing


## Features

- **Agentic RAG**: Deep+wide research agent with Tavily / Exa / Local knowledge
- **Context Management**: Ingest, clean, version and govern enterprise knowledge (CRUD operations)
- **Hybrid Indexing**: High-performance vector indexing and hybrid search (vector DB / Semantic Search / LLM retriever)
- **Multiple Distribution**: MCP for support agents, API for crawl agents, Skills for BI agents
- **Visual Dashboard**: Supabase-like visual interface—no backend engineering required


## Quick Start

Choose ONE (alternatives—pick just one):
- **Cloud (Hosted)**: zero setup, managed upgrades/scaling, support.
- **Self-Hosted (Local)**: runs fully on your machine; data stays local; best for prototyping/dev.


### Cloud (Hosted) — no setup

   Create an account at https://www.puppyone.ai and get started.

### Self-Hosted (Local) — for developers

See docs for detailed steps:
- Getting started: docs/getting-started.md
- Configuration: docs/configuration.md
- Docker Compose: docs/deployment/docker-compose.md


## Core Concepts

- **Workspace**: Your project context (workflows, assets, settings)
- **Block**: An operation (e.g., load file, embed, query, call model)
- **Edge**: A connection that passes data between blocks
- **Workflow**: A graph of blocks and edges that runs as a job
- **Storage**: Where files, chunks, and vectors are managed


## Contributing

- Issues and feature requests are welcome
- Please open a PR for small fixes; for larger changes, file an issue first to discuss the design
- By contributing, you agree your contributions may be used under the project's license


## License

This repository uses the Puppyone Sustainable Use License (SUL).

Summary (for convenience; the License controls):
1) Personal use (individual): Allowed, free.
2) Internal business use (single-tenant, per organization): Allowed, free.
3) Self-hosted multi-tenant: Not allowed. To obtain rights, contact guantum@puppyagent.com.
4) Managed/hosted service to third parties: Not allowed. Subscribe to the official hosted service at https://www.puppyone.ai or obtain a commercial license.
5) Commercial redistribution (paid distribution): Not allowed. Commercial license required.
6) Use of Puppyone trademarks/logos: Not granted; prior written permission required.

See `LICENSE` for full terms.
