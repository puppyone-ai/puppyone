# Source Control Feature

This folder owns the Desktop source-control experience.

- `types.ts` defines local UI contracts shared across the feature.
- `remotes.ts` parses, masks, and compares Git remote URLs.
- `viewModel.ts` derives source-control state from the raw Git snapshot. Keep button labels, enabled states, display modes, and remote/commit counts here instead of inside TSX views.
- `components.tsx` contains reusable Git list primitives such as section headers, preview rows, and working-tree rows.
- `SourceControlSidebar.tsx` composes the sidebar flow and wires user actions to the view model.

Keep Git command execution in the local API layer. Keep feature state derivation in `viewModel.ts`. Keep components mostly presentational so simple/professional mode, GitHub/PuppyOne remote behavior, and future sync actions can evolve without rewriting the whole sidebar.
