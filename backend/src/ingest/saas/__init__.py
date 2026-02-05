"""
SaaS Ingest Module - Handles SaaS platform data synchronization.

Architecture:
- service.py: Business logic (task creation, enqueue to ARQ)
- task/: Task management (models, repository, manager)
- handlers/: Data source handlers (github, notion, gmail, google_drive, etc.)
- jobs/: ARQ worker jobs

Supported import types:
- GitHub: Repository imports (ZIP download → S3)
- Notion: Page/Database imports
- Airtable: Base imports
- Google Sheets: Spreadsheet imports
- Google Drive: File imports
- Google Docs: Document imports
- Google Calendar: Event imports
- Gmail: Message imports
- Linear: Project imports
- URL: Generic web scraping (Firecrawl)

NOTE: All API endpoints are now unified under /api/v1/ingest/*
See src/ingest/router.py for the unified entry point.
"""
