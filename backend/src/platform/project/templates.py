"""
Project templates — predefined content for new projects.

Each template defines a name, description, icon, and a set of files to write
via MutOps.bulk_write. Templates are surfaced in the dashboard and can be
selected when creating a new project (via the `template` field in ProjectCreate).

The "get-started" template replaces the old onboarding demo project.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

# ── Template registry ────────────────────────────────────────────────

@dataclass(frozen=True)
class ProjectTemplate:
    id: str
    name: str
    description: str
    icon: str  # emoji shown on template card
    files: dict[str, str]  # path → text content

    def encoded_files(self) -> dict[str, bytes]:
        return {k: v.encode("utf-8") for k, v in self.files.items()}


# ── Get Started (replaces old onboarding demo) ──────────────────────

_GET_STARTED_FILES = {
    "Getting Started.md": """\
# Getting Started

Your context space is ready. Here's how to start using it.

## 1. Connect your first data source

Bring in data from Gmail, GitHub, Notion, local folders, or any URL.

**Web:** Click "+ New Access" in the sidebar
**CLI:** `puppyone access add <provider>`

Examples:

    puppyone access add gmail
    puppyone access add github https://github.com/org/repo
    puppyone access add folder ~/my-notes
    puppyone access add url https://example.com

## 2. Give an AI agent access

Create an MCP endpoint so Claude, Cursor, or any MCP-compatible agent can \
read and write your context space.

**Web:** Go to Access → Add → MCP Endpoint
**CLI:** `puppyone access add mcp "my-endpoint"`

## 3. Explore your data

**Web:** Browse files in the data explorer
**CLI:**

    mut ls
    mut tree
    puppyone access ls
    puppyone status

## Learn more

See the **Guides** folder for detailed information:
- **About PuppyOne** — what is a context space
- **Connecting Data** — all supported data sources
- **Agent Access** — MCP, sandbox, and permissions
""",
    "Guides/About PuppyOne.md": """\
# About PuppyOne

**The cloud file system built for AI Agents.**

PuppyOne unifies your scattered data from Notion, GitHub, Gmail, Airtable, \
local files, and more into a single context space designed for multi-agent \
collaboration. Connect any agent to this one space, and it instantly accesses \
all your context.

## Two Core Pillars

### Connect
Whether your data comes from Notion, GitHub, Airtable, or local PDFs, \
once connected to PuppyOne they all become nodes in a single folder.

- Notion pages → Markdown
- GitHub repos → Code directories
- Airtable bases → Structured documents
- Gmail → Summarized threads

### Collaborate
PuppyOne provides a complete infrastructure for human-agent collaboration:

- **Version history** — every change is tracked with full audit trail
- **Access control** — fine-grained permissions for users and agents
- **MCP protocol** — any MCP-compatible agent can read/write natively
- **Sandbox execution** — agents can run code in isolated environments
""",
    "Guides/Connecting Data.md": """\
# Connecting Data

PuppyOne connects to your real work apps and data sources.

## Supported Sources

### Cloud Services (OAuth)
- **Gmail** — email threads, summarized by date
- **Google Calendar** — upcoming and past events
- **Google Drive** — documents, spreadsheets, files
- **Google Docs** — individual documents
- **Google Sheets** — spreadsheet data
- **Notion** — pages and databases
- **GitHub** — repositories, issues, code
- **Linear** — issues and projects

### Local Sources
- **Folder sync** — mount a local directory and keep it in sync
- **File upload** — drag-and-drop or CLI upload for PDFs, CSVs, and more

### Web & API Sources
- **URL** — pull content from any public webpage
- **Custom scripts** — write scripts that fetch data from any API or database
""",
    "Guides/Agent Access.md": """\
# Agent Access

PuppyOne provides multiple ways for AI agents to access your context space.

## MCP Protocol

Create an MCP endpoint, and any MCP-compatible agent — Claude, Cursor, \
Windsurf, and others — can read and write your context space natively.

Each MCP endpoint gets its own URL and access credentials.

## Sandbox Execution

For agents that need to run code, PuppyOne provides isolated sandbox \
environments. Agents can execute Python, Node.js, or shell commands \
in a secure container with access to your context data.

## Access Control

- **Read-only** — agent can browse and read files
- **Read-write** — agent can also create and modify files
- **Scoped access** — limit an agent to specific folders or nodes
""",
}

# ── Check-in & Invoice Processing ───────────────────────────────────

_INVOICE_PROCESS_FILES = {
    "README.md": """\
# Receipt & Invoice Processing

A structured context space for an accounting or expense management agent.

## Structure

- **Policies/** — expense policies and approval guidelines
- **Templates/** — standard invoice JSON schemas
- **Inbox/** — folder to connect an email inbox for incoming receipts
- **Processed/** — folder for approved expenses

## How to use

1. Connect a specific email address (e.g. receipts@yourcompany.com) to the Inbox/ folder
2. Create an agent with an MCP tool that extracts data from emails
3. The agent reads the Inbox, parses receipts according to Templates/schema.json, and follows Policies/Expense Policy.md
""",
    "Policies/Expense Policy.md": """\
# Expense Policy

[Replace with your company expense policy]

## Limits

- Meals: $50/day
- Travel: requires pre-approval if > $500
- Software subscriptions: require IT approval

## Required Information

Every processed invoice must extract:
- Date
- Vendor
- Total Amount
- Tax Amount
- Description
""",
    "Templates/schema.json": """\
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Invoice",
  "type": "object",
  "properties": {
    "date": { "type": "string", "format": "date" },
    "vendor": { "type": "string" },
    "total": { "type": "number" },
    "currency": { "type": "string" },
    "items": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "description": { "type": "string" },
          "amount": { "type": "number" }
        }
      }
    }
  },
  "required": ["date", "vendor", "total", "currency"]
}
""",
    "Inbox/example_receipt.md": """\
# Uber Receipt

**Date:** March 15, 2026
**Total:** $24.50 USD

Thanks for riding with Uber!
Trip from Airport to Downtown Office.
""",
}

# ── SEO & Content Management ────────────────────────────────────────

_SEO_MANAGEMENT_FILES = {
    "README.md": """\
# SEO Content Management

A structured context space for a marketing or SEO agent.

## Structure

- **Brand Guidelines/** — tone of voice, target audience
- **Keywords/** — target keywords, search volume data
- **Content Pipeline/** — drafts, published articles, social posts

## How to use

1. Connect Google Search Console as a data source to pull live SEO data
2. Add your brand guidelines
3. Create an agent that drafts content following guidelines and targeting specific keywords
""",
    "Brand Guidelines/Tone of Voice.md": """\
# Tone of Voice

[Replace with your brand voice guidelines]

## Core Traits

- Professional but approachable
- Technical but accessible
- Concise and action-oriented

## Things to Avoid

- Overly formal corporate jargon
- Buzzwords without meaning
- Excessive exclamation marks
""",
    "Keywords/Target Keywords.md": """\
# Target Keywords

## Primary Keywords

- "AI agent context" (Volume: High, Difficulty: Medium)
- "Multi-agent orchestration" (Volume: Medium, Difficulty: High)

## Secondary Keywords

- "MCP protocol"
- "LLM file system"
- "Agent memory management"
""",
    "Content Pipeline/Blog - Why Agents Need Filesystems.md": """\
# Why AI Agents Need a File System

**Status:** Draft
**Target Keyword:** LLM file system

[Content goes here]
""",
}

# ── Template Registry ───────────────────────────────────────────────

TEMPLATES: dict[str, ProjectTemplate] = {
    "get-started": ProjectTemplate(
        id="get-started",
        name="Get Started",
        description="A guided walkthrough — connect data sources, set up agents, and learn how PuppyOne works.",
        icon="🐕",
        files=_GET_STARTED_FILES,
    ),
    "invoice-processing": ProjectTemplate(
        id="invoice-processing",
        name="Check-in & Invoices",
        description="Pre-structured schema, expense policies, and inbox folder for an accounting agent.",
        icon="🧾",
        files=_INVOICE_PROCESS_FILES,
    ),
    "seo-management": ProjectTemplate(
        id="seo-management",
        name="SEO Content Management",
        description="Brand guidelines, keyword lists, and a content pipeline ready for an SEO agent.",
        icon="📈",
        files=_SEO_MANAGEMENT_FILES,
    ),
}


def get_template(template_id: str) -> Optional[ProjectTemplate]:
    return TEMPLATES.get(template_id)


def _infer_node_type(path: str) -> str:
    """Infer rendering node type for the preview grid (folder/markdown/json/file)."""
    if path.endswith("/"):
        return "folder"
    if path.endswith(".md"):
        return "markdown"
    if path.endswith(".json"):
        return "json"
    return "file"


def _build_preview(files: dict[str, str], limit: int = 6) -> list[dict]:
    """
    Build a top-level preview of a template's structure.

    We surface folders (collapsed) and root-level files so the frontend can
    render a faithful mini file-grid without downloading the full content.
    """
    seen: list[tuple[str, str]] = []  # preserves insertion order (Py3.7+)
    seen_set: set[str] = set()

    for path in files.keys():
        head = path.split("/", 1)[0]
        is_folder = "/" in path
        display = head + ("/" if is_folder else "")
        if display in seen_set:
            continue
        seen_set.add(display)
        seen.append((display, "folder" if is_folder else _infer_node_type(path)))
        if len(seen) >= limit:
            break

    return [{"name": name, "type": ntype} for name, ntype in seen]


def list_templates() -> list[dict]:
    """Return template metadata (without file contents) for the frontend."""
    return [
        {
            "id": t.id,
            "name": t.name,
            "description": t.description,
            "icon": t.icon,
            "preview": _build_preview(t.files),
        }
        for t in TEMPLATES.values()
    ]


async def seed_template_content(
    project_id: str,
    template_id: str,
    created_by: str,
) -> dict:
    """Write template files into a project via MutOps."""
    from src.mut_engine.dependencies import create_mut_ops

    tmpl = get_template(template_id)
    if tmpl is None:
        return {"error": f"Unknown template: {template_id}"}

    ops = create_mut_ops()
    await ops.bulk_write(
        project_id,
        tmpl.encoded_files(),
        who=created_by,
        message=f"template: {tmpl.name}",
    )

    return {"template": template_id, "files": list(tmpl.files.keys())}
