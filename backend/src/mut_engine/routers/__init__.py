"""
HTTP entry points for the MUT engine.

  content_router    Content API (/api/v1/content/...)
  protocol_router   MUT wire protocol (/api/v1/mut/...)
  access_point      Access Key URL variant (/mut/ap/{key}/...)
  audit_router      Audit log query (read-only, does not go through MUT)
"""
