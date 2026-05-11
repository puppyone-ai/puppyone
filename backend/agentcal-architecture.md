# AgentCal Architecture and Product Spec

## 1. Purpose

AgentCal is a lightweight, open-source scheduler and calendar built for AI agents.

It is not a human meeting calendar. It is an operational calendar for agent work:

- Run Codex jobs while the user is asleep.
- Maintain a schedule of recurring agent tasks.
- Let humans and agents inspect, add, move, pause, and run tasks from the terminal.
- Keep the local machine clean by using one long-running daemon instead of many cron jobs.
- Support both local standalone usage and a VPS-centered deployment with local runners.

The core idea is:

```text
Calendar entries define intent.
Runs define execution.
The daemon turns calendar entries into runs and assigns runs to executors.
```

## 2. Product Goals

AgentCal should feel like a tiny agent operating system for scheduled work.

Primary goals:

- Installable with npm.
- Written in TypeScript.
- Usable fully from the terminal.
- Runs as one main daemon process.
- Uses SQLite as the local persistent state store.
- Uses Codex CLI through `codex exec`.
- Supports fixed shell/script tasks as a first-class executor.
- Supports local standalone mode.
- Supports VPS controller plus local runner mode.
- Supports a terminal watch dashboard.
- Supports a full terminal UI.
- Avoids heavyweight dependencies such as Supabase, Redis, n8n, or LiteLLM.

Non-goals:

- No browser web frontend in the first version.
- No multi-user/team collaboration.
- No approval gate for sensitive actions.
- No executor plugin SDK in the first complete version.
- No dependency on n8n.
- No dependency on PuppyOne.

## 3. User Experience

Installation:

```bash
npm install -g agentcal
```

Local standalone:

```bash
agentcal init
agentcal serve
agentcal apply agentcal.yaml --dry-run
agentcal apply agentcal.yaml
agentcal agenda today
agentcal watch
agentcal runs
agentcal logs latest
```

VPS controller:

```bash
agentcal serve --host 0.0.0.0 --port 8765
```

Local Mac runner connected to VPS:

```bash
agentcal runner --connect https://vps.example.com --token $AGENTCAL_RUNNER_TOKEN
```

Managed Codex session:

```bash
agentcal codex start workbench
agentcal codex send workbench "Continue the overnight report task."
agentcal codex attach workbench
```

The default unattended execution path remains `codex exec`, not managed sessions.

## 4. Core Architecture

The best architecture for this scenario is a small controller/runner system with SQLite as the source of truth and executors as replaceable work backends.

```text
                  ┌────────────────────────────┐
                  │         agentcal CLI        │
                  │ agenda / apply / runs / tui │
                  └──────────────┬─────────────┘
                                 │
                                 ▼
┌──────────────────────────────────────────────────────────┐
│                    AgentCal Controller                    │
│                                                          │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────────┐ │
│  │  SQLite    │  │ Scheduler    │  │ Dispatcher       │ │
│  │ source of  │◀▶│ loop         │──▶│ runner selection │ │
│  │ truth      │  │ due runs     │  │ leases           │ │
│  └────────────┘  └──────────────┘  └─────────┬────────┘ │
│                                               │          │
│  ┌────────────┐  ┌──────────────┐             │          │
│  │ HTTP API   │  │ WebSocket    │◀────────────┘          │
│  │ durable    │  │ realtime     │                        │
│  └────────────┘  └──────────────┘                        │
└──────────────────────────────────────────────────────────┘
                         │
             ┌───────────┴───────────┐
             ▼                       ▼
┌──────────────────────┐  ┌──────────────────────┐
│ Local/VPS Runner     │  │ Mac Runner           │
│ codex / shell        │  │ codex / shell        │
│ managed sessions     │  │ managed sessions     │
└──────────────────────┘  └──────────────────────┘
```

The core runtime pipeline:

```text
YAML task definition
  -> calendar_entries
  -> planned_runs
  -> due run claimed by scheduler
  -> dispatcher selects local executor or remote runner
  -> runner lease prevents duplicate execution
  -> executor runs codex/shell/session task
  -> run_events capture logs
  -> artifacts and final status are stored
```

### 4.1 Architecture Principles

1. One controller owns schedule state.

There should not be multiple independent schedulers for the same workspace. This avoids duplicate runs and split-brain behavior.

2. SQLite is the source of truth.

Timers, WebSockets, and child processes are not authoritative. The database is authoritative. If the daemon restarts, it can recover by reading `planned_runs`, `runs`, and `runner_leases`.

3. The scheduler is DB-backed, not cron-backed.

AgentCal does not create one cron job per task. The daemon has one scheduling loop that checks due runs in SQLite and dispatches them.

4. Runners are hands, not brains.

A runner does not decide the calendar. It advertises capabilities, claims assigned work, executes, and streams results back.

5. WebSocket is only realtime notification.

The runner may receive `job_available` over WebSocket, but it still claims work through the controller API. If WebSocket disconnects, polling can recover.

6. Executors are the unit of customization.

The first executors are:

- `codex`
- `shell`
- `managed-codex-session`

This is enough for both agent tasks and deterministic automation without introducing a plugin system too early.

7. One long-running process per role.

The user should not see a messy process list. In local mode, `agentcal serve` owns all internal services. In VPS mode, the VPS runs `agentcal serve` and each local machine runs at most one `agentcal runner`.

8. Terminal is the product surface.

The CLI and TUI are not secondary. They are the main frontend. Browser UI is intentionally out of scope.

### 4.2 Why This Is the Best Fit

This architecture fits the problem because it balances reliability, simplicity, and future expansion:

- It works locally with zero infrastructure.
- It works on a VPS without changing the user model.
- It survives daemon restarts.
- It avoids per-task cron sprawl.
- It avoids Redis/Postgres/Supabase until they are truly needed.
- It can notify local machines without exposing inbound Mac ports.
- It lets Codex tasks and shell scripts share the same calendar, logs, and run history.
- It provides a clean path to terminal dashboards and managed Codex sessions.

### 4.3 What Not To Do

Avoid these designs:

- One cron entry per task.
- A separate daemon per executor.
- Letting both Mac and VPS independently schedule the same workspace.
- Treating a Codex session as the source of truth for task state.
- Injecting text into arbitrary user-opened terminal windows.
- Requiring a browser web UI for basic operation.
- Starting with Redis/Postgres/n8n-style workflow infrastructure before the local SQLite system is exhausted.

## 5. Deployment Modes

### 5.1 Local Standalone Mode

In standalone mode, one local process owns everything:

```text
Mac
└─ agentcal serve
   ├─ SQLite
   ├─ scheduler loop
   ├─ run dispatcher
   ├─ Codex executor
   ├─ managed Codex session manager
   └─ terminal API
```

This mode is best for:

- Development.
- Personal local tasks.
- Testing schedules and YAML definitions.
- Running Codex jobs while the Mac is awake.

Limitation:

- If the Mac sleeps, scheduling pauses. On wake, AgentCal can catch up, skip, or mark missed runs according to policy.

### 5.2 VPS Controller plus Local Runner Mode

In controller/runner mode, the VPS is the brain and the Mac is an optional hand.

```text
VPS
└─ agentcal serve
   ├─ SQLite
   ├─ scheduler loop
   ├─ calendar planner
   ├─ HTTP API
   ├─ WebSocket runner channel
   ├─ runner registry
   └─ dispatcher

Mac
└─ agentcal runner
   ├─ outbound connection to VPS
   ├─ heartbeat
   ├─ Codex executor
   ├─ managed Codex session manager
   └─ local file/browser-capable execution surface later
```

Controller responsibilities:

- Store calendar entries.
- Compute planned runs.
- Decide when a run is due.
- Assign runs to available runners.
- Track logs, artifacts, statuses, and runner heartbeats.

Runner responsibilities:

- Connect outbound to the controller.
- Advertise capabilities, such as `codex`, `managed-codex-session`, `shell`, or later `browser`.
- Claim assigned runs.
- Execute runs locally.
- Stream logs back.
- Report final status.

Important constraint:

```text
There is only one controller per workspace.
```

The local runner does not independently schedule tasks when connected to a VPS controller. This prevents duplicate runs.

## 6. Controller and Runner Explained

Controller means: the process that decides what should happen and when.

Runner means: the process that performs work after being assigned a run.

Example:

```yaml
tasks:
  - id: nightly-report
    runner: vps
    schedule:
      rrule: "FREQ=DAILY;BYHOUR=2;BYMINUTE=0"
      timezone: "Asia/Shanghai"
    executor:
      type: codex
      cwd: "~/work/project"
      prompt: "./prompts/nightly-report.md"

  - id: local-repo-maintenance
    runner: mac
    schedule:
      rrule: "FREQ=DAILY;BYHOUR=3;BYMINUTE=30"
      timezone: "Asia/Shanghai"
    executor:
      type: codex
      cwd: "~/private/local-repo"
      prompt: "./prompts/maintenance.md"
```

At 02:00, the VPS can run `nightly-report` itself.

At 03:30, the VPS sees that `local-repo-maintenance` requires the Mac runner. If the Mac is online, it dispatches the run. If the Mac is offline, the run becomes `waiting_runner`, `missed`, or `fallback_pending` depending on policy.

## 7. Scheduling Model

AgentCal uses a database-backed scheduling loop.

The scheduler does not rely on system cron for each task. The operating system only keeps the daemon alive through tools like systemd, launchd, or Docker restart policy.

AgentCal itself stores schedule state in SQLite:

```text
calendar_entries -> planned_runs -> runs
```

Basic loop:

```text
1. Look for due planned runs.
2. Claim due runs in a SQLite transaction.
3. Create or update run records.
4. Dispatch to local executor or remote runner.
5. Recompute future planned runs.
6. Sleep briefly and repeat.
```

Simple implementation:

```ts
while (running) {
  const dueRuns = store.claimDueRuns({ now: new Date(), limit: 20 });

  for (const run of dueRuns) {
    dispatcher.dispatch(run);
  }

  await sleep(1000);
}
```

Precision target:

- AgentCal is not a hard real-time system.
- A run scheduled for `02:00:00` should normally start within a few seconds.
- The actual start time is recorded separately from scheduled time.

Example fields:

```text
scheduled_for = 2026-05-11T02:00:00Z
not_before    = 2026-05-11T02:00:00Z
started_at    = 2026-05-11T02:00:03Z
```

## 8. Calendar Format

AgentCal uses YAML as the human- and agent-editable source format.

Schedules use iCalendar-style RRULE strings where possible.

Example `agentcal.yaml`:

```yaml
version: 1

defaults:
  timezone: "Asia/Shanghai"
  executor:
    type: codex
    sandbox: workspace-write
    approval: never

tasks:
  - id: nightly-report
    title: Nightly Report
    runner: vps
    schedule:
      rrule: "FREQ=DAILY;BYHOUR=2;BYMINUTE=0"
      timezone: "Asia/Shanghai"
    executor:
      type: codex
      cwd: "~/work/project"
      prompt: "./prompts/nightly-report.md"
      sandbox: workspace-write
      approval: never
    policy:
      max_duration_minutes: 120
      if_missed: catch_up

  - id: inbox-cleanup
    title: Inbox Cleanup
    runner: any
    schedule:
      rrule: "FREQ=WEEKDAY;BYHOUR=3;BYMINUTE=30"
      timezone: "Asia/Shanghai"
    executor:
      type: codex
      cwd: "~/work/inbox"
      prompt_inline: |
        Review the inbox notes and produce a concise triage summary.
    policy:
      max_duration_minutes: 60
      if_missed: skip

  - id: local-backup
    title: Local Backup Script
    runner: mac
    schedule:
      rrule: "FREQ=DAILY;BYHOUR=4;BYMINUTE=0"
      timezone: "Asia/Shanghai"
    executor:
      type: shell
      cwd: "~/work/scripts"
      shell: "bash"
      script: "./backup.sh"
      env:
        BACKUP_MODE: "incremental"
    policy:
      max_duration_minutes: 45
      if_missed: wait_runner

  - id: fixed-report-command
    title: Fixed Report Command
    runner: vps
    schedule:
      rrule: "FREQ=DAILY;BYHOUR=5;BYMINUTE=0"
      timezone: "Asia/Shanghai"
    executor:
      type: shell
      cwd: "~/reports"
      command: "npm run generate:daily"
    policy:
      max_duration_minutes: 30
      if_missed: catch_up
```

Supported runner values:

- `local`
- `vps`
- `mac`
- `any`
- named runner IDs, such as `macbook-pro`

Supported first executor:

- `codex`
- `shell`

Included advanced executor:

- `managed-codex-session`

Not included in current scope:

- browser executor
- plugin executor SDK
- approval-gated executor actions

## 9. Executors

AgentCal supports multiple executor types. An executor is the concrete way a run does work after the scheduler has decided that the run is due.

Core executors:

- `codex`: sends a task to Codex through `codex exec`.
- `shell`: runs a fixed command or script.
- `managed-codex-session`: sends messages to an AgentCal-owned interactive Codex session.

### 9.1 Shell Executor

The shell executor is first-class. It is for deterministic jobs where the user already knows what should be run.

Examples:

```yaml
executor:
  type: shell
  cwd: "~/work/scripts"
  shell: "bash"
  script: "./backup.sh"
  env:
    BACKUP_MODE: "incremental"
```

```yaml
executor:
  type: shell
  cwd: "~/reports"
  command: "npm run generate:daily"
```

```yaml
executor:
  type: shell
  cwd: "~/work/project"
  shell: "bash"
  script_inline: |
    set -euo pipefail
    npm test
    npm run build
```

Supported shell executor fields:

```text
cwd
command
script
script_inline
shell
env
timeout_seconds
```

Execution rules:

- Exactly one of `command`, `script`, or `script_inline` should be provided.
- `cwd` is required unless the workspace defines a default working directory.
- `script` paths are resolved relative to `cwd` unless absolute.
- `script_inline` is materialized into a per-run temporary script file before execution.
- stdout and stderr are captured into `run_events`.
- exit code is stored on the run.
- non-zero exit code marks the run as failed.
- timeout marks the run as timed out and terminates the child process.

Why this is included in the core:

- Not every scheduled task needs an LLM.
- Users often already have working scripts.
- Fixed scripts are easier to reproduce and debug.
- AgentCal can serve as a single clean scheduler for both agent work and normal automation.

### 9.2 Codex Exec Executor

The default unattended executor is `codex exec`.

AgentCal invokes Codex as a child process:

```bash
codex exec \
  -C /path/to/repo \
  --sandbox workspace-write \
  --ask-for-approval never \
  --json \
  "task prompt"
```

Default behavior:

- `sandbox`: `workspace-write`
- `approval`: `never`
- session reuse: disabled
- output capture: enabled
- JSONL event capture: enabled when available

Why this is the default:

- It works without an already-open terminal.
- It is easy to supervise.
- It has a clear exit code.
- It can be timed out and retried.
- Logs can be captured reliably.

### 9.3 Managed Codex Session

Managed sessions are included in the full target scope, but they are not the default execution path.

AgentCal starts and owns an interactive Codex process inside a PTY:

```text
agentcald
└─ managed session: workbench
   └─ codex interactive process
```

Commands:

```bash
agentcal codex start workbench
agentcal codex send workbench "Start the scheduled refactor pass."
agentcal codex attach workbench
agentcal codex stop workbench
```

Rules:

- AgentCal only controls Codex sessions it created.
- AgentCal does not inject text into arbitrary user-opened terminals.
- Managed sessions are for long-lived collaboration.
- Scheduled unattended runs should still prefer `codex exec`.

## 10. Terminal Interfaces

AgentCal has three terminal surfaces.

### 10.1 Plain CLI

The CLI is the primary automation interface.

Examples:

```bash
agentcal agenda today
agentcal agenda week
agentcal apply agentcal.yaml --dry-run
agentcal runs --status failed
agentcal logs latest
agentcal rerun run_123
agentcal pause nightly-report
agentcal resume nightly-report
```

The CLI must support:

- readable table output
- JSON output through `--json`
- dry-run mode
- non-interactive use by agents

### 10.2 Watch Dashboard

`agentcal watch` is a live terminal dashboard.

It is not a browser UI. It renders inside the terminal.

Initial layout:

```text
AgentCal Watch

Now
  02:07  running  nightly-report    codex    7m12s

Next
  03:30  inbox-cleanup      any      scheduled
  09:00  morning-summary    vps      planned

Recent
  success  nightly-report   18m
  failed   repo-cleanup      2m

Runners
  vps-controller  online
  macbook-pro     offline
```

This can be implemented first with simple terminal redraws, then upgraded to Ink.

### 10.3 Full TUI

The full terminal UI is in scope.

Recommended implementation:

- Ink
- React-style terminal components
- keyboard navigation
- log tailing
- run detail pane
- agenda pane
- runner pane
- managed Codex session pane

Example:

```text
┌ Agenda ──────────────┐ ┌ Runs ─────────────────────┐ ┌ Details ──────────────┐
│ 02:00 nightly-report │ │ running run_1026          │ │ task: nightly-report  │
│ 03:30 inbox-cleanup  │ │ failed  run_1025          │ │ executor: codex       │
│ 09:00 summary        │ │ success run_1024          │ │ cwd: ~/work/project   │
└──────────────────────┘ └───────────────────────────┘ └───────────────────────┘
```

## 11. Storage

AgentCal uses SQLite.

Reason:

- Simple install.
- One file.
- No external service.
- Good enough for personal scheduling and runner coordination.
- WAL mode gives adequate read/write behavior for this use case.

SQLite is only authoritative on the controller.

In local standalone mode:

```text
Mac SQLite = source of truth
```

In VPS controller mode:

```text
VPS SQLite = source of truth
Mac runner = mostly stateless
```

Suggested tables:

```text
workspaces
calendar_entries
calendar_ops
planned_runs
runs
run_events
runners
runner_leases
artifacts
managed_sessions
```

### 11.1 calendar_entries

Stores desired schedules and task definitions.

Important fields:

```text
id
workspace_id
task_id
title
runner_selector
schedule_rrule
timezone
executor_type
executor_config_json
policy_json
enabled
created_at
updated_at
```

### 11.2 planned_runs

Stores generated future run instances.

Important fields:

```text
id
entry_id
scheduled_for
not_before
deadline
status
created_at
```

### 11.3 runs

Stores actual execution attempts.

Important fields:

```text
id
planned_run_id
entry_id
status
runner_id
executor_type
scheduled_for
started_at
finished_at
exit_code
error
created_at
updated_at
```

### 11.4 run_events

Append-only event log.

Examples:

```text
created
claimed
started
stdout
stderr
codex_event
artifact
finished
failed
timed_out
```

### 11.5 runners

Tracks online runner processes.

Important fields:

```text
id
name
kind
capabilities_json
last_seen_at
status
version
```

### 11.6 runner_leases

Prevents duplicate execution.

Important fields:

```text
id
run_id
runner_id
lease_until
status
created_at
```

## 12. Runner Protocol

Transport:

- WebSocket for realtime notifications and log streaming.
- HTTP for durable claim/update operations.
- Polling fallback for reliability.

Runner startup:

```text
1. Runner connects to controller.
2. Runner authenticates with token.
3. Runner sends capabilities.
4. Controller records heartbeat.
5. Controller sends job_available hints.
6. Runner claims jobs through HTTP transaction endpoint.
```

Important principle:

```text
WebSocket is a notification channel, not the source of truth.
SQLite/API is the source of truth.
```

Example capabilities:

```json
{
  "runnerId": "macbook-pro",
  "capabilities": ["codex", "managed-codex-session", "shell"],
  "labels": {
    "os": "macos",
    "location": "local"
  }
}
```

## 13. Process Model

AgentCal should keep the user's machine clean.

There should be one long-running AgentCal process per role:

```text
agentcal serve   # controller process
agentcal runner  # local runner process when using VPS mode
```

The controller process internally manages:

- scheduler loop
- SQLite store
- HTTP API
- WebSocket channel
- dispatcher
- local worker if standalone
- managed sessions

Child processes are allowed for actual execution:

- `codex exec`
- configured shell commands and scripts
- managed Codex PTY process

These are supervised by AgentCal and recorded as runs or sessions.

## 14. Missed Run Policies

A run may be missed if:

- the controller was offline
- the required runner was offline
- the machine was asleep
- concurrency limits blocked execution past deadline

Supported policies:

```text
catch_up       run as soon as possible
skip           mark missed and move on
wait_runner    wait until matching runner returns
fallback       try another runner if possible
```

Example:

```yaml
policy:
  if_missed: catch_up
  max_delay_minutes: 240
```

## 15. Security Model

Current scope intentionally stays simple.

Included:

- Runner token authentication.
- Localhost default binding.
- Explicit `--host 0.0.0.0` for VPS exposure.
- Codex sandbox defaults to `workspace-write`.
- Codex approval defaults to `never`.
- Shell tasks run only from explicit user/agent-applied YAML definitions.
- Shell tasks require `cwd` and capture stdout/stderr/exit code.
- Command logs are stored.
- Managed sessions are only controlled if AgentCal created them.

Not included:

- Sensitive-action approval gates.
- Multi-user RBAC.
- Browser profile security.
- Current Chrome tab control.

## 16. Roadmap Scope

The agreed target includes what was previously described as V1, V2, and selected V3.

Included in target:

- TypeScript implementation.
- npm install experience.
- Local standalone mode.
- VPS controller mode.
- Local runner mode.
- SQLite state.
- YAML task definitions.
- RRULE-based scheduling.
- Scheduler loop.
- Codex exec executor.
- Shell command/script executor.
- Managed Codex sessions.
- Watch dashboard.
- Full terminal UI.

Excluded from target:

- Browser executor.
- Approval gate for sensitive actions.
- Executor plugin SDK.
- Multi-user collaboration.
- Browser web frontend.

## 17. Recommended Build Order

Even if the product target includes all selected V1/V2/V3 features, implementation should still proceed in thin vertical slices.

### Slice 1: Local Core

- `agentcal init`
- SQLite schema
- YAML parser
- `agentcal apply --dry-run`
- `agentcal agenda`
- scheduler loop
- local run creation

### Slice 2: Shell and Codex Exec

- Shell executor
- command/script/script_inline handling
- Codex executor
- run events
- stdout/stderr capture
- `agentcal runs`
- `agentcal logs`
- timeout handling

### Slice 3: Watch Dashboard

- `agentcal watch`
- live recent runs
- next runs
- running jobs
- runner status placeholder

### Slice 4: VPS Controller and Runner

- HTTP API
- runner token
- WebSocket connection
- runner heartbeat
- job claim
- remote log streaming

### Slice 5: Managed Codex Session

- PTY process manager
- `agentcal codex start`
- `agentcal codex send`
- `agentcal codex attach`
- session logs

### Slice 6: Full TUI

- Ink app
- agenda pane
- runs pane
- logs pane
- runners pane
- session pane

## 18. Final Architecture Summary

AgentCal is a small TypeScript daemon and CLI for scheduling AI agent work.

It should install like a normal npm tool, run locally with no external dependencies, and scale to a VPS-centered controller/runner setup without changing the user's mental model.

The best-practice architecture is:

```text
One controller owns schedule state.
SQLite is the source of truth.
The scheduler loop creates due runs.
Runners execute claimed runs.
Codex exec is the default unattended executor.
Shell scripts and fixed commands are first-class scheduled executors.
Managed Codex sessions are available for long-lived interactive work.
The terminal is the primary UI.
```
