# Change: Repair the landing-to-hosted-MCP public contract

## Why

The public Web tools cannot claim a preview because the Web client omits the
required organization id. The CLI and published instructions also advertise
MCP credential transports that the canonical runtime rejects.

## What Changes

- Require the Web client to select an authorized organization before claiming a
  landing preview.
- Return a newly-created MCP key only in the create response consumed by the
  CLI; list and detail responses remain credential-free.
- Make the single public MCP configuration contract an Authorization Bearer
  header, and remove URL/query/path-key credential guidance from the Web site.

## Impact

- Affected capabilities: landing import, MCP endpoint creation, CLI guidance.
- Affected code: `platform/landing`, unified Access, CLI, and `puppyone-web`
  tool and agent-readable documentation surfaces.
