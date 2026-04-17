# Getting Started with PuppyOne: Your First AI Agent Workspace

*Published | Reviewed by Human Editor*

## Introduction

PuppyOne gives your AI agents a shared, versioned workspace with scoped permissions. Think of it as "Google Drive meets Git" — but designed for AI agents, not humans.

In this guide, you'll set up a workspace, connect two agents, and watch them collaborate on a document — all in under 10 minutes.

## Quick Start

### 1. Create a Project

Sign up at [puppyone.ai](https://puppyone.ai) and create a new project. You'll get a project ID.

### 2. Create Access Points

Each agent gets its own Access Point — a URL + key pair with scoped permissions.

In the PuppyOne dashboard, create two access points:

| Agent | Scope | Mode |
|-------|-------|------|
| Writer | `/draft/` | read-write |
| Reviewer | `/draft/` | read-only |

You'll get two access keys:
```
Writer:   https://api.puppyone.ai/api/v1/mut/ap/ak_writer_xxx/
Reviewer: https://api.puppyone.ai/api/v1/mut/ap/ak_reviewer_xxx/
```

### 3. Writer Agent Pushes Content

```python
import requests
import json

WRITER_URL = "https://api.puppyone.ai/api/v1/mut/ap/ak_writer_xxx"

# Clone current state
state = requests.post(f"{WRITER_URL}/clone", json={}).json()
print(f"Current version: {state['version']}")

# Push a new file
# (simplified — real implementation uses MUT protocol objects)
requests.post(f"{WRITER_URL}/push", json={
    "base_version": state["version"],
    "files": {"intro.md": "# Welcome to our product!"},
    "message": "Writer: add intro draft"
})
```

### 4. Reviewer Agent Reads Content

```python
REVIEWER_URL = "https://api.puppyone.ai/api/v1/mut/ap/ak_reviewer_xxx"

# Pull latest changes
changes = requests.post(f"{REVIEWER_URL}/pull", json={
    "since_version": 0
}).json()

for filename, content in changes["files"].items():
    print(f"Reviewing: {filename}")
    # Send to review pipeline...
```

### 5. Oops! Rollback.

Writer pushed a bad draft? No problem:

```python
requests.post(f"{WRITER_URL}/rollback", json={
    "target_version": 1  # Go back to version 1
})
# Creates v3 with v1's content. Nothing is lost.
```

## What Just Happened?

- Two agents shared a workspace without any shared credentials
- Each agent only saw files in its scope (`/draft/`)
- Every change was versioned automatically
- The reviewer couldn't accidentally modify the draft (read-only)
- Rollback was instant and non-destructive

## Next Steps

- [Add more agents with different scopes](/docs/scopes)
- [Set up webhooks for agent notifications](/docs/webhooks)
- [Explore the MUT protocol reference](/docs/mut-protocol)

---

*PuppyOne — Managed workspaces for AI agents.*
