# Use Case: AI Content Factory

A multi-agent content production pipeline powered by PuppyOne MUT protocol.

## Scenario

A content team uses **3 AI Agents + 1 Human Editor** to produce a tech blog — each role operates in its own scoped workspace, with automatic versioning, permission enforcement, and instant rollback.

```
┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│ Research Bot │   │ Writer Bot  │   │ Review Bot  │   │ Human Editor│
│ scope: /raw/ │   │scope:/draft/│   │scope:/draft/│   │ scope: /    │
│ mode: rw     │   │ mode: rw    │   │ mode: r     │   │ mode: rw    │
└──────┬───────┘   └──────┬──────┘   └──────┬──────┘   └──────┬──────┘
       │                  │                  │                 │
       ▼                  ▼                  ▼                 ▼
  ┌──────────────────────────────────────────────────────────────┐
  │                    PuppyOne MUT Tree                         │
  │  /config/       Global pipeline config (admin only)          │
  │  /raw/          Research materials (Research Bot)             │
  │  /draft/        Blog drafts + reviews (Writer + Review Bot)  │
  │  /published/    Final content (Human Editor)                 │
  └──────────────────────────────────────────────────────────────┘
```

## What This Demonstrates

| Feature | How It's Shown |
|---------|----------------|
| **Scoped Access** | Each agent only sees its own directory |
| **Read-Only Enforcement** | Review Bot can read drafts but cannot modify (403) |
| **Access Points** | One URL + key per agent, zero config |
| **Automatic Versioning** | Every push creates a new version with who/what/when |
| **Merge & Conflict Resolution** | Multiple agents push concurrently |
| **Rollback** | Editor reverts to a previous version in one API call |
| **Pull Historical Version** | Retrieve any past snapshot |
| **Mixed File Types** | md, json, csv, txt, docx all work seamlessly |

## File Structure

```
content-factory/
├── config/                         Admin-only configuration
│   ├── pipeline.json                 Agent definitions + quality standards
│   ├── style-guide.md                Content writing guidelines
│   ├── editorial-calendar.csv        8-week publishing schedule
│   └── prompts.txt                   System prompts for all 3 agents
│
├── raw/                            Research Bot output
│   ├── mcp-protocol-research.md      MCP protocol deep dive
│   ├── ai-agents-2025-trends.md      AI agent industry trends
│   ├── puppyone-vs-alternatives.md   Competitive analysis
│   ├── interview-notes.txt           Customer discovery interview
│   ├── keyword-analysis.csv          SEO keyword research (12 terms)
│   ├── competitor-matrix.csv         Feature comparison matrix
│   └── sources.txt                   Crawl log with URLs + status
│
├── draft/                          Writer Bot + Review Bot workspace
│   ├── build-mcp-server-in-15-min.md Blog draft with runnable code
│   ├── why-ai-agents-need-version-control.md  Thought leadership draft
│   ├── review-notes.json             Structured review (scores + feedback)
│   ├── social-media-snippets.txt     Twitter/LinkedIn copy
│   └── content-performance.csv       Historical content metrics
│
├── published/                      Human Editor final output
│   ├── getting-started-with-puppyone.md  Published tutorial
│   ├── weekly-report-w13.docx        Weekly report (tables + data)
│   ├── changelog.txt                 Publication log
│   └── distribution-log.csv          Channel distribution tracking
│
├── run_demo.py                     Executable demo script
└── README.md                       This file
```

## Running the Demo

### Prerequisites

- Python 3.11+
- `requests` package (`pip install requests`)
- A PuppyOne project with Access Points configured

### Setup Access Points

Create these connections on your PuppyOne project:

| Role | Scope | Mode | Access Key |
|------|-------|------|------------|
| Admin / Editor | `/` (root) | rw | `e2e_test_key_001` |
| Research Bot | `/raw/` | rw | `key_research_rw` |
| Writer Bot | `/draft/` | rw | `key_writer_rw` |
| Review Bot | `/draft/` | r | `key_reviewer_ro` |

### Run

```bash
python run_demo.py --api-url https://your-api.puppyone.ai
```

### Expected Output

```
Step  1: Admin pushes global config               → v1 (4 files)
Step  2: Research Bot pushes research materials    → v2 (7 files)
Step  3: Writer Bot writes blog drafts             → v3 (5 files)
Step  4: Review Bot reads drafts (read-only)       → 5 files visible, push blocked (403)
Step  5: Human Editor publishes final content      → v4 (4 files)
Step  6: Verify full project tree                  → 20 files across all scopes
Step  7: Verify scope isolation                    → Each role sees only its files
Step  8: Full version history                      → Complete audit trail
Step  9: Rollback to pre-publish                   → v5 (non-destructive revert)
Step 10: Pull historical version                   → Snapshot of any past state
```

## Key Takeaways

1. **Each agent gets a URL, not credentials** — Access Points eliminate SSH keys, OAuth tokens, and IAM policies
2. **Scopes are boundaries, not folders** — an agent physically cannot read or write outside its scope
3. **Every write is versioned** — full audit trail for compliance (SOC 2, GDPR)
4. **Rollback is instant** — one API call to revert any agent's mistake
5. **File-type agnostic** — markdown, JSON, CSV, DOCX all version-controlled equally
