## ADDED Requirements
### Requirement: Official receive-pack execution
Puppyone SHALL delegate Git receive-pack protocol handling and pack ingestion to stock `git receive-pack --stateless-rpc` before publishing accepted objects through the Version Engine.

#### Scenario: Large chunked Git push
- **WHEN** a Git client pushes a large pack without buffering the full request client-side
- **THEN** Puppyone spools the request body to disk
- **AND** stock Git consumes the exact receive-pack request bytes
- **AND** the accepted commit is published through the Version Engine after scope validation succeeds

#### Scenario: Flush-only stateless receive-pack request
- **WHEN** a Git client sends a receive-pack POST containing only a pkt-line flush
- **THEN** Puppyone returns the stock Git receive-pack response
- **AND** Puppyone does not return HTTP 400 for the absence of a ref update
- **AND** no Puppyone scope head is advanced

### Requirement: Canonical publish authority
The temporary Git transport cache and quarantine repository SHALL NOT be authoritative for Puppyone content.

#### Scenario: Product-level rejection after Git accepts a temporary ref
- **WHEN** stock Git accepts a push into the temporary quarantine repo
- **AND** Puppyone scope, exclude, LFS, conflict, or CAS validation rejects the submission
- **THEN** Puppyone returns a receive-pack `ng <ref>` response with a `puppyone-rejected` or `puppyone-pending` reason
- **AND** Puppyone does not promote the rejected objects as the canonical scope head

#### Scenario: Successful publish
- **WHEN** stock Git accepts the push and Version Engine publish succeeds
- **THEN** Puppyone promotes the reachable accepted objects into canonical storage
- **AND** Puppyone records scope head, history, audit, and outbox through the Version Engine
- **AND** Puppyone returns the stock Git receive-pack success response

### Requirement: Excluded scope preservation
Access Point Git remotes with excludes SHALL publish visible file changes without deleting hidden canonical files.

#### Scenario: Visible change on filtered clone
- **WHEN** a Git client clones an Access Point whose scope excludes a hidden subtree
- **AND** the client edits only a visible file and pushes `refs/heads/main`
- **THEN** Puppyone applies the visible file change to the canonical scope tree
- **AND** hidden excluded files remain present in canonical storage
- **AND** subsequent clones still omit the hidden excluded files
