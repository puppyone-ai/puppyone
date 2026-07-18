## Context

Landing claim is tenant-bound on the backend. The browser must select a
currently authorized organization rather than infer one. A newly issued MCP
secret may only be returned from its creation response; it must never be
returned by list or detail reads.

## Decisions

- The Web client lists the caller's organizations with the caller's bearer
  token, auto-selects only a single available organization, and presents an
  explicit selection when there are several.
- The canonical Hosted MCP runtime remains `Authorization: Bearer <mcp_key>`.
- The unified `/access` create response uses `cli_access_key` for the
  one-time MCP secret; this avoids reintroducing `access_key` to durable/list
  shapes.

## Risks and rollback

- The Web change only adds the already-required `org_id`; rolling it back
  restores the existing claim failure, so it will be deployed together with
  its Web consumer.
- Existing leaked URL/path-key instructions are removed rather than supported.
