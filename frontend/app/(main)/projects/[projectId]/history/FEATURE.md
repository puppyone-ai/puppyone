# Changes / History Feature

## Route Ownership

- `/changes` is the product entry for committed work review.
- `/history` currently shares the same implementation for compatibility.
- The route page should stay a controller shell: fetch history, own page-level filters, and pass state into focused components.

## File Structure Target

- `page.tsx`: route shell, data fetch, selection state, layout composition.
- `components/HistoryTimeline.tsx`: left timeline list and history section controls.
- `components/HistoryCommitRow.tsx`: one commit row only.
- `components/HistoryDetailViewport.tsx`: right pane scroll and transition behavior.
- `components/CommitDetail.tsx`: selected commit summary and changed files.
- `components/FileDiffBlock.tsx`: per-file diff fetching and rendering.
- `components/HistoryFilters.tsx`: scope/user filter menu.
- `lib/diff.ts`: line diff, line numbering, and compacting.
- `lib/format.ts`: commit time, operator, and scope labels.
- `hooks/useHistorySelection.ts`: commit vs needs-action selection rules.

## Selection Rules

- Commit detail and Needs action detail are mutually exclusive.
- Auto-select HEAD only when no Needs action item is active.
- Filtering may move the active commit only if the current commit is no longer visible.
- Clicking a commit should update the timeline highlight immediately and render the matching detail without also changing unrelated sidebar state.

## Detail Pane Rules

- The right pane owns its own scroll container.
- The right pane must keep a persistent vertical scroll container with a stable gutter, not `overflow-y: auto`; commit switches must not shift content width when one commit scrolls and another does not.
- Switching commits or Needs action items resets the detail scroll position to the top before paint; use a layout effect, not a post-paint effect.
- Detail transitions should be short and local to the right pane; they must not animate layout geometry such as vertical translate, because that can create a one-frame scrollbar flash.
- The detail scroll container disables scroll anchoring so async diff loading does not pull the viewport after selection changes.
- The timeline should not remount or visually jump when the right detail changes.
- Diff loading belongs inside each file diff block, not as a whole-page replacement.

## Interaction Feel

- History rows should have stable height and stable keys.
- Selection highlight should move instantly; content can use a subtle 120-150ms enter transition.
- Row hover/selection should not trigger layout changes.
- Timeline expand/collapse controls use a plus/minus marker, not an unlabeled dot.
