const PINNED_ACTION_PATTERN = /uses:\s+actions\/[A-Za-z0-9_.-]+@[a-f0-9]{40}(?:\s+#.*)?$/gm;
const UNPINNED_ACTION_PATTERN = /uses:\s+actions\/[A-Za-z0-9_.-]+@(?![a-f0-9]{40}(?:\s|$))[^ \n]+/g;

export function inspectContinuousIntegrationWorkflow(workflowSource) {
  const errors = inspectSource(workflowSource, "continuous integration workflow");
  if (errors.length > 0) return errors;
  requireSnippets(workflowSource, errors, [
    ["pull_request:", "CI must run for pull requests"],
    ["branches:\n      - main", "CI must run for pushes to main"],
    ["permissions:\n  contents: read", "CI must use a read-only default token"],
    ["npm ci", "CI must install the lockfile exactly"],
    ["npm run check:release -- --group source", "CI must run the canonical source checks, including updater P0 coverage"],
    ["npm run check:release -- --group app", "CI must run the canonical build and real application checks"],
    ["needs: [source-checks, app-checks, platform-contracts]", "the required Build gate must aggregate every release-check group"],
    ["if: always()", "failed or skipped groups must reach the required Build gate"],
    ['test "$SOURCE_RESULT" = success', "source checks must pass before the Build gate succeeds"],
    ['test "$APP_RESULT" = success', "application checks must pass before the Build gate succeeds"],
    ['test "$PLATFORM_RESULT" = success', "all platform checks must pass before the Build gate succeeds"],
    ["scripts/print-desktop-target-matrix.mjs --scope contracts", "CI must resolve native test runners from the target manifest"],
    ["fromJSON(needs.resolve-desktop-targets.outputs.matrix)", "CI must fan out the target contract matrix"],
    ["npm run check:release -- --group platform", "CI must verify platform contracts on every declared native runner"],
  ]);
  forbidSnippets(workflowSource, errors, [
    ["contents: write", "CI must not receive repository write permission"],
    ["id-token: write", "CI must not receive an OIDC publication token"],
    ["CSC_LINK", "CI must not receive Apple signing credentials"],
    ["R2_ACCESS_KEY_ID", "CI must not receive R2 publication credentials"],
    ["R2_SECRET_ACCESS_KEY", "CI must not receive R2 publication credentials"],
    ["CLOUDFLARE_ACCOUNT_ID", "CI must not receive release publication credentials"],
  ]);
  inspectPinnedActions(workflowSource, errors);
  return errors;
}

export function inspectInternalReleaseWorkflow(workflowSource) {
  const errors = inspectSource(workflowSource, "internal release workflow");
  if (errors.length > 0) return errors;
  requireSnippets(workflowSource, errors, [
    ["runs-on: macos-15", "the internal build must use the pinned arm64 macOS runner"],
    ["publish_release:", "the internal workflow must expose one atomic publish switch"],
    ["Test release transaction and Terminal launcher", "the internal build must run release integration tests on macOS"],
    ["Test updater monotonicity P0", "the Internal build must run updater P0 regressions before packaging"],
    ["Verify Internal release version moves forward", "the Internal build must reject non-monotonic release versions"],
    ["verify-desktop-release-version.mjs", "the Internal build must use the canonical release version verifier"],
    ["actions: read", "the Internal build must have least-privilege access to verify source CI"],
    ["Verify green main source", "the Internal workflow must reject non-main or unverified source commits"],
    ["refs/heads/main", "the Internal workflow must require the protected main branch"],
    ["actions/workflows/ci.yml/runs", "the Internal workflow must verify the exact commit's CI result"],
    [".conclusion == \"success\"", "the Internal workflow must require successful CI"],
    ["scripts/prepare-desktop-build.mjs", "the Internal workflow must use the canonical Build Identity resolver"],
    ["--channel internal", "the Internal workflow must resolve only the Internal build channel"],
    ["--target macos-arm64", "the Internal workflow must resolve its build target through the target manifest"],
    ["PLATFORM_KEY: ${{ steps.release.outputs.target_runtime_key }}", "the Internal workflow must stage the runtime declared by its target"],
    ["npm run dist:mac:prepared", "the Internal workflow must package the prepared identity"],
    ["Verify packaged Internal Build Identity", "the Internal workflow must inspect packaged identity"],
    ["--build-info generated/desktop-build-info.json", "release metadata must consume resolved Build Identity"],
    ["Create self-describing release bundle", "the internal build must create release metadata"],
    ["actions/attest@", "published internal binaries must receive build provenance"],
    ["uses: ./.github/workflows/desktop-release-publish.yml", "the internal workflow must use the canonical publisher"],
    ["deployment_environment: desktop-internal", "the internal publisher must use its deployment environment"],
    ["publish_github_release: false", "Internal GitHub release records must remain collaborator-only drafts"],
    ["r2-prefix \"desktop/internal/mac/${RELEASE_TAG}\"", "the internal manifest must use the internal R2 channel"],
  ]);
  forbidSnippets(workflowSource, errors, [
    ["upload_r2:", "R2 and GitHub publication must not be independently selectable"],
    ["create_github_release:", "R2 and GitHub publication must not be independently selectable"],
    ["R2_ACCESS_KEY_ID", "the build job must not receive R2 deployment credentials"],
    ["desktop/stable/mac", "the ad-hoc internal workflow must never write to the stable channel"],
    ["INPUT_RELEASE_TAG", "callers must not hand-compose Internal release tags"],
    ["TAG=\"v${VERSION}-internal.", "the workflow must not construct versions independently"],
  ]);
  assertOrder(workflowSource, errors, [
    "Verify green main source",
    "Resolve immutable release identity",
    "Install locked dependencies",
    "Test updater monotonicity P0",
    "Verify Internal release version moves forward",
    "Test release transaction and Terminal launcher",
    "Build ad-hoc macOS package",
    "Verify packaged Internal Build Identity",
    "Create self-describing release bundle",
    "Attest published binaries and checksums",
    "Upload build-once release bundle",
  ], "Internal build");
  inspectPinnedActions(workflowSource, errors);
  return errors;
}

export function inspectStableReleaseWorkflow(workflowSource) {
  const errors = inspectSource(workflowSource, "stable release workflow");
  if (errors.length > 0) return errors;
  requireSnippets(workflowSource, errors, [
    ["workflow_dispatch:", "Stable publication must require an explicit operator action"],
    ["promotion_source_tag:", "Stable publication must require the exact tested Internal candidate"],
    ["Exact installed and approved Internal candidate tag", "the promotion input must describe installed-candidate approval"],
    ["runs-on: macos-15", "the stable build must pin its macOS runner"],
    ["name: desktop-signing", "stable signing must use its dedicated deployment environment"],
    ["Test release transaction and Terminal launcher", "the stable build must run release integration tests on macOS"],
    ["Test updater monotonicity P0", "the Stable build must run updater P0 regressions before signing"],
    ["Verify Stable release version moves forward", "the Stable build must reject non-monotonic release versions"],
    ["verify-desktop-release-version.mjs", "the Stable build must use the canonical release version verifier"],
    ["Prepare release application without deployment secrets", "stable application preparation must be secretless"],
    ["Verify exact Internal promotion source", "Stable must be promoted from verified Internal evidence"],
    ["verify-stable-promotion-source.mjs", "Stable must use the canonical promotion verifier"],
    ["--source-tag \"${{ inputs.promotion_source_tag }}\"", "Stable must verify the operator-selected Internal candidate"],
    ["--target macos-arm64", "Stable must resolve its build target through the target manifest"],
    ["PLATFORM_KEY: ${{ steps.release.outputs.target_runtime_key }}", "Stable must stage the runtime declared by its target"],
    ["Sign, notarize, and verify release package", "stable packaging must sign and notarize"],
    ["APPLE_API_KEY_BASE64", "stable CI must receive the App Store Connect key as base64 secret material"],
    ["export APPLE_API_KEY=\"${api_key_path}\"", "stable CI must pass notarytool a materialized API key file path"],
    ["trap 'rm -f \"${api_key_path}\"' EXIT", "stable CI must remove materialized notarization key material"],
    ["Create self-describing stable release bundle", "the stable build must create release metadata"],
    ["actions/attest@", "stable binaries must receive build provenance"],
    ["uses: ./.github/workflows/desktop-release-publish.yml", "stable releases must use the canonical publisher"],
    ["verify_tag: true", "stable GitHub releases must require a pre-existing tag"],
    ["generate_notes: true", "stable GitHub releases must generate release notes"],
    ["publish_github_release: true", "Stable must publish its verified GitHub Release"],
    ["--build-info generated/desktop-build-info.json", "Stable release metadata must consume Build Identity"],
    ["--promotion-source-tag", "Stable release metadata must retain Internal promotion evidence"],
  ]);
  forbidSnippets(workflowSource, errors, [
    ["push:\n    tags:", "pushing a Stable tag must not publish without explicit candidate selection"],
    ["R2_ACCESS_KEY_ID", "the stable build workflow must not receive R2 deployment credentials"],
    ["gh release create", "the stable build must delegate GitHub publication to the canonical publisher"],
  ]);
  assertOrder(workflowSource, errors, [
    "Install locked dependencies without deployment secrets",
    "Test updater monotonicity P0",
    "Verify Stable release version moves forward",
    "Test release transaction and Terminal launcher",
    "Verify exact Internal promotion source",
    "Prepare release application without deployment secrets",
    "Sign, notarize, and verify release package",
    "Create self-describing stable release bundle",
    "Attest stable binaries and checksums",
    "Upload build-once stable release bundle",
  ], "stable build");
  inspectPinnedActions(workflowSource, errors);
  return errors;
}

export function inspectReleasePublisherWorkflow(workflowSource) {
  const errors = inspectSource(workflowSource, "release publisher workflow");
  if (errors.length > 0) return errors;
  requireSnippets(workflowSource, errors, [
    ["group: desktop-release-publish", "all release channels must share one publication lock"],
    ["preflight:", "the publisher must expose a secretless distribution preflight job"],
    ["needs: preflight", "publication authority must wait for the distribution preflight"],
    ["name: ${{ inputs.deployment_environment }}", "publishing secrets must be environment-scoped"],
    ["BUNDLE_DIRECTORY: ${{ github.workspace }}/artifacts/desktop-release-bundle", "the publisher must use an absolute release bundle path"],
    ["node-version: 22", "the publisher must pin the supported Node.js runtime"],
    ["PUBLIC_UPDATE_ORIGIN: https://updates.puppyone.ai", "Stable publication must preserve the shipped machine update origin"],
    ["Download build-once release bundle", "the publisher must consume the build-once artifact"],
    ["Verify existing Stable update origin before publication", "Stable publication must fail before mutation when its existing update contract is unhealthy"],
    ["Reject non-monotonic release version before publication", "the publisher must reject a release that does not advance immutable history"],
    ["Verify latest pointer remains at published history head", "the publisher must prove latest is not behind release history after mutation"],
    ["verify-desktop-release-version.mjs", "the publisher must use the canonical release version verifier"],
    ["release.json is the commit marker", "R2 publication must use an explicit commit marker"],
    ["--cache-control \"public, max-age=31536000, immutable\"", "versioned release objects must be immutable"],
    ["--cache-control \"public, no-cache, must-revalidate\"", "mutable release objects must revalidate"],
    ["--draft", "GitHub releases must be created as drafts"],
    ["publish_github_release:", "the caller must explicitly choose whether a verified draft becomes public"],
    ["inputs.publish_github_release", "Internal releases must be able to remain collaborator-only drafts"],
    ["Verify GitHub asset digests before publication", "GitHub asset digests must be checked before publication"],
    ["Publish verified GitHub Release", "the publisher must explicitly publish the verified draft"],
    ["Verify published GitHub Release state", "the published GitHub release and tag must be reverified"],
    ["Verify every immutable R2 object by SHA-256", "every R2 versioned object must be content-verified"],
    ["Validate remote tag ownership", "an existing Git tag must resolve to the bundled commit"],
    ["Publish latest release pointer", "the latest channel must expose a machine-readable pointer"],
    ["desktop/catalog/releases.json", "the publisher must maintain the webpage release catalog"],
    ["desktop/internal/catalog/releases.json", "Internal releases must use a separate restricted catalog"],
    ["--max-redirs 0", "authenticated Internal verification must reject redirects"],
    ["Verify public pointers and catalog", "mutable public metadata must be verified after publication"],
    ["Verify Stable updater payloads through every shipped origin", "Stable payloads must be content-verified through the machine update origin"],
    ["Verify promoted Stable update feed contract", "the promoted Stable feed must be checked against the release version"],
    ["verify-desktop-stable-update-feed.mjs", "Stable publication must use the canonical update-feed verifier"],
    ["Clean stale mutable release files", "stale latest files must be removed only after the new release is public"],
  ]);
  forbidSnippets(workflowSource, errors, [
    ["--delete", "latest promotion must not delete working payloads before the new release is committed"],
    ["AWS_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}\n      AWS_SECRET", "R2 credentials must not be job-global"],
  ]);
  requireStageSnippet(
    workflowSource,
    errors,
    "Inspect GitHub Release state",
    "PUBLISH_GITHUB_RELEASE: ${{ inputs.publish_github_release }}",
    "the GitHub release-state step must receive the caller's draft/public policy explicitly",
  );
  requireStageSnippet(
    workflowSource,
    errors,
    "Verify published GitHub Release state",
    "PUBLISH_GITHUB_RELEASE: ${{ inputs.publish_github_release }}",
    "the final GitHub release verification must receive the caller's draft/public policy explicitly",
  );
  for (const stageName of [
    "Verify existing Stable update origin before publication",
    "Verify Stable updater payloads through every shipped origin",
    "Verify promoted Stable update feed contract",
  ]) {
    requireStageSnippet(
      workflowSource,
      errors,
      stageName,
      "if: ${{ inputs.channel == 'stable' }}",
      `the "${stageName}" stage must run only for Stable publication`,
    );
  }
  requireStageSnippet(
    workflowSource,
    errors,
    "Verify promoted Stable update feed contract",
    "--expected-version \"${{ steps.release.outputs.version }}\"",
    "the promoted Stable feed must match the exact release version",
  );
  requireJobSnippet(
    workflowSource,
    errors,
    "preflight",
    "permissions:\n      contents: read",
    "the distribution preflight must override publication authority with a read-only token",
  );
  forbidJobSnippet(
    workflowSource,
    errors,
    "preflight",
    "${{ secrets.",
    "the distribution preflight must not receive deployment secrets",
  );
  assertOrder(workflowSource, errors, [
    "Reject non-monotonic release version before publication",
    "Verify existing Stable update origin before publication",
    "Validate release bundle and caller contract",
    "Validate publishing credentials and tools",
    "Inspect immutable R2 release state",
    "Upload immutable R2 release",
    "Verify every immutable R2 object by SHA-256",
    "Validate remote tag ownership",
    "Create GitHub draft release with identical assets",
    "Verify GitHub asset digests before publication",
    "Publish verified GitHub Release",
    "Verify published GitHub Release state",
    "Promote mutable R2 latest files",
    "Verify mutable latest payloads by SHA-256",
    "Verify Stable updater payloads through every shipped origin",
    "Publish latest release pointer",
    "Verify promoted Stable update feed contract",
    "Merge immutable release into catalog",
    "Publish release catalog",
    "Verify public pointers and catalog",
    "Verify latest pointer remains at published history head",
    "Clean stale mutable release files",
  ], "canonical publication");
  inspectPinnedActions(workflowSource, errors);
  return errors;
}

export function inspectLegacyArchiveWorkflow(workflowSource) {
  const errors = inspectSource(workflowSource, "legacy archive workflow");
  if (errors.length > 0) return errors;
  requireSnippets(workflowSource, errors, [
    ["delete_root_objects:", "root deletion must require an explicit workflow input"],
    ["repair_partial_backfills:", "partial backfill repair must require an explicit workflow input"],
    ["default: false", "root deletion must be disabled by default"],
    ["group: desktop-release-publish", "archive catalog updates must share the global publication lock"],
    ["name: desktop-internal", "archive credentials must use a deployment environment"],
    ["node-version: 22", "the archive workflow must pin the supported Node.js runtime"],
    ["--provenance backfill", "GitHub-backed history must be marked as a backfill"],
    ["--provenance archive", "provenance-free root artifacts must be marked as archives"],
    ["Verify every backfilled R2 object by SHA-256", "all historical R2 copies must be content-verified"],
    ["Attach and verify metadata on historical GitHub Releases", "GitHub history must receive the same release metadata as R2"],
    ["Merge release history into channel-specific catalogs", "all historical releases must appear in their channel-appropriate catalogs"],
    ["Publish and verify channel-specific release catalogs", "all historical catalogs must be content-verified after publication"],
    ["Repair explicitly authorized partial R2 backfills", "uncommitted historical prefixes must have an explicit repair stage"],
    ["inputs.repair_partial_backfills", "partial backfill repair must be explicitly gated"],
    ["Refusing to delete object outside", "partial backfill repair must enforce its prefix boundary"],
    ["if: ${{ inputs.delete_root_objects }}", "root deletion must be explicitly gated"],
  ]);
  assertOrder(workflowSource, errors, [
    "Build verified bundles from canonical GitHub Releases",
    "Download original root objects",
    "Create honest legacy archive metadata",
    "Repair explicitly authorized partial R2 backfills",
    "Backfill immutable GitHub releases into R2",
    "Upload immutable legacy archives",
    "Verify every backfilled R2 object by SHA-256",
    "Attach and verify metadata on historical GitHub Releases",
    "Merge release history into channel-specific catalogs",
    "Publish and verify channel-specific release catalogs",
    "Delete verified root objects",
  ], "release history backfill");
  inspectPinnedActions(workflowSource, errors);
  return errors;
}

export function inspectUpdateFeedMonitorWorkflow(workflowSource) {
  const errors = inspectSource(workflowSource, "Stable update feed monitor workflow");
  if (errors.length > 0) return errors;
  requireSnippets(workflowSource, errors, [
    ["schedule:", "the Stable update feed monitor must run on a schedule"],
    ["cron: \"17 */6 * * *\"", "the Stable update feed monitor must run at least every six hours"],
    ["workflow_dispatch:", "the Stable update feed monitor must support an operator-triggered check"],
    ["permissions:\n  contents: read", "the Stable update feed monitor must use a read-only token"],
    ["group: desktop-stable-update-feed-monitor", "update feed checks must use a dedicated concurrency group"],
    ["cancel-in-progress: true", "a newer update feed check must replace a stale monitor run"],
    ["node-version: 22", "the Stable update feed monitor must use the supported Node.js runtime"],
    ["Verify every shipped Stable update feed", "the monitor must validate every registered compatibility endpoint"],
    ["node scripts/verify-desktop-stable-update-feed.mjs", "the monitor must use the canonical update-feed verifier"],
    ["Verify Stable latest is the published history head", "the monitor must detect a latest pointer rollback"],
    ["--require-latest-history-head", "the monitor must compare latest against immutable release history"],
    ["verify-desktop-release-version.mjs", "the monitor must use the canonical release version verifier"],
    ["if: ${{ always() }}", "the monitor must summarize both healthy and failed checks"],
    ["https://updates.puppyone.ai/desktop/stable/mac/latest/stable-mac.yml", "the monitor summary must identify the machine update contract"],
    ["https://downloads.puppyone.ai/desktop/stable/mac/latest/latest.json", "the monitor summary must identify the public release pointer"],
  ]);
  forbidSnippets(workflowSource, errors, [
    ["contents: write", "the Stable update feed monitor must not receive repository write permission"],
    ["id-token: write", "the Stable update feed monitor must not receive an OIDC publication token"],
    ["${{ secrets.", "the Stable update feed monitor must not receive deployment secrets"],
  ]);
  inspectPinnedActions(workflowSource, errors);
  return errors;
}

function inspectSource(source, label) {
  return typeof source === "string" && source.trim().length > 0 ? [] : [`the ${label} is missing or empty`];
}

function requireSnippets(source, errors, requirements) {
  for (const [snippet, error] of requirements) {
    if (!source.includes(snippet)) errors.push(error);
  }
}

function forbidSnippets(source, errors, requirements) {
  for (const [snippet, error] of requirements) {
    if (source.includes(snippet)) errors.push(error);
  }
}

function assertOrder(source, errors, stages, label) {
  let previousIndex = -1;
  for (const stage of stages) {
    const currentIndex = source.indexOf(`- name: ${stage}`);
    if (currentIndex < 0) {
      errors.push(`the ${label} is missing the "${stage}" stage`);
      continue;
    }
    if (currentIndex <= previousIndex) errors.push(`the ${label} must run "${stage}" after its preceding stage`);
    previousIndex = Math.max(previousIndex, currentIndex);
  }
}

function requireStageSnippet(source, errors, stageName, snippet, error) {
  const stageStart = source.indexOf(`- name: ${stageName}`);
  if (stageStart < 0) {
    errors.push(`the workflow is missing the "${stageName}" stage`);
    return;
  }
  const nextStage = source.indexOf("\n      - name:", stageStart + 1);
  const stageSource = source.slice(stageStart, nextStage < 0 ? undefined : nextStage);
  if (!stageSource.includes(snippet)) errors.push(error);
}

function requireJobSnippet(source, errors, jobName, snippet, error) {
  const jobSource = getJobSource(source, jobName);
  if (jobSource == null || !jobSource.includes(snippet)) errors.push(error);
}

function forbidJobSnippet(source, errors, jobName, snippet, error) {
  const jobSource = getJobSource(source, jobName);
  if (jobSource != null && jobSource.includes(snippet)) errors.push(error);
}

function getJobSource(source, jobName) {
  const jobPattern = /^  ([A-Za-z0-9_-]+):\s*$/gm;
  const jobs = Array.from(source.matchAll(jobPattern));
  const jobIndex = jobs.findIndex((match) => match[1] === jobName);
  if (jobIndex < 0) return null;
  return source.slice(jobs[jobIndex].index, jobs[jobIndex + 1]?.index);
}

function inspectPinnedActions(source, errors) {
  const unpinned = source.match(UNPINNED_ACTION_PATTERN) ?? [];
  if (unpinned.length > 0) errors.push(`GitHub-owned actions must be pinned to full commit SHAs: ${unpinned.join(", ")}`);
  if (source.includes("uses: actions/") && !(source.match(PINNED_ACTION_PATTERN) ?? []).length) {
    errors.push("the workflow does not contain a verifiably pinned GitHub-owned action");
  }
}
