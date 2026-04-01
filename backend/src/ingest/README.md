# Ingest Module - File Upload and Processing Pipeline

## Overview

The `ingest` module provides file upload and processing capabilities:
- **File upload**: Local file uploads → File Worker (OCR, LLM extraction)
- **Unified gateway**: Routes to file processing or SaaS sync

---

## Directory Structure

```
src/ingest/
├── __init__.py              # Module exports
├── router.py                # Unified entry point: /api/v1/ingest/*
├── schemas.py               # Unified Request/Response schemas
├── service.py               # Gateway service (routes to file/saas)
├── dependencies.py          # FastAPI dependency injection
├── config.py                # Module configuration
│
├── file/                    # File processing (ETL pipeline)
│   ├── service.py           # ETLService
│   ├── jobs/
│   │   ├── worker.py        # File Worker configuration
│   │   └── jobs.py          # ocr_job, postprocess_job
│   ├── ocr/                 # OCR providers (MineRU, Reducto)
│   ├── rules/               # ETL extraction rules
│   └── ...
│
└── shared/                  # Shared components
    └── task/normalizers.py  # Result normalization
```

---

## Worker Deployment

| SERVICE_ROLE | Worker | Module Path |
|--------------|--------|-------------|
| `api` (default) | API Server | `src.main:app` |
| `file_worker` | File Worker | `src.ingest.file.jobs.worker.WorkerSettings` |
| `mcp_server` | MCP Server | `mcp_service.server:app` |
