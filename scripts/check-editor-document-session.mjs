#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sharedEditorRoot = path.join(repoRoot, "packages/shared-ui/src/editor");
const sessionKernel = path.join(
  sharedEditorRoot,
  "document-session/DocumentEditingSession.ts",
);
const errors = [];

for (const filePath of walkTypeScript(sharedEditorRoot)) {
  const source = readFileSync(filePath, "utf8");
  if (filePath !== sessionKernel && /\b(?:this\.)?persistence\.persist\s*\(/.test(source)) {
    errors.push(`${relative(filePath)} calls a persistence adapter outside DocumentEditingSession`);
  }
}

const contributionFiles = [
  ...walkTypeScript(path.join(sharedEditorRoot, "viewers")),
  ...walkTypeScript(path.join(sharedEditorRoot, "markdown")),
];
for (const filePath of contributionFiles) {
  const source = readFileSync(filePath, "utf8");
  for (const [pattern, reason] of [
    [/\bDocumentPersistencePort\b/, "imports the storage adapter contract"],
    [/\bdocumentPersistence\b/, "receives a storage adapter"],
    [/\bonSaveContent\b/, "owns the legacy save callback"],
    [/\b(?:window\.)?setTimeout\s*\([^)]*(?:save|persist|write)/is, "owns a save timer"],
    [/\b(?:requestSave|flushCurrent|flushSnapshot|getPersistedContent|resolveExternalConflict)\b/, "controls the host save lifecycle"],
    [/\b(?:DocumentEditingSessionHandle|useDocumentSessionState)\b/, "observes the host-only session"],
  ]) {
    if (pattern.test(source)) errors.push(`${relative(filePath)} ${reason}`);
  }
}

const textFramePath = path.join(sharedEditorRoot, "viewers/shared/TextEditorFrame.tsx");
const textFrameSource = readFileSync(textFramePath, "utf8");
if (/\bsetTimeout\s*\(/.test(textFrameSource)) {
  errors.push(`${relative(textFramePath)} owns a timer; save scheduling belongs to DocumentEditingSession`);
}

const codeViewerPath = path.join(sharedEditorRoot, "viewers/code/CodeViewer.tsx");
const codeViewerSource = readFileSync(codeViewerPath, "utf8");
if (!/\bsourceSnapshotMode\b/.test(codeViewerSource)) {
  errors.push(`${relative(codeViewerPath)} does not keep canonical code source in CodeMirror snapshots`);
}
for (const callback of ["onSourceRevisionChange", "onSnapshotPortChange"]) {
  if (!new RegExp(`\\b${callback}\\b`).test(codeViewerSource)) {
    errors.push(`${relative(codeViewerPath)} does not connect ${callback} to the shared edit boundary`);
  }
}
if (/\bonChange=\{controls\.canEdit\s*\?\s*controls\.onChange/.test(codeViewerSource)) {
  errors.push(`${relative(codeViewerPath)} stringifies canonical code source through the compatibility callback`);
}

const csvViewerPath = path.join(sharedEditorRoot, "viewers/csv/CsvViewer.tsx");
const csvViewerSource = readFileSync(csvViewerPath, "utf8");
if (!/\bsourceSnapshotMode\b/.test(csvViewerSource)) {
  errors.push(`${relative(csvViewerPath)} does not keep canonical CSV source behind a snapshot port`);
}
for (const callback of ["onSourceRevisionChange", "onSnapshotPortChange"]) {
  if (!new RegExp(`\\b${callback}\\b`).test(csvViewerSource)) {
    errors.push(`${relative(csvViewerPath)} does not connect ${callback} to the shared edit boundary`);
  }
}
if (/\bonChange=\{controls\.canEdit\s*\?\s*controls\.onChange/.test(csvViewerSource)) {
  errors.push(`${relative(csvViewerPath)} serializes the complete CSV source through React on every cell edit`);
}
const csvTableEditorPath = path.join(sharedEditorRoot, "viewers/csv/CsvTableEditor.tsx");
const csvTableEditorSource = readFileSync(csvTableEditorPath, "utf8");
if (/\bstringifyDelimitedText\b/.test(csvTableEditorSource)) {
  errors.push(`${relative(csvTableEditorPath)} owns full-source serialization in the mounted projection`);
}
if (!/\buseTabularViewport\b/.test(csvTableEditorSource)) {
  errors.push(`${relative(csvTableEditorPath)} does not use the bounded tabular projection`);
}

const sessionSource = readFileSync(sessionKernel, "utf8");
if (/from\s+["'][^"']*(?:electron|localFiles|cloudDataPort|node:fs)[^"']*["']/.test(sessionSource)) {
  errors.push(`${relative(sessionKernel)} imports a storage implementation`);
}
if (!/from\s+["']\.\/autoSavePolicy["']/.test(sessionSource)) {
  errors.push(`${relative(sessionKernel)} does not delegate save timing to an auto-save policy`);
}
if (/\b(?:queueMicrotask|idleDelayMs|maxDelayMs)\b/.test(sessionSource)) {
  errors.push(`${relative(sessionKernel)} still owns auto-save timing details`);
}
if (/\b(?:normalizePersistenceResult|dirty\?:\s*boolean)\b/.test(sessionSource)) {
  errors.push(`${relative(sessionKernel)} still accepts a legacy persistence or dirty-state protocol`);
}
if (!/readSnapshot\(\),\s*this\.strongestDrainReason\(\)\s*\?\?\s*["']edit["']/.test(sessionSource)) {
  errors.push(`${relative(sessionKernel)} does not enqueue the latest editor snapshot with the edit reason`);
}

const externalAdapterPath = path.join(sharedEditorRoot, "registry/viewerHostAdapters.ts");
const externalAdapterSource = readFileSync(externalAdapterPath, "utf8");
for (const authority of ["EditableDocumentSource", "DocumentPersistencePort", "documentSession", "persistence"]) {
  if (new RegExp(`\\b${authority}\\b`).test(externalAdapterSource)) {
    errors.push(`${relative(externalAdapterPath)} exposes ${authority} to an external Viewer Pack`);
  }
}

const packTypesPath = path.join(sharedEditorRoot, "registry/viewerPackTypes.ts");
const packTypesSource = readFileSync(packTypesPath, "utf8");
if (!/export type ViewerPackFormatContribution\s*=\s*\{[\s\S]*?editable:\s*false;[\s\S]*?\};/.test(packTypesSource)) {
  errors.push(`${relative(packTypesPath)} no longer fixes Viewer Pack v1 contributions to editable: false`);
}

const sharedUiPublicIndexPath = path.join(repoRoot, "packages/shared-ui/src/index.ts");
const sharedUiPublicIndexSource = readFileSync(sharedUiPublicIndexPath, "utf8");
for (const authority of [
  "DocumentEditingSession",
  "DocumentSessionBoundary",
  "DocumentEditingSessionHandle",
  "EditableDocumentSource",
  "registerActiveDocumentSession",
  "useDocumentSessionState",
  "useEditableDocumentSource",
]) {
  if (new RegExp(`\\b${authority}\\b`).test(sharedUiPublicIndexSource)) {
    errors.push(`${relative(sharedUiPublicIndexPath)} exposes host-only ${authority}`);
  }
}

const manifestSchemaPath = path.join(repoRoot, "electron/main/viewer-packs/manifest-schema.mjs");
const manifestSchemaSource = readFileSync(manifestSchemaPath, "utf8");
if (!/formats:\s*raw\.formats\.map\([\s\S]*?editable:\s*false,/.test(manifestSchemaSource)) {
  errors.push(`${relative(manifestSchemaPath)} no longer normalizes Viewer Pack v1 to editable: false`);
}

const coreTypesPath = path.join(repoRoot, "packages/shared-ui/src/core/types.ts");
const coreTypesSource = readFileSync(coreTypesPath, "utf8");
if (/\bwriteFile\??\s*:/.test(coreTypesSource)) {
  errors.push(`${relative(coreTypesPath)} exposes the legacy direct writeFile port`);
}
if (/\b(?:idleDelayMs|maxDelayMs)\b/.test(coreTypesSource)) {
  errors.push(`${relative(coreTypesPath)} exposes delayed autosave policy to persistence adapters`);
}

const markdownSnapshotTestPath = path.join(repoRoot, "tests/markdownSourceSnapshot.test.tsx");
const markdownSnapshotTestSource = readFileSync(markdownSnapshotTestPath, "utf8");
if (!/starts frontend Markdown persistence immediately after an edit transaction/.test(markdownSnapshotTestSource)) {
  errors.push(`${relative(markdownSnapshotTestPath)} does not cover immediate frontend Markdown persistence`);
}
if (!/keeps an immediate-save failure visible and retryable in auto mode/.test(markdownSnapshotTestSource)) {
  errors.push(`${relative(markdownSnapshotTestPath)} does not cover visible immediate-save failure state`);
}

const dataWorkspacePath = path.join(repoRoot, "packages/shared-ui/src/data/DataWorkspace.tsx");
const dataWorkspaceSource = readFileSync(dataWorkspacePath, "utf8");
if (!/await onActivePathChange/.test(dataWorkspaceSource)) {
  errors.push(`${relative(dataWorkspacePath)} does not route file activation through the Editor Group`);
}
const desktopAppShellPath = path.join(repoRoot, "src/App.tsx");
const desktopAppShellSource = readFileSync(desktopAppShellPath, "utf8");
if (
  !/activateDataNode[\s\S]*isDocumentDataNode\(node\)[\s\S]*editorWorkbench\.openDocument\(node\)/.test(
    desktopAppShellSource,
  )
  || !/handleActiveDataPathChange[\s\S]*activateDataNode\(resolvedNode\)/.test(desktopAppShellSource)
) {
  errors.push(`${relative(desktopAppShellPath)} does not own Editor Group activation`);
}
if (!/DesktopWorkspaceContent[\s\S]*editorWorkbench=\{editorWorkbench\}/.test(desktopAppShellSource)) {
  errors.push(`${relative(desktopAppShellPath)} does not project the Editor Workbench into the app shell`);
}
if (!/useEditableDocumentSource\s*\(\s*\)/.test(textFrameSource)) {
  errors.push(`${relative(textFramePath)} does not use the narrow editable-source boundary`);
}
if (/\b(?:requestSave|flushCurrent|flushSnapshot|getPersistedContent|resolveExternalConflict)\b/.test(textFrameSource)) {
  errors.push(`${relative(textFramePath)} controls host persistence directly`);
}
if (
  !/!sourceSnapshotMode\s*\|\|\s*snapshotPortRef\.current/.test(textFrameSource)
  || !/editingSource\.attachSource\(fallbackSource\)/.test(textFrameSource)
) {
  errors.push(`${relative(textFramePath)} leaves projection-only editable Views without a Working Copy model port`);
}

const sourceSnapshotPath = path.join(sharedEditorRoot, "sourceSnapshot.ts");
const sourceSnapshotSource = readFileSync(sourceSnapshotPath, "utf8");
if (!/origin:\s*["']local-edit["']\s*\|\s*["']model-initialization["']/.test(sourceSnapshotSource)) {
  errors.push(`${relative(sourceSnapshotPath)} does not make local edit provenance explicit`);
}
if (/\bdirty:\s*boolean\b/.test(sourceSnapshotSource)) {
  errors.push(`${relative(sourceSnapshotPath)} lets format Views guess Working Copy dirty state`);
}
if (!/replaceContent:\s*\(content:\s*string\)\s*=>\s*EditorSourceSnapshot/.test(sourceSnapshotSource)) {
  errors.push(`${relative(sourceSnapshotPath)} does not require format-aware external replacement`);
}
for (const relativeAdapterPath of [
  "viewers/shared/TextEditorFrame.tsx",
  "viewers/code/CodeMirrorCodeEditor.tsx",
  "markdown/MarkdownCodeMirrorEditor.tsx",
  "viewers/csv/CsvTableEditor.tsx",
  "viewers/csv/CsvSourceEditor.tsx",
  "viewers/puppyflow/PuppyFlowViewer.tsx",
]) {
  const adapterPath = path.join(sharedEditorRoot, relativeAdapterPath);
  if (!/\breplaceContent\s*:/.test(readFileSync(adapterPath, "utf8"))) {
    errors.push(`${relative(adapterPath)} cannot apply an accepted external version`);
  }
  if (/\breconcileExternalBaseline\b/.test(readFileSync(adapterPath, "utf8"))) {
    errors.push(`${relative(adapterPath)} consumes storage events inside a format View`);
  }
}

const paneSourcePath = path.join(
  repoRoot,
  "src/features/editor-workbench/runtime/useEditorPaneSource.ts",
);
const paneSourceSource = readFileSync(paneSourcePath, "utf8");
if (/\bsetContent\(null\)/.test(paneSourceSource)) {
  errors.push(`${relative(paneSourcePath)} destroys stable editable content during refresh`);
}
if (!/workspaceContentChangeMatchesResource\(\s*refreshKey,\s*nodePath,\s*previousRefreshSequence\s*\)/.test(paneSourceSource)) {
  errors.push(`${relative(paneSourcePath)} does not scope external refreshes by resource identity`);
}

const workspaceWatchPath = path.join(repoRoot, "electron/main/workspace-watch-service.mjs");
const workspaceWatchSource = readFileSync(workspaceWatchPath, "utf8");
if (!/pendingPaths:\s*new Set\(\)/.test(workspaceWatchSource) || !/paths:\s*visiblePaths/.test(workspaceWatchSource)) {
  errors.push(`${relative(workspaceWatchPath)} drops resource paths while debouncing workspace events`);
}

const workbenchWatchPath = path.join(
  repoRoot,
  "src/features/data-workspace/useWorkbenchWorkspaceContentWatch.ts",
);
const workbenchWatchSource = readFileSync(workbenchWatchPath, "utf8");
if (
  !/for \(const folder of folders\)/.test(workbenchWatchSource)
  || !/bridge\.watchWorkspace\(folder\.workspace\.path/.test(workbenchWatchSource)
  || !/onWorkspaceContentChanged\([^,]+,\s*folder\.id\)/s.test(workbenchWatchSource)
) {
  errors.push(`${relative(workbenchWatchPath)} does not centrally own every Workspace Folder watch with root identity`);
}

const gitLifecyclePath = path.join(
  repoRoot,
  "src/features/source-control/useGitRepositoryLifecycle.ts",
);
if (/\bwatchWorkspace\b/.test(readFileSync(gitLifecyclePath, "utf8"))) {
  errors.push(`${relative(gitLifecyclePath)} reabsorbed filesystem watching into Git lifecycle`);
}

const workbenchChangeAdapterPath = path.join(
  repoRoot,
  "src/features/data-workspace/workbenchWorkspaceContentChange.ts",
);
const workbenchChangeAdapterSource = readFileSync(workbenchChangeAdapterPath, "utf8");
if (
  !/appendWorkspaceContentChange/.test(workbenchChangeAdapterSource)
  || !/workspaceFolderId/.test(workbenchChangeAdapterSource)
  || !/paths:\s*scoped\s*\?\s*mutation\.paths\s*:\s*null/.test(workbenchChangeAdapterSource)
) {
  errors.push(`${relative(workbenchChangeAdapterPath)} does not fail closed at the Folder-to-Resource identity boundary`);
}

for (const featureDirectory of ["desktop-agent", "desktop-terminal"]) {
  const featureRoot = path.join(repoRoot, "src/features", featureDirectory);
  for (const filePath of walkTypeScript(featureRoot)) {
    const source = readFileSync(filePath, "utf8");
    if (/\b(?:appendWorkspaceContentChange|createWorkspaceContentChange|workspaceRefreshToken)\b/.test(source)) {
      errors.push(`${relative(filePath)} bypasses the filesystem-owned Workbench mutation pipeline`);
    }
  }
}
for (const runtimeDirectory of ["agent", "terminal-agent"]) {
  const runtimeRoot = path.join(repoRoot, "electron/main", runtimeDirectory);
  for (const filePath of walkSourceFiles(runtimeRoot)) {
    if (/workspace:changed/.test(readFileSync(filePath, "utf8"))) {
      errors.push(`${relative(filePath)} spoofs committed filesystem state from a provider/tool event`);
    }
  }
}

if (
  !/type DocumentPersistenceSuccess\s*=\s*Readonly<\{[\s\S]*?ok:\s*true/.test(coreTypesSource)
  || !/type DocumentPersistenceConflict\s*=\s*Readonly<\{[\s\S]*?kind:\s*["']conflict["']/.test(coreTypesSource)
) {
  errors.push(`${relative(coreTypesPath)} does not model conditional-write outcomes as data`);
}

const puppyFlowContributionPath = path.join(
  sharedEditorRoot,
  "viewers/puppyflow/contribution.ts",
);
const puppyFlowContributionSource = readFileSync(puppyFlowContributionPath, "utf8");
if (!/id:\s*["']puppyflow["'][\s\S]*?import\(["']\.\/PuppyFlowViewer["']\)/.test(puppyFlowContributionSource)) {
  errors.push(`${relative(puppyFlowContributionPath)} does not route PuppyFlow through its format-owned contribution`);
}

const viewerRegistryPath = path.join(sharedEditorRoot, "registry/viewerRegistry.tsx");
const viewerRegistrySource = readFileSync(viewerRegistryPath, "utf8");
if (/from\s+["']\.\.\/(?:markdown|viewers)\//.test(viewerRegistrySource)) {
  errors.push(`${relative(viewerRegistryPath)} imports a concrete Viewer instead of composing format-owned contributions`);
}

if (
  !/storageIdentity:\s*DocumentStorageIdentity/.test(coreTypesSource)
  || !/createDocumentIdentity\(options\.persistence,\s*options\.documentId\)/.test(
    readFileSync(path.join(sharedEditorRoot, "document-session/documentWorkingCopies.ts"), "utf8"),
  )
) {
  errors.push("Document Working Copies are not keyed by stable storage identity and canonical resource path");
}

const documentIdentityPath = path.join(
  sharedEditorRoot,
  "document-session/documentIdentity.ts",
);
const documentIdentitySource = readFileSync(documentIdentityPath, "utf8");
if (
  !/CanonicalResourcePath\s*\|\s*ResourceUri/.test(documentIdentitySource)
  || !/isDataResourceUri\(resourcePath\)[\s\S]*?canonicalizeResourceUri\(resourcePath\)[\s\S]*?canonicalizeResourcePath\(resourcePath\)/.test(
    documentIdentitySource,
  )
) {
  errors.push(`${relative(documentIdentityPath)} does not preserve URI identity before path canonicalization`);
}

const resourcePathPath = path.join(repoRoot, "packages/shared-ui/src/core/resourcePath.ts");
const resourcePathSource = readFileSync(resourcePathPath, "utf8");
if (!/if\s*\(looksLikeResourceUri\(path\)\)[\s\S]*?throw new TypeError/.test(resourcePathSource)) {
  errors.push(`${relative(resourcePathPath)} does not fail closed when a Resource URI reaches a provider-path normalizer`);
}

const dataResourcePathPath = path.join(repoRoot, "packages/shared-ui/src/core/dataResourcePath.ts");
const dataResourcePathSource = readFileSync(dataResourcePathPath, "utf8");
if (
  !/function assertValidDataResourceReference/.test(dataResourcePathSource)
  || !/assertValidDataResourceReference\(value\)/.test(dataResourcePathSource)
) {
  errors.push(`${relative(dataResourcePathPath)} does not reject malformed Resource URIs at mixed data boundaries`);
}

const workbenchDataPortPath = path.join(
  repoRoot,
  "src/features/data-workspace/workbenchDataPort.ts",
);
const workbenchDataPortSource = readFileSync(workbenchDataPortPath, "utf8");
if (!/if\s*\(!resourceIsUri\)\s*assertValidDataResourceReference\(path\)/.test(workbenchDataPortSource)) {
  errors.push(`${relative(workbenchDataPortPath)} can route a malformed Resource URI through the legacy first-Folder fallback`);
}
if (
  !/workbench\.folders\.length\s*!==\s*1[\s\S]*?provider-relative path is ambiguous[\s\S]*?Use a Resource URI/.test(
    workbenchDataPortSource,
  )
) {
  errors.push(`${relative(workbenchDataPortPath)} does not fail closed on an unqualified multi-Folder path`);
}

const workbenchWorkspacePath = path.join(
  repoRoot,
  "packages/shared-ui/src/core/workbenchWorkspace.ts",
);
const workbenchWorkspaceSource = readFileSync(workbenchWorkspacePath, "utf8");
if (
  /id:\s*`single:\$\{[^}]+\}`/.test(workbenchWorkspaceSource)
  || !/options\.id\s*\?\?\s*createTransientWorkbenchWorkspaceId\(\)/.test(workbenchWorkspaceSource)
) {
  errors.push(`${relative(workbenchWorkspacePath)} derives Workbench identity from an ordered Folder`);
}

const workspaceLifecyclePath = path.join(
  repoRoot,
  "src/features/app-shell/useWorkspaceLifecycle.ts",
);
const workspaceLifecycleSource = readFileSync(workspaceLifecyclePath, "utf8");
if (
  /context\.getWorkspace\(\)\.folders\[0\].*nextFolders\[0\]/s.test(workspaceLifecycleSource)
  || !/context\.getWorkspace\(\)\.id\s*!==\s*workbenchWorkspaceId/.test(workspaceLifecycleSource)
) {
  errors.push(`${relative(workspaceLifecyclePath)} recreates a Workbench when the primary Folder changes`);
}

// The multi-Folder experiment is a shell affordance gate, never a data-model or
// persistence-kernel selector. Keep flag-state branches out of every identity,
// editor, provider-routing, and local persistence boundary.
const multiRootFeatureGatePattern = /\b(?:enableMultiRootWorkspaces|multiRootWorkspacesEnabled)\b/;
const featureIndependentWorkspaceKernelFiles = [
  ...walkTypeScript(path.join(repoRoot, "packages/shared-ui/src/core")),
  ...walkTypeScript(path.join(repoRoot, "packages/shared-ui/src/editor")),
  ...walkTypeScript(path.join(repoRoot, "src/features/data-workspace")),
  ...walkTypeScript(path.join(repoRoot, "src/features/editor-workbench")),
  path.join(repoRoot, "src/lib/localFiles.ts"),
  path.join(repoRoot, "electron/main/window-workspace-composition.mjs"),
  path.join(repoRoot, "electron/main/workspace-state-store.mjs"),
  path.join(repoRoot, "local-api/files/path-policy.mjs"),
];
for (const filePath of featureIndependentWorkspaceKernelFiles) {
  if (multiRootFeatureGatePattern.test(readFileSync(filePath, "utf8"))) {
    errors.push(`${relative(filePath)} lets the multi-Folder experiment select Workspace identity or persistence behavior`);
  }
}

const workspaceFeatureMatrixTestPath = path.join(
  repoRoot,
  "tests/workspaceLifecycleExperiment.test.tsx",
);
const workspaceFeatureMatrixTestSource = readFileSync(workspaceFeatureMatrixTestPath, "utf8");
for (const requiredContract of [
  "runs the P0 save kernel identically with the multi-project experiment",
  "preserves the active Workbench composition while the experiment toggles at runtime",
  "preserves Workbench identity when the primary Folder is detached",
  "getOrCreateDocumentWorkingCopy",
  "legacy notes/README.md",
  "docs with space/群群.md",
  "puppyone-local:/workspace/",
]) {
  if (!workspaceFeatureMatrixTestSource.includes(requiredContract)) {
    errors.push(`${relative(workspaceFeatureMatrixTestPath)} does not enforce: ${requiredContract}`);
  }
}

const featureCompositionAppPath = path.join(repoRoot, "src/App.tsx");
const featureCompositionAppSource = readFileSync(featureCompositionAppPath, "utf8");
const desktopAppFeatureCompositionStart = featureCompositionAppSource.indexOf("const workbenchDataService = useMemo(");
const desktopAppFeatureCompositionEnd = featureCompositionAppSource.indexOf(
  "const dataPort = useMemo(",
  desktopAppFeatureCompositionStart,
);
const desktopAppFeatureComposition = desktopAppFeatureCompositionStart >= 0
  && desktopAppFeatureCompositionEnd > desktopAppFeatureCompositionStart
  ? featureCompositionAppSource.slice(desktopAppFeatureCompositionStart, desktopAppFeatureCompositionEnd)
  : "";
if (
  !desktopAppFeatureComposition.includes("createWorkbenchDataService(workbenchWorkspace)")
  || !desktopAppFeatureComposition.includes("[workbenchWorkspace]")
  || multiRootFeatureGatePattern.test(desktopAppFeatureComposition)
) {
  errors.push(`${relative(featureCompositionAppPath)} lets the multi-Folder experiment replace or disable the Workbench data kernel`);
}

const multiRootPersistenceTestPath = path.join(
  repoRoot,
  "tests/multiRootDocumentPersistence.integration.test.ts",
);
const multiRootPersistenceTestSource = readFileSync(multiRootPersistenceTestPath, "utf8");
for (const requiredContract of [
  "retains one dirty Working Copy when the primary Folder is detached",
  "persists and reopens same-named documents in two real Workspace roots without crossing providers",
  "docs with space/群群.md",
  "getOrCreateDocumentWorkingCopy",
  "createWorkbenchDataService",
  "saveMode: \"auto\"",
  "saveMode: \"manual\"",
]) {
  if (!multiRootPersistenceTestSource.includes(requiredContract)) {
    errors.push(`${relative(multiRootPersistenceTestPath)} does not enforce: ${requiredContract}`);
  }
}
const workbenchDataPortTestPath = path.join(repoRoot, "tests/workbenchDataPort.test.ts");
if (!/rejects a malformed Resource URI before any Folder provider can write/.test(
  readFileSync(workbenchDataPortTestPath, "utf8"),
)) {
  errors.push(`${relative(workbenchDataPortTestPath)} does not cover fail-closed malformed URI routing`);
}
if (!/rejects ambiguous provider paths/.test(readFileSync(workbenchDataPortTestPath, "utf8"))) {
  errors.push(`${relative(workbenchDataPortTestPath)} does not cover fail-closed multi-Folder relative paths`);
}
const localFilesPath = path.join(repoRoot, "src/lib/localFiles.ts");
const localFilesSource = readFileSync(localFilesPath, "utf8");
if (!/documentPersistence:[\s\S]*?path:\s*canonicalizeResourcePath\(path\)/.test(localFilesSource)) {
  errors.push(`${relative(localFilesPath)} does not validate provider-relative paths before local persistence IPC`);
}
if (/"conflict"|ExternalConflictResolution/.test(readFileSync(path.join(sharedEditorRoot, "document-session/types.ts"), "utf8"))) {
  errors.push("Document Session must adopt disk updates without a user-facing conflict state");
}
if (!/readDocumentStorageSnapshot/.test(paneSourceSource) || !/readDocumentStorageSnapshot/.test(dataWorkspaceSource)) {
  errors.push("Editable document reads must share storage observation ordering");
}

const resourceLeasePath = path.join(sharedEditorRoot, "resource/useFileResourceLease.ts");
const paneSourceSourceForLease = readFileSync(paneSourcePath, "utf8");
if (
  !/workspaceContentChangeMatchesResource/.test(readFileSync(resourceLeasePath, "utf8"))
  || !/useFileResourceLease/.test(paneSourceSourceForLease)
) {
  errors.push("Editor resources do not use the shared identity-scoped resource lease");
}

const desktopWorkspaceContentPath = path.join(repoRoot, "src/features/app-shell/DesktopWorkspaceContent.tsx");
const desktopWorkspaceContentSource = readFileSync(desktopWorkspaceContentPath, "utf8");
if (/\b(?:PuppyFlowEditor|renderPreviewBody|DocumentSessionBoundary)\b/.test(desktopWorkspaceContentSource)) {
  errors.push(`${relative(desktopWorkspaceContentPath)} still special-cases a built-in editor outside the contribution router`);
}

const desktopAppPath = path.join(repoRoot, "src/App.tsx");
const desktopAppSource = readFileSync(desktopAppPath, "utf8");
if (
  !/find\(\(editor\)\s*=>\s*editor\.id\s*===\s*editorId\)\?\.resource/.test(desktopAppSource)
  || !/closeDocumentWorkingCopy\(\{[\s\S]*?storageIdentity:\s*documentStorageIdentity,[\s\S]*?resourcePath,[\s\S]*?\}\)/.test(desktopAppSource)
) {
  errors.push(`${relative(desktopAppPath)} does not close the targeted document Working Copy with its Input`);
}
if (!/closeAllDocumentWorkingCopies\("workspace-switch"\)/.test(desktopAppSource)) {
  errors.push(`${relative(desktopAppPath)} does not close all Working Copies before workspace navigation`);
}

const editorGroupModelPath = path.join(sharedEditorRoot, "workbench/editorGroupModel.ts");
const editorGroupModelSource = readFileSync(editorGroupModelPath, "utf8");
const editorPaneLayoutModelPath = path.join(sharedEditorRoot, "workbench/editorPaneLayoutModel.ts");
const editorPaneLayoutModelSource = readFileSync(editorPaneLayoutModelPath, "utf8");
for (const [filePath, source] of [
  [editorGroupModelPath, editorGroupModelSource],
  [editorPaneLayoutModelPath, editorPaneLayoutModelSource],
]) {
  if (/\b(?:DocumentPersistencePort|EditableDocumentSource|FileContent|DataPort)\b/.test(source)) {
    errors.push(`${relative(filePath)} crosses from editor placement metadata into document content or persistence`);
  }
}
if (!/canonicalizeResourcePath/.test(editorGroupModelSource)) {
  errors.push(`${relative(editorGroupModelPath)} does not canonicalize resource identity at the Open Editor boundary`);
}
if (!/rebaseResourcePath/.test(editorPaneLayoutModelSource)) {
  errors.push(`${relative(editorPaneLayoutModelPath)} does not keep Pane editor references aligned with resource moves`);
}
const workbenchPersistencePath = path.join(
  repoRoot,
  "src/features/editor-workbench/persistence/editorWorkbenchPersistence.ts",
);
const workbenchPersistenceSource = readFileSync(workbenchPersistencePath, "utf8");
if (/\b(?:persistedContent|DocumentPersistencePort|EditableDocumentSource)\b/.test(workbenchPersistenceSource)) {
  errors.push(`${relative(workbenchPersistencePath)} persists document authority instead of layout metadata only`);
}

const localMarkdownPersistenceTestPath = path.join(
  repoRoot,
  "tests/localMarkdownEditorPersistence.test.tsx",
);
const localMarkdownPersistenceTestSource = readFileSync(localMarkdownPersistenceTestPath, "utf8");
if (!/persists a real CodeMirror edit through DataWorkspace and the local desktop bridge/.test(localMarkdownPersistenceTestSource)) {
  errors.push(`${relative(localMarkdownPersistenceTestPath)} does not cover the complete local Markdown write path`);
}
if (!/keeps failed local edits in their Working Copy across editor navigation/.test(localMarkdownPersistenceTestSource)) {
  errors.push(`${relative(localMarkdownPersistenceTestPath)} does not cover failed Working Copy persistence across navigation`);
}

const localCsvPersistenceTestPath = path.join(
  repoRoot,
  "tests/localCsvEditorPersistence.test.tsx",
);
const localCsvPersistenceTestSource = readFileSync(localCsvPersistenceTestPath, "utf8");
if (!/edits a spreadsheet-classified CSV and persists its serialized snapshot/.test(localCsvPersistenceTestSource)) {
  errors.push(`${relative(localCsvPersistenceTestPath)} does not cover the complete local CSV write path`);
}

const externalConsistencyMatrixTestPath = path.join(
  repoRoot,
  "tests/editorExternalConsistencyMatrix.integration.test.tsx",
);
const externalConsistencyMatrixTestSource = readFileSync(
  externalConsistencyMatrixTestPath,
  "utf8",
);
for (const requiredContract of [
  "requires every editable preset Viewer family to have a P0 consistency fixture",
  "adopts a clean Agent update in the open Pane with zero writeback",
  "restores the Agent version after the complete Pane tree remounts without saving",
  "adopts disk updates over dirty local content without a conflict prompt",
  "saves subsequent edits against the adopted disk version",
  "updates different format Panes from one watcher batch without cross-reading or writeback",
  "discards an obsolete read that resolves after a newer matching watcher event",
]) {
  if (!externalConsistencyMatrixTestSource.includes(requiredContract)) {
    errors.push(`${relative(externalConsistencyMatrixTestPath)} does not enforce: ${requiredContract}`);
  }
}
if (
  !/PRESET_VIEWERS[\s\S]*capability\s*===\s*["']edit["']/.test(externalConsistencyMatrixTestSource)
  || !/FORMAT_CASES\.map\(\(\{\s*viewerId\s*\}\)\s*=>\s*viewerId\)/.test(externalConsistencyMatrixTestSource)
) {
  errors.push(`${relative(externalConsistencyMatrixTestPath)} does not fail when an editable Viewer lacks P0 matrix coverage`);
}

const closeDrainSources = [
  {
    filePath: path.join(sharedEditorRoot, "document-session/activeDocumentSessions.ts"),
    pattern: /registration\.tokens\.size\s*>\s*0[\s\S]*session\.dispose\(\)[\s\S]*session\.flushCurrent\("destroy"\)/,
    reason: "does not defer disposal until real retirement or retain the retiring session for app-close draining",
  },
  {
    filePath: path.join(repoRoot, "src/main.tsx"),
    pattern: /onDocumentSessionFlushRequested[\s\S]*setCloseInteractionBarrier\(true\)[\s\S]*flushActiveDocumentSessions[\s\S]*onDocumentSessionCloseCancelled[\s\S]*setCloseInteractionBarrier\(false\)/,
    reason: "does not bridge Electron close requests through an interaction barrier to the active session registry",
  },
  {
    filePath: path.join(repoRoot, "electron/preload.cjs"),
    pattern: /^(?=[\s\S]*document-session:flush-requested)(?=[\s\S]*document-session:flush-result)(?=[\s\S]*document-session:close-cancelled)/,
    reason: "does not expose the narrow close-drain handshake",
  },
  {
    filePath: path.join(repoRoot, "electron/main.mjs"),
    pattern: /documentSessionCloseCoordinator\.attachWindow\s*\(\s*window\s*\)/,
    reason: "does not gate BrowserWindow close on Document Session drain",
  },
  {
    filePath: path.join(repoRoot, "electron/main.mjs"),
    pattern: /app\.on\("will-quit",[\s\S]*cloudAuthService\.dispose\(\)[\s\S]*app\.on\("before-quit"/,
    reason: "disposes Cloud persistence dependencies before document close draining",
  },
  {
    filePath: path.join(repoRoot, "electron/main.mjs"),
    pattern: /onCloseCancelled:\s*applicationQuitIntent\.cancel[\s\S]*window-all-closed[\s\S]*applicationQuitIntent\.resumeAfterLastWindowClosed/,
    reason: "does not preserve and cancel app-quit intent across the asynchronous close gate",
  },
];
for (const { filePath, pattern, reason } of closeDrainSources) {
  if (!pattern.test(readFileSync(filePath, "utf8"))) {
    errors.push(`${relative(filePath)} ${reason}`);
  }
}

const documentSessionBoundaryPath = path.join(
  sharedEditorRoot,
  "document-session/DocumentSessionBoundary.tsx",
);
const documentSessionBoundarySource = readFileSync(documentSessionBoundaryPath, "utf8");
if (/session\.dispose\(\)/.test(documentSessionBoundarySource)) {
  errors.push(
    `${relative(documentSessionBoundaryPath)} permanently disposes a live Session during React StrictMode's cleanup/setup probe`,
  );
}

if (errors.length > 0) {
  console.error("Document Session architecture boundary check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Document Session architecture boundary check passed.");

function* walkTypeScript(directory) {
  for (const entry of readdirSync(directory)) {
    const filePath = path.join(directory, entry);
    const stats = statSync(filePath);
    if (stats.isDirectory()) yield* walkTypeScript(filePath);
    else if (/\.tsx?$/.test(filePath)) yield filePath;
  }
}

function* walkSourceFiles(directory) {
  for (const entry of readdirSync(directory)) {
    const filePath = path.join(directory, entry);
    const stats = statSync(filePath);
    if (stats.isDirectory()) yield* walkSourceFiles(filePath);
    else if (/\.(?:[cm]?js|tsx?)$/.test(filePath)) yield filePath;
  }
}

function relative(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, "/");
}
