## ADDED Requirements

### Requirement: Product Entry Point Taxonomy

The system SHALL model context entry points as four separate product concepts:
Upload, Import, Connect, and Access.

#### Scenario: User chooses a local folder

- **WHEN** a user adds files or folders from their local machine
- **THEN** the system classifies the action as Upload
- **AND** the system does not create a durable external source relationship

#### Scenario: User pastes an external repository URL for a one-time copy

- **WHEN** a user imports a GitHub repository URL once
- **THEN** the system classifies the action as Import
- **AND** the system does not create an Access surface
- **AND** the system does not create a durable Connection

#### Scenario: User binds an external repository for future updates

- **WHEN** a user connects a GitHub repository branch for future syncs
- **THEN** the system classifies the action as Connect
- **AND** each execution is represented as a SyncRun

#### Scenario: User enables a Git remote for a workspace scope

- **WHEN** a user enables scoped Git remote access
- **THEN** the system classifies the action as Access
- **AND** the system does not create an ImportJob

### Requirement: Upload Lifecycle

The system SHALL represent local file and folder ingestion with UploadJob and
UploadItem records.

#### Scenario: Upload starts

- **WHEN** an upload is accepted by the API
- **THEN** the system creates an UploadJob
- **AND** the system creates UploadItem records for individual files when
  per-file state is available

#### Scenario: Upload completes

- **WHEN** uploaded content is finalized into the Version Engine
- **THEN** the UploadJob records a terminal status
- **AND** the UploadJob records the resulting commit id when available

### Requirement: Import Lifecycle

The system SHALL represent one-shot external snapshots with ImportJob records.

#### Scenario: Import is queued

- **WHEN** a user requests a one-shot external import
- **THEN** the API creates an ImportJob
- **AND** an import worker executes the long-running provider fetch

#### Scenario: Import uses provider capabilities

- **WHEN** an import worker fetches external content
- **THEN** the worker may call provider capabilities
- **AND** the provider does not own ImportJob status transitions

### Requirement: Connection And Sync Lifecycle

The system SHALL represent durable external source relationships with
Connection records and individual executions with SyncRun records.

#### Scenario: Connection is created

- **WHEN** a user configures a durable external source relationship
- **THEN** the system creates a Connection
- **AND** the Connection records provider identity, trigger policy, cursor, and
  lifecycle state

#### Scenario: Connection is executed

- **WHEN** a durable source relationship is manually, scheduled, webhook,
  realtime, initial, or push triggered
- **THEN** the system creates a SyncRun
- **AND** the SyncRun owns execution progress and terminal status

### Requirement: Access Surfaces

The system SHALL represent workspace entry points for people, tools, agents,
and runtimes as AccessSurface records.

#### Scenario: Access surface is created

- **WHEN** the system exposes a Git remote, CLI, filesystem, agent, MCP, or
  sandbox surface for a scope
- **THEN** it creates or updates an AccessSurface
- **AND** it does not create an ImportJob

### Requirement: Activity Aggregation

The system SHALL provide a read-only activity aggregation for Upload, Import,
and SyncRun records.

#### Scenario: Frontend reads recent activity

- **WHEN** the frontend requests workspace activity
- **THEN** upload jobs, import jobs, and sync runs can be rendered in one list
- **AND** the underlying lifecycle models remain separate

### Requirement: Worker Queue Separation

The system SHALL execute long-running Upload, Import, and Sync work outside the
HTTP request path and on separate worker queues.

#### Scenario: Upload backlog exists

- **WHEN** upload processing has a large backlog
- **THEN** one-shot imports still have an independent import queue
- **AND** scheduled sync runs still have an independent sync queue
