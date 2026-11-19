# Incoming Changes Experience

This folder owns the remaining opt-in presentation of incoming Git work. The
stored key `enableProjectReach` is retained for preference compatibility; it no
longer enables sharing, Header readers, invitations or a Cloud services Hub.

The canonical contract lives in puppy-issues
`document/puppyone-desktop/platform/experimental-path-forks.md`.

## Fork convention

`useProjectReachExperience()` remains the only reader of the stored flag. Only
`App.tsx` (the local-work Header status) and `SourceControlSidebar.tsx` (incoming
review) choose between presentations. Both paths consume the same Git facts.
The declared entries and presentation homes are enforced by
`scripts/check-project-reach-gate.mjs`.

## Retirement

The Share and Header-reach branches are retired, not hidden behind a switch.
Only the separate incoming-changes review comparison remains. Do not restore
sharing to this flag. When that comparison is accepted, remove the old Git
presentation, preference, settings row, hook and gate together in a dedicated
change; retiring Share does not silently change this unrelated Git behavior.
