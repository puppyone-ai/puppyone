# Puppyone Pay Plan Rules

This document defines the current intended billing plan rules for Puppyone.
It is the product-facing source for what each plan should allow. Runtime
enforcement should be implemented through organization entitlements.

## Plan Summary

| Plan | Seats | Projects | Scopes per project | Storage | Storage per project | Single file upload | Files per project | MCP | Workspace | Sandbox | Deployment |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | --- |
| Free | 1 | 1 | 2 | 1 GB | 1 GB | 50 MB | 2,000 | No | No | No | Cloud |
| Plus | 10 | 5 | 10 | 50 GB | 10 GB | 200 MB | 25,000 | Yes | No | No | Cloud |
| Pro | 50 | 50 | Unlimited | 500 GB | 50 GB | 500 MB | 250,000 | Yes | Yes | Yes | Cloud |
| Enterprise | Custom | Custom | Custom | Custom | Custom | Custom | Custom | Yes | Yes | Yes | Custom / private |

## Free

Free is for a single user validating a single project. It should be useful, but
it should not include server-heavy access surfaces.

- Seats: 1
- Projects: 1
- Scopes per project: 2
- Storage: 1 GB total, 1 GB per project
- Files per project: 2,000
- Single file upload: 50 MB
- Batch upload: 1 GB
- Allowed: Git Remote, CLI
- Not allowed: MCP, Workspace, Sandbox, Enterprise deployment

## Plus

Plus is for small teams that need MCP and more project/storage capacity, but not
hosted execution environments.

- Seats: 10
- Projects: 5
- Scopes per project: 10
- Storage: 50 GB total, 10 GB per project
- Files per project: 25,000
- Single file upload: 200 MB
- Batch upload: 5 GB
- Allowed: Git Remote, CLI, MCP
- Not allowed: Workspace, Sandbox, Enterprise deployment

## Pro

Pro is for larger teams that need hosted workspace and sandbox capabilities.

- Seats: 50
- Projects: 50
- Scopes per project: unlimited
- Storage: 500 GB total, 50 GB per project
- Files per project: 250,000
- Single file upload: 500 MB
- Batch upload: 20 GB
- Allowed: Git Remote, CLI, MCP, Workspace, Sandbox
- Not allowed: Enterprise deployment

## Enterprise

Enterprise is a custom commercial plan for larger deployments, private
deployment, dedicated support, and custom capacity.

- Seats: custom
- Projects: custom
- Scopes per project: custom
- Storage: custom
- Files per project: custom
- Single file upload: custom
- Batch upload: custom
- Allowed: Git Remote, CLI, MCP, Workspace, Sandbox
- Deployment: custom / private deployment available
- Pricing: contact sales; do not list this as a fixed $100 plan

## Entitlement Mapping

The billing implementation should map these rules into the entitlement sections
used by Puppyone:

- `features`: binary feature gates, such as `remote_workspace.create`,
  `scope_sandbox.connect`, `access_surface.mcp`, and `access_surface.sandbox`.
- `limits`: numeric caps, such as `projects.max`,
  `repo_scopes.max_per_project`, `files.max_per_project`,
  `storage.max_bytes`, `storage.max_bytes_per_project`,
  `upload.max_single_file_bytes`, and `upload.max_batch_bytes`.
- `allow`: allow-lists, such as `access_surface_kinds`.

Use `-1` or `"unlimited"` for unlimited numeric limits.

Do not expose `access_surface.agent` as a plan row in billing UI. It is a legacy
internal key, not a customer-facing paid capability. Customer-facing paid
capabilities are MCP, Workspace, Sandbox, and Enterprise deployment.

## Current Intended Entitlements

### Free

```json
{
  "features": {
    "access_surface.agent": false,
    "access_surface.mcp": false,
    "access_surface.sandbox": false,
    "remote_workspace.create": false,
    "scope_sandbox.connect": false
  },
  "limits": {
    "seats.max": 1,
    "projects.max": 1,
    "repo_scopes.max_per_project": 2,
    "access_surfaces.max_per_scope": 1,
    "access_surfaces.max_per_project": 2,
    "files.max_per_project": 2000,
    "storage.max_bytes": 1073741824,
    "storage.max_bytes_per_project": 1073741824,
    "upload.max_single_file_bytes": 52428800,
    "upload.max_batch_bytes": 1073741824
  },
  "allow": {
    "access_surface_kinds": ["git_remote", "cli", "direct"]
  }
}
```

### Plus

```json
{
  "features": {
    "access_surface.agent": false,
    "access_surface.mcp": true,
    "access_surface.sandbox": false,
    "remote_workspace.create": false,
    "scope_sandbox.connect": false
  },
  "limits": {
    "seats.max": 10,
    "projects.max": 5,
    "repo_scopes.max_per_project": 10,
    "access_surfaces.max_per_scope": -1,
    "access_surfaces.max_per_project": -1,
    "files.max_per_project": 25000,
    "storage.max_bytes": 53687091200,
    "storage.max_bytes_per_project": 10737418240,
    "upload.max_single_file_bytes": 209715200,
    "upload.max_batch_bytes": 5368709120
  },
  "allow": {
    "access_surface_kinds": ["git_remote", "cli", "direct", "mcp"]
  }
}
```

### Pro

```json
{
  "features": {
    "access_surface.agent": false,
    "access_surface.mcp": true,
    "access_surface.sandbox": true,
    "remote_workspace.create": true,
    "scope_sandbox.connect": true
  },
  "limits": {
    "seats.max": 50,
    "projects.max": 50,
    "repo_scopes.max_per_project": -1,
    "access_surfaces.max_per_scope": -1,
    "access_surfaces.max_per_project": -1,
    "files.max_per_project": 250000,
    "storage.max_bytes": 536870912000,
    "storage.max_bytes_per_project": 53687091200,
    "upload.max_single_file_bytes": 524288000,
    "upload.max_batch_bytes": 21474836480
  },
  "allow": {
    "access_surface_kinds": ["git_remote", "cli", "direct", "mcp", "sandbox"]
  }
}
```

### Enterprise

```json
{
  "features": {
    "access_surface.agent": false,
    "access_surface.mcp": true,
    "access_surface.sandbox": true,
    "remote_workspace.create": true,
    "scope_sandbox.connect": true
  },
  "limits": {
    "seats.max": -1,
    "projects.max": -1,
    "repo_scopes.max_per_project": -1,
    "access_surfaces.max_per_scope": -1,
    "access_surfaces.max_per_project": -1,
    "files.max_per_project": -1,
    "storage.max_bytes": -1,
    "storage.max_bytes_per_project": -1,
    "upload.max_single_file_bytes": -1,
    "upload.max_batch_bytes": -1
  },
  "allow": {
    "access_surface_kinds": "*"
  }
}
```

## Notes

- Git means Git Remote access.
- CLI means command-line access to the context drive.
- MCP starts at Plus because it uses hosted Puppyone infrastructure.
- `direct` is included in the implementation allow-list for compatibility with
  the current direct credential connection path; it is not a separate paid
  capability.
- Workspace refers to hosted remote workspace creation.
- Sandbox includes sandbox access surfaces and scope sandbox connection.
- `storage.max_bytes` and `storage.max_bytes_per_project` define product quota.
  Current upload routes already enforce `upload.max_single_file_bytes` and
  `upload.max_batch_bytes`; total storage enforcement must use the same storage
  keys when project/org usage accounting is wired in.
- The billing UI should show these rules at the organization level, because
  entitlements are stored per organization.
- PuppyPay must verify that the requesting user is the organization owner before
  creating checkout sessions or changing subscriptions.
- Runtime entitlement updates must be written from verified Polar webhook events,
  not from client-side checkout-return requests.
