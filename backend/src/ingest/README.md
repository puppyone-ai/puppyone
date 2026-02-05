# Ingest Module - Unified Data Import System

## Overview

The `ingest` module provides a unified entry point for all data import operations:
- **File ingestion**: Local file uploads → File Worker (OCR, LLM extraction)
- **SaaS ingestion**: SaaS platform sync → SaaS Worker (GitHub, Notion, Gmail, etc.)
- **URL ingestion**: Generic web pages → SaaS Worker (via Firecrawl)

---

## Directory Structure

```
src/ingest/
├── __init__.py              # Module exports
├── router.py                # 🚪 Unified entry point: /api/v1/ingest/*
├── schemas.py               # Unified Request/Response schemas
├── service.py               # Gateway service (routes to file/saas)
├── dependencies.py          # FastAPI dependency injection
├── config.py                # Module configuration
├── README.md                # This file
│
├── file/                    # 📄 File processing
│   ├── service.py           # FileIngestService
│   ├── jobs/
│   │   ├── worker.py        # File Worker configuration
│   │   └── jobs.py          # ocr_job, postprocess_job
│   ├── ocr/                 # MineRU OCR client
│   ├── rules/               # ETL extraction rules
│   └── ...
│
├── saas/                    # 🔗 SaaS sync
│   ├── service.py           # SaaSIngestService
│   ├── jobs/
│   │   ├── worker.py        # SaaS Worker configuration
│   │   └── jobs.py          # import_job
│   ├── handlers/            # Platform-specific handlers
│   │   ├── github_handler.py
│   │   ├── notion_handler.py
│   │   ├── gmail_handler.py
│   │   └── ...
│   └── ...
│
└── shared/                  # 🔄 Shared components
    └── task/normalizers.py  # Result normalization
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/ingest/submit/file` | Upload and process files |
| POST | `/api/v1/ingest/submit/saas` | Import from SaaS/URL |
| GET | `/api/v1/ingest/tasks/{task_id}?source_type=...` | Get task status |
| POST | `/api/v1/ingest/tasks/batch` | Batch query task statuses |
| DELETE | `/api/v1/ingest/tasks/{task_id}?source_type=...` | Cancel task |
| GET | `/api/v1/ingest/health` | Health check |

---

## Source Types

| Source Type | Description | Worker |
|-------------|-------------|--------|
| `file` | Local file uploads | File Worker |
| `saas` | SaaS platforms (GitHub, Notion, etc.) | SaaS Worker |
| `url` | Generic web URLs | SaaS Worker |

---

## Ingest Types

### File Types (source_type = "file")
- `pdf` - PDF documents → OCR processing
- `image` - Images → OCR processing
- `text` - Text files (txt, md, json, code) → Direct storage
- `document` - Other documents (docx, xlsx) → OCR processing

### SaaS Types (source_type = "saas")
- `github` - GitHub repositories, issues, PRs
- `notion` - Notion pages and databases
- `gmail` - Gmail messages
- `google_drive` - Google Drive files
- `google_sheets` - Google Sheets
- `google_docs` - Google Docs
- `google_calendar` - Google Calendar events
- `airtable` - Airtable bases
- `linear` - Linear projects and issues

### URL Types (source_type = "url")
- `web_page` - Generic web pages (via Firecrawl)

---

## Worker Deployment

### Railway SERVICE_ROLE

| SERVICE_ROLE | Worker | Module Path |
|--------------|--------|-------------|
| `api` (default) | API Server | `src.main:app` |
| `file_worker` | File Worker | `src.ingest.file.jobs.worker.WorkerSettings` |
| `saas_worker` | SaaS Worker | `src.ingest.saas.jobs.worker.WorkerSettings` |
| `mcp_server` | MCP Server | `mcp_service.server:app` |

---

## Usage Examples

### Submit File Ingest (Python)

```python
import httpx

async def upload_files(project_id: str, files: list[str], access_token: str):
    async with httpx.AsyncClient() as client:
        files_data = [("files", open(f, "rb")) for f in files]
        response = await client.post(
            "https://api.example.com/api/v1/ingest/submit/file",
            data={
                "project_id": project_id,
                "mode": "smart",  # smart, raw, or structured
            },
            files=files_data,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        return response.json()
```

### Submit SaaS Ingest (Python)

```python
import httpx

async def import_github_repo(project_id: str, repo_url: str, access_token: str):
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://api.example.com/api/v1/ingest/submit/saas",
            data={
                "project_id": project_id,
                "url": repo_url,
            },
            headers={"Authorization": f"Bearer {access_token}"},
        )
        return response.json()
```

### Query Task Status (Python)

```python
import httpx

async def get_task_status(task_id: str, source_type: str, access_token: str):
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"https://api.example.com/api/v1/ingest/tasks/{task_id}",
            params={"source_type": source_type},
            headers={"Authorization": f"Bearer {access_token}"},
        )
        return response.json()
```

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Frontend                                        │
│                                                                              │
│   POST /api/v1/ingest/submit/file     POST /api/v1/ingest/submit/saas       │
│                                                                              │
└───────────────────────────────────┬──────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    src/ingest/router.py (Gateway)                            │
│                                                                              │
│   - Parse source_type                                                        │
│   - Route to file/ or saas/ service                                          │
│   - Normalize responses                                                      │
│                                                                              │
└───────────────────────────────────┬──────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
                    ▼                               ▼
┌───────────────────────────────┐   ┌───────────────────────────────┐
│     src/ingest/file/          │   │     src/ingest/saas/          │
│                               │   │                               │
│  ┌─────────────────────────┐  │   │  ┌─────────────────────────┐  │
│  │ service.py              │  │   │  │ service.py              │  │
│  │ (FileIngestService)     │  │   │  │ (SaaSIngestService)     │  │
│  └───────────┬─────────────┘  │   │  └───────────┬─────────────┘  │
│              │                │   │              │                │
│              │ ARQ enqueue    │   │              │ ARQ enqueue    │
│              ▼                │   │              ▼                │
│  ┌─────────────────────────┐  │   │  ┌─────────────────────────┐  │
│  │ Redis Queue: etl        │  │   │  │ Redis Queue: import     │  │
│  └───────────┬─────────────┘  │   │  └───────────┬─────────────┘  │
│              │                │   │              │                │
│              ▼                │   │              ▼                │
│  ┌─────────────────────────┐  │   │  ┌─────────────────────────┐  │
│  │ File Worker             │  │   │  │ SaaS Worker             │  │
│  │ - OCR (MineRU)          │  │   │  │ - GitHub API            │  │
│  │ - LLM extraction        │  │   │  │ - Notion API            │  │
│  │ - Rule processing       │  │   │  │ - Google APIs           │  │
│  └─────────────────────────┘  │   │  │ - Firecrawl             │  │
│                               │   │  └─────────────────────────┘  │
└───────────────────────────────┘   └───────────────────────────────┘
```
