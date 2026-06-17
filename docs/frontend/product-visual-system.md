# Product Visual System

This file captures the current Puppyone product UI rhythm used by Data,
Access, Home, Develop, and Workflow surfaces. New project pages should start
from these values before introducing local variants.

## Surfaces

- Page background: `var(--po-canvas)`.
- Panel background: `var(--po-panel)`.
- Hover row background: `var(--po-hover)`.
- Selected row background: `var(--po-selected)` plus a 2px accent bar when a
  persistent list selection is needed.
- Standard border: `var(--po-border)`.
- Quiet card/row border: `var(--po-border-subtle)`.
- Hover border: `var(--po-border-strong)`.
- Radius: 8px for cards and rows, 6px for controls.

## Type

- Page chrome title: 13px / 18px, weight 600.
- Card/list title: 12px / 16px, weight 600.
- Labels and controls: 12px / 16px, weight 500.
- Metadata: 11px / 14px, weight 500.
- Body copy inside panels: 12px / 16px, weight 400.
- Letter spacing is 0 except uppercase table headers, which may use the
  existing Develop log style.

## Geometry

- Page header height: 46px.
- Subsidebar width: 300px.
- Sidebar/list row height: 54-64px depending on secondary metadata.
- Provider avatar container: 30x30px.
- Provider logo inside avatar: 18x18px.
- Icon button: 30x30px.
- Text button: 30px height.
- Text input/select: 34px height.
- Dense table row: 34px minimum height.

## Provider Marks

- Prefer backend `icon_url`.
- Render provider logos at 18px, centered inside a 30px neutral hover-surface
  avatar container.
- Do not replace Google/Gmail/GitHub provider marks with generic database or
  document glyphs when a provider is known.

## Status Indicators

Status indicators are the small green/yellow/red/gray lamps or semantic markers
used to show runtime, authorization, or action-needed state: access scope
status, connector state, OAuth authorization state, sync state, server
connection state, project health, Needs action rows, and similar live status.

- Always render status lamps through `frontend/components/ui/StatusDot.tsx`.
  Use `StatusDot` for dot-only UI and `StatusIndicator` for dot + label.
- Canonical lamp size is 6px. Do not hand-roll 4px/5px/7px/8px variants.
- Status lamps are flat. Do not add shadow, glow, blur, ping, or pulse effects.
- Status lamps use semantic tones only:
  - success: `active`, `ready`, `connected`, `success`, `completed`, `online`.
  - accent: `syncing`, `processing`, `running`, `loading`.
  - warning: `pending`, `warning`, `paused`, `queued`, `mixed`.
  - danger: `error`, `failed`, `danger`, `blocked`, `needs attention`.
  - muted: `inactive`, `disconnected`, `stopped`, unknown, or empty.
- If the dot sits on top of an avatar or provider mark, the caller may add a
  local border for separation, but the dot itself still comes from `StatusDot`.
- Timeline/action-needed markers use the same square geometry when they encode
  state. Required-field markers should also use the same 6px rounded-square
  shape, even when they are implemented inline inside compact forms.
- Do not use status lamps for non-status decoration. Count badges, selection
  checkmarks, icon internals, loading dots, progress bars, and onboarding
  decoration may keep their own visual treatment.

## Workflow Page

- The Workflow page is a project-level resource surface, not Access.
- The left subsidebar is an index of workflows.
- The main detail shows exactly two endpoint nodes: `Source -> Target`.
- Trigger is a small clock control before Source, not a workflow node.
- Source-specific sync policy lives inside Source.
- Target-specific write policy lives inside Target.
- Recent runs use the same dense table rhythm as Develop logs and GitHub sync
  log tables.
