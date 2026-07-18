## ADDED Requirements

### Requirement: Tenant-bound landing claims
The Web client SHALL send an explicit organization id selected from the
authenticated user's authorized organizations when it claims a landing ticket.

#### Scenario: User has multiple organizations
- **WHEN** an authenticated user activates a landing preview and has multiple
  organizations
- **THEN** the Web client requires an explicit organization selection before it
  calls the claim endpoint.

#### Scenario: User has one organization
- **WHEN** an authenticated user activates a landing preview and has exactly
  one organization
- **THEN** the Web client claims the ticket with that organization id.

### Requirement: Hosted MCP credential transport
The product SHALL configure Hosted MCP with `Authorization: Bearer <mcp_key>`
and SHALL NOT document replayable MCP credentials in URLs, query strings, path
segments, or `X-MCP-API-Key` headers.

#### Scenario: CLI creates an MCP endpoint
- **WHEN** the CLI receives a successful MCP creation response
- **THEN** it displays a Bearer-header configuration using the one-time key
  returned in that response.

#### Scenario: Endpoint is listed after creation
- **WHEN** an MCP endpoint is retrieved through a list or detail read
- **THEN** no replayable MCP key is returned.
