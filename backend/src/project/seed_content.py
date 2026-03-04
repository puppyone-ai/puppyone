"""
Default seed content for new projects.

Creates a Getting Started.md at root + a Guides/ folder with
About PuppyOne.md, Connecting Data.md, and Agent Access.md.

Used by both CLI `puppyone init` and web onboarding.
"""

from src.content_node.service import ContentNodeService


GETTING_STARTED_MD = """\
# Getting Started

Your context space is ready. Here's how to start using it.

## 1. Connect your first data source

Bring in data from Gmail, GitHub, Notion, local folders, or any URL.

**Web:** Click "+ Add Connection" in the sidebar
**CLI:** `puppyone conn add <provider>`

Examples:

    puppyone conn add gmail
    puppyone conn add github https://github.com/org/repo
    puppyone conn add folder ~/my-notes
    puppyone conn add url https://example.com

## 2. Give an AI agent access

Create an MCP endpoint so Claude, Cursor, or any MCP-compatible agent can read and write your context space.

**Web:** Go to Connections → Add → MCP Endpoint
**CLI:** `puppyone conn add mcp --name my-endpoint`

## 3. Explore your data

**Web:** Browse files in the data explorer
**CLI:**

    puppyone node ls
    puppyone node tree
    puppyone conn ls
    puppyone status

## Learn more

See the **Guides** folder for detailed information:
- **About PuppyOne** — what is a context space
- **Connecting Data** — all supported data sources
- **Agent Access** — MCP, sandbox, and permissions
"""

ABOUT_PUPPYONE_MD = """\
# About PuppyOne

**The cloud file system built for AI Agents.**

PuppyOne unifies your scattered data from Notion, GitHub, Gmail, Airtable, \
local files, and more into a single context space designed for multi-agent \
collaboration. Connect any agent to this one space, and it instantly accesses \
all your context.

## What Problems Does It Solve?

### Data is scattered; agents can't see the full picture
Your data might be in 30 different places: product specs in Notion, code in \
GitHub, customer info in Airtable, pricing in Google Sheets, plus piles of \
PDFs locally. Every time you want an agent to use this data, you have to \
connect it all over again.

### Different agents need different permissions
A support agent should read product catalogs but not change prices. A dev \
agent needs to edit specs. A sales agent can view quotes but not delete \
customer records. You need fine-grained, centralized access control — not \
just "all or nothing."

### Every agent connects differently; maintenance is expensive
Cursor needs MCP, backend scripts use REST APIs, real-time scenarios \
require SSE, and complex tasks need agents running code in a sandbox. You \
need unified logging and monitoring for every connection.

## Two Core Pillars

### Connect
PuppyOne's answer is a **cloud folder**. Whether your data comes from \
Notion, GitHub, Airtable, or local PDFs, once connected to PuppyOne, \
they all become nodes in this folder.

- Notion pages → Markdown
- GitHub repos → Code directories
- Airtable bases → Structured documents
- Gmail → Summarized threads

For your agent, the world is now just **one single folder**, not 30 \
different SaaS silos.

### Collaborate
PuppyOne provides a complete infrastructure for human-agent collaboration:

- **Version history** — every change is tracked with full audit trail
- **Access control** — fine-grained permissions for users and agents
- **MCP protocol** — any MCP-compatible agent can read/write natively
- **Sandbox execution** — agents can run code in isolated environments
- **Real-time sync** — changes propagate instantly across all consumers
"""

CONNECTING_DATA_MD = """\
# Connecting Data

PuppyOne connects to your real work apps and data sources. Everything \
you connect becomes part of your context space as regular files and \
folders that both you and your agents can read.

## Supported Sources

### Cloud Services (OAuth)
These require a one-time authorization through your browser:
- **Gmail** — email threads, summarized by date
- **Google Calendar** — upcoming and past events
- **Google Drive** — documents, spreadsheets, files
- **Google Docs** — individual documents
- **Google Sheets** — spreadsheet data
- **Notion** — pages and databases
- **GitHub** — repositories, issues, code
- **Linear** — issues and projects
- **Airtable** — bases and tables

### Local Sources
- **Folder sync** — mount a local directory and keep it in sync
- **File upload** — drag-and-drop or CLI upload for PDFs, CSVs, and more

### Web & API Sources
- **URL** — pull content from any public webpage
- **Custom scripts** — write Python or Node.js scripts that fetch data \
from any API, database, or service

### Databases
- **PostgreSQL**, **MySQL** — connect directly and sync query results

## How Sync Works

Each connected source creates one or more nodes in your context space. \
PuppyOne periodically fetches the latest data, detects changes, and \
updates the nodes. You can also trigger a manual sync at any time.

All sync operations are logged with timestamps, status, and error \
details for full visibility.
"""

AGENT_ACCESS_MD = """\
# Agent Access

PuppyOne provides multiple ways for AI agents to access your context space.

## MCP Protocol

MCP (Model Context Protocol) is the primary way agents interact with \
PuppyOne. Create an MCP endpoint, and any MCP-compatible agent — \
Claude, Cursor, Windsurf, and others — can read and write your \
context space natively.

Each MCP endpoint gets its own URL and access credentials. You control \
exactly which parts of the context space each endpoint can access.

## Sandbox Execution

For agents that need to run code, PuppyOne provides isolated sandbox \
environments. Agents can execute Python, Node.js, or shell commands \
in a secure container with access to your context data.

Sandboxes are ephemeral — they spin up, execute, and shut down \
automatically. All execution is logged.

## Access Control

PuppyOne gives you fine-grained control over what each agent can do:

- **Read-only** — agent can browse and read files
- **Read-write** — agent can also create and modify files
- **Scoped access** — limit an agent to specific folders or nodes

Permissions are managed per-connection, so each agent or integration \
gets exactly the access it needs.

## Monitoring

Every agent interaction is logged:
- Which agent accessed which files
- What queries were made
- When it happened
- Whether it succeeded or failed

Use the dashboard or CLI (`puppyone status`) to see a unified view \
of all agent activity.
"""


async def seed_default_content(
    service: ContentNodeService,
    project_id: str,
    created_by: str,
) -> dict:
    """
    Populate a newly created project with default seed content.

    Returns dict with created node IDs:
        { "getting_started": str, "guides_folder": str,
          "about": str, "connecting": str, "agent_access": str }
    """
    getting_started = await service.create_markdown_node(
        project_id=project_id,
        name="Getting Started",
        content=GETTING_STARTED_MD,
        parent_id=None,
        created_by=created_by,
    )

    guides = service.create_folder(
        project_id=project_id,
        name="Guides",
        parent_id=None,
        created_by=created_by,
    )

    about = await service.create_markdown_node(
        project_id=project_id,
        name="About PuppyOne",
        content=ABOUT_PUPPYONE_MD,
        parent_id=guides.id,
        created_by=created_by,
    )

    connecting = await service.create_markdown_node(
        project_id=project_id,
        name="Connecting Data",
        content=CONNECTING_DATA_MD,
        parent_id=guides.id,
        created_by=created_by,
    )

    agent_access = await service.create_markdown_node(
        project_id=project_id,
        name="Agent Access",
        content=AGENT_ACCESS_MD,
        parent_id=guides.id,
        created_by=created_by,
    )

    return {
        "getting_started": getting_started.id,
        "guides_folder": guides.id,
        "about": about.id,
        "connecting": connecting.id,
        "agent_access": agent_access.id,
    }
