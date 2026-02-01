"""
Import Module - Unified import system for all data sources.

Note: Named 'import_' because 'import' is a Python reserved keyword.

Architecture:
- router.py: FastAPI endpoints (/import/submit, /import/tasks)
- service.py: Business logic (task creation, enqueue to ARQ)
- task/: Task management (models, repository, manager)
- handlers/: Data source handlers (github, notion, url, file)
- jobs/: ARQ worker jobs

Supported import types:
- GitHub: Repository imports (ZIP download → S3)
- Notion: Page/Database imports
- Airtable: Base imports
- Google Sheets: Spreadsheet imports
- Linear: Project imports
- URL: Generic web scraping (Firecrawl)
- File: ETL (PDF/images → OCR → JSON)

Usage:
    from src.import_.router import router
    from src.import_.schemas import ImportType, ImportStatus
"""
