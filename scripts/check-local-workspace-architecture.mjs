#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

const publishContract = JSON.parse(read("contracts/cloud-project-publish-v1.json"));
if (
  publishContract.contract !== "puppyone.cloud-project-publish"
  || publishContract.version !== 1
  || publishContract.identity?.local_binding !== false
  || publishContract.identity?.device_registration !== false
  || publishContract.identity?.repository_target !== "project_root"
  || publishContract.operations?.create_empty_project?.additional_properties !== false
  || publishContract.operations?.issue_project_root_credential?.response_echoes_credential !== false
  || publishContract.operations?.abandon_empty_initialization?.server_confirmation_precedes_local_cleanup !== true
  || publishContract.git?.network_target_source !== "journaled canonical remote URL"
  || publishContract.git?.force_push !== false
) {
  errors.push("the cross-repository Cloud Project publish contract is incomplete or incompatible");
}

const workspaceFacade = read("local-api/workspace.mjs");

const requiredBoundaries = [
  {
    path: "local-api/files/path-policy.mjs",
    exports: ["normalizeRelativePath", "resolveExistingWorkspacePath", "resolveWorkspacePath"],
  },
  {
    path: "local-api/files/file-format-policy.mjs",
    exports: ["classifyLocalFile", "getMimeType", "isLocalFilePreviewable", "resolveCopyNameExtension"],
  },
  {
    path: "local-api/git/source-control-model.mjs",
    exports: ["buildGitSourceControlSnapshot", "gitStatusLabelToLetter", "uniqueGitPaths"],
  },
  {
    path: "local-api/git/cloud-remote.mjs",
    exports: ["createWorkspaceCloudRemoteActions"],
  },
  {
    path: "local-api/git/sync-config.mjs",
    exports: ["readGitBranchBinding", "readGitPullPolicyArgs", "readOptionalGitConfig"],
  },
  {
    path: "local-api/git/sync-target.mjs",
    exports: ["createGitSyncTargetPolicy", "normalizeCurrentBranchName", "splitRemoteBranchName"],
  },
  {
    path: "local-api/workspace-config.mjs",
    exports: ["readPuppyoneWorkspaceConfig", "writePuppyoneWorkspaceConfig"],
  },
];

for (const boundary of requiredBoundaries) {
  const source = read(boundary.path);
  for (const exportName of boundary.exports) {
    if (!new RegExp(`export (?:async )?function ${exportName}\\b`).test(source)) {
      errors.push(`${boundary.path} must own the ${exportName} implementation`);
    }
  }
}

const retiredFacadeImplementations = [
  "function normalizeRelativePath",
  "function resolveExistingWorkspacePath",
  "function resolveWorkspacePath",
  "function loadFileFormatRegistry",
  "function buildGitSourceControlSnapshot",
  "async function configureWorkspaceCloudRemote",
  "async function removeWorkspaceGitRemote",
  "function chooseGitSyncTarget",
  "function choosePuppyoneRemoteName",
  "function getConfiguredSyncBranch",
  "async function readGitBranchBinding",
  "async function readGitPullPolicyArgs",
  "function hasEffectivePuppyoneHostingTarget",
  "function normalizePuppyoneWorkspaceConfig",
  "const mimeTypeByExtension",
  "const GIT_RESOURCE_GROUPS",
  "const PUPPYONE_CONFIG_FILE",
];
for (const retiredImplementation of retiredFacadeImplementations) {
  if (workspaceFacade.includes(retiredImplementation)) {
    errors.push(`local-api/workspace.mjs reabsorbed ${retiredImplementation}`);
  }
}

for (const requiredImport of [
  'from "./files/file-format-policy.mjs"',
  'from "./files/path-policy.mjs"',
  'from "./git/source-control-model.mjs"',
  'from "./git/cloud-remote.mjs"',
  'from "./git/sync-target.mjs"',
  'from "./git/sync-config.mjs"',
  'from "./workspace-config.mjs"',
]) {
  if (!workspaceFacade.includes(requiredImport)) {
    errors.push(`local-api/workspace.mjs must delegate through ${requiredImport}`);
  }
}

const localApiFiles = [
  "local-api/workspace.mjs",
  ...requiredBoundaries.map(({ path: boundaryPath }) => boundaryPath),
];
for (const relativePath of localApiFiles) {
  const source = read(relativePath);
  if (/from\s+["'](?:\.\.\/)+(?:src|electron)\//.test(source)) {
    errors.push(`${relativePath} must not depend on renderer or Electron host internals`);
  }
}

const formatPolicy = read("local-api/files/file-format-policy.mjs");
if (!formatPolicy.includes("packages/shared-ui/src/core/fileFormats.json")) {
  errors.push("the local file-format policy must consume the canonical Shared UI registry");
}

const pathPolicy = read("local-api/files/path-policy.mjs");
if (
  !/RESOURCE_URI_LIKE_PATTERN/.test(pathPolicy)
  || !/Workspace paths must be provider-relative, not Resource URIs/.test(pathPolicy)
) {
  errors.push("the local filesystem boundary must fail closed when it receives a Resource URI");
}

const contextualCloudData = read("src/features/cloud/data/useDesktopCloudData.ts");
const contextualCloudRouter = read("src/features/cloud/routes/CloudRouter.tsx");
const contextualCloudStates = read("src/features/cloud/initialization/CloudInitializationView.tsx");
const contextualCloudResolver = read("src/features/cloud/project/context/useCurrentRepositoryCloudContext.ts");
const contextualProjectContext = read("src/features/cloud/project/context/projectCloudContext.ts");
const contextualWorkspaceSurface = read("src/features/app-shell/workspace-surfaces/useWorkspaceSurfaceContent.tsx");
const desktopApp = read("src/App.tsx");

if (contextualCloudData.includes("listCloudProjects")) {
  errors.push("contextual Cloud data must never enumerate the Organization Project catalog");
}
if (contextualCloudRouter.includes("CloudProjectBrowser")) {
  errors.push("the Local workspace Cloud router must not render the global Project browser");
}
for (const forbiddenLocalOnlyToken of ["CloudProjectRow", "onCopyCloneCommand"]) {
  if (contextualCloudStates.includes(forbiddenLocalOnlyToken)) {
    errors.push(`the Local-only Cloud state reintroduced ${forbiddenLocalOnlyToken}`);
  }
}
if (
  !contextualCloudResolver.includes("resolveCanonicalPuppyoneRemotes")
  || !contextualCloudResolver.includes("getCloudRepositoryContext")
) {
  errors.push("the Local workspace resolver must parse canonical Git locally and authorize its Project target");
}
if (
  !contextualCloudResolver.includes("createWorkspaceCloudResolutionKey")
  || !contextualCloudResolver.includes("snapshotRef")
  || !contextualCloudResolver.includes("contextMatchesRemote")
) {
  errors.push("contextual Cloud results must be keyed to the active workspace/account/host/locator snapshot");
}
if (contextualCloudResolver.includes("setHomeCloudProjects")) {
  errors.push("contextual Project resolution must not mutate the global/home Project catalog");
}
for (const obsoleteSelectionToken of [
  "selectedProjectId",
  "selectedProjectCapabilities",
  "onBackToCloudProjects",
]) {
  if (contextualWorkspaceSurface.includes(obsoleteSelectionToken) || desktopApp.includes(obsoleteSelectionToken)) {
    errors.push(`Local workspace composition reintroduced transient catalog state: ${obsoleteSelectionToken}`);
  }
}
if (desktopApp.includes("browseProjectCatalogOnCloudEntry")) {
  errors.push("entering Cloud from a Local workspace must not trigger catalog browsing");
}

const cloudIdentitySources = [
  contextualCloudResolver,
  contextualProjectContext,
  read("src/features/cloud/workspace/cloudProjectResolution.ts"),
  read("src/lib/cloudApi.ts"),
  desktopApp,
];
for (const forbiddenIdentityToken of [
  "WorkspaceBinding",
  "workspaceBinding",
  "workspace_binding",
  "cloudBinding",
  "bindingId",
  "ProjectCloudAttachment",
]) {
  if (cloudIdentitySources.some((source) => source.includes(forbiddenIdentityToken))) {
    errors.push(`Cloud repository identity reintroduced ${forbiddenIdentityToken}`);
  }
}
if (/resolveLegacyCloudRepositoryRemote|remote_url|resolve-legacy-remote/.test(read("src/lib/cloudApi.ts"))) {
  errors.push("Cloud context APIs must accept Project targets, never local remote URLs or legacy credentials");
}

const publishCoordinator = read("electron/main/cloud-initialization/coordinator.mjs");
for (const requiredModule of [
  'from "../cloud-publish-api.mjs"',
  'from "./contract.mjs"',
  'from "../cloud-publish-git.mjs"',
]) {
  if (!publishCoordinator.includes(requiredModule)) {
    errors.push(`the publish coordinator must delegate through ${requiredModule}`);
  }
}
const publishStateDerivation = read("electron/main/cloud-initialization/state-derivation.mjs");
const publishContractSource = read("electron/main/cloud-initialization/contract.mjs");
if (
  !publishStateDerivation.includes("availableActions")
  || !publishStateDerivation.includes("deriveProjectState")
  || !publishStateDerivation.includes("derivePushState")
  || /canResume|canAbandon/.test(publishStateDerivation + publishContractSource)
  || publishContractSource.includes("expectedHeadCommitId")
) {
  errors.push("Cloud initialization must derive independent state axes/actions without long-lived HEAD identity");
}
const publishApi = read("electron/main/cloud-publish-api.mjs");
if (
  !publishApi.includes('from "../../shared/repositoryContract.js"')
  || !publishApi.includes("REPOSITORY_TARGET_CONTRACT_VERSION")
) {
  errors.push("main-owned Git credential issue/revoke must send shared repository contract v2");
}
if (/\bseed\b|template_id|template_config/.test(
  publishCoordinator
  + publishApi
  + publishContractSource
  + read("electron/main/cloud-publish-journal.mjs"),
)) {
  errors.push("strict Desktop Project creation must not send seed/template fields");
}

const rendererCredentialSurfaces = [
  read("electron/preload.cjs"),
  read("src/types/electron.d.ts"),
  read("src/lib/localFiles.ts"),
  read("src/lib/cloudApi.ts"),
  read("src/features/cloud/workspace/workspaceGitRemote.ts"),
];
for (const forbiddenCredentialSurface of [
  "configureGitCloudRemote",
  "issueCloudGitCredential",
  "issueWorkspaceGitRemote",
  "workspace:git-configure-cloud-remote",
]) {
  if (rendererCredentialSurfaces.some((source) => source.includes(forbiddenCredentialSurface))) {
    errors.push(`renderer/preload reintroduced raw Cloud Git credential surface ${forbiddenCredentialSurface}`);
  }
}

const cloudGitService = read("electron/main/cloud-publish-git.mjs");
if (/\["push",\s*CLOUD_REMOTE_NAME|\["ls-remote"[^\]]*CLOUD_REMOTE_NAME/.test(cloudGitService)) {
  errors.push("publish network side effects must use the journaled canonical URL literal, not a mutable remote name");
}
const cloudGitLease = read("electron/main/cloud-git-operation-lease.mjs");
if (!cloudGitLease.includes("identity.commonDir") || cloudGitLease.includes("path.join(identity.gitDir")) {
  errors.push("Cloud Git saga lease must serialize linked worktrees through Git commonDir");
}
const cloudGitCredentials = read("electron/main/cloud-publish-git-credentials.mjs");
if (
  !cloudGitCredentials.includes("puppyonemanaged")
  || !cloudGitCredentials.includes("puppyonesnapshot")
  || !cloudGitCredentials.includes("detachManaged")
) {
  errors.push("Cloud Git credentials require durable URL-scoped exact cleanup for Abandon and Detach");
}

if (errors.length > 0) {
  console.error("Local Workspace architecture check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Local Workspace architecture check passed.");

function read(relativePath) {
  try {
    return readFileSync(path.join(repoRoot, relativePath), "utf8");
  } catch (error) {
    errors.push(`required architecture file is missing: ${relativePath} (${error.message})`);
    return "";
  }
}
