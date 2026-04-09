"""
L3-Folder: Workspace File Interface Layer

Provides Agents with data access via local folder structure.

Responsible for:
- Creating an isolated workspace for each Agent (APFS Clone / full copy / OverlayFS)
- Detecting Agent changes (diff)
- Providing /api/v1/workspace/* API endpoints

No longer responsible for (migrated):
- Syncing PG/S3 -> local -> migrated to src/sync/ (L2.5)
- Conflict resolution / three-way merge -> migrated to src/collaboration/ (L2)
"""
