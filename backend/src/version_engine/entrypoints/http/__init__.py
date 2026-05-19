"""
HTTP entry points for the version engine.

  content_router       Content API (/api/v1/content/...)
  content_history      Version history & rollback API
  access_point         Access-key → (project, scope) resolver (no HTTP routes)
  access_point_fs      Scoped cloud filesystem CLI backend (/api/v1/ap-fs/...)
  audit_router         Audit log query (read-only)
  ws_router            Server→client commit notifications (WebSocket)

Git smart-HTTP routes live under ``adapters/git/router.py``; the removed
pre-Git version wire protocol is not routed here.
"""
