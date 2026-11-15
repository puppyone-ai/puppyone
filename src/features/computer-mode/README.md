# Computer Mode (`enableComputerMode`)

Experimental presentation that shifts PuppyOne's entity mental model from folders to miniature computers (Cloud Computers + Computers on this Mac/PC), while keeping the inner Workbench unchanged.

## Gate & Ownership

- **Preference key**: `ExperimentalSettings.enableComputerMode` (`default: false`).
- **Decision hook**: `useComputerModeEnabled()` in `src/features/flags/index.tsx`.
- **Main-process lifecycle**: `electron/main/local-computers/` persists registered on-device computers in `<userData>/local-computers/registry.v1.json` (never inside `PuppyoneWorkspaceConfig`) and suspends running computer instances automatically when `enableComputerMode` is turned off or when the app exits.

## Fork Points

1. **Homepage (`MinimalOnboarding.tsx` / `OnboardingEntryActions.tsx` / `OnboardingProjectList.tsx`)**:
   - Primary entry becomes **New computer** (`onboarding.computerMode.createAction`).
   - Group hierarchy reverses to:
     1. Cloud Spaces (`<ProjectComputerGlyph kind="cloud" />`),
     2. Computers on this computer (`<ProjectComputerGlyph kind="on-device" />`),
     3. Plain folders (`<MutedLocalFoldersSection />`), muted and collapsible at the bottom.
2. **Creation Dialog (`ProjectEntryFlow.tsx` -> `ComputerModeEntryDialog.tsx`)**:
   - Offers two cards: **Cloud Computer** vs **On this computer**.
3. **Workbench Screen (`DesktopCloudFileWorkspace.tsx` & `DesktopLocalComputerWorkspace.tsx`)**:
   - Reuses `<CloudScreenThumbnail />` in the Explorer footer (`sidebarCompanion`) and displays either `CloudScreenView` or `LocalComputerScreenView` in `providerStateContent` without altering Explorer, editors, or Git.

## Retirement / Promotion Plan

- **If retired**: Delete `src/features/computer-mode/`, `electron/main/local-computers/`, `electron/main/ipc/local-computer-ipc.mjs`, and remove the `useComputerModeEnabled()` branches in Homepage, `ProjectEntryFlow`, and `DesktopWorkspaceContent`. Existing workspace directories remain intact on disk as ordinary folders.
- **If promoted**: Remove `enableComputerMode` from `ExperimentalSettingsView.tsx` and collapse the default Homepage/Entry paths onto the computer presentation.
