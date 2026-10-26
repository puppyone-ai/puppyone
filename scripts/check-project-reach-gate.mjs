#!/usr/bin/env node

// Keeps the "who can reach this project" experiment a two-path delivery instead
// of a tree of conditions. The stored flag has three owners, the decision
// between paths happens only at declared render entries, and the new path may
// not grow a second copy of the share / Git data layer.
//
// Contract and retirement plan: puppy-issues
// `document/puppyone-desktop/platform/experimental-path-forks.md`.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_REACH_FLAG = "enableProjectReach";
export const PROJECT_REACH_HOOK = "useProjectReachExperience";
export const PROJECT_REACH_DOMAIN = "src/features/project-reach";

/** Only these files may name the stored experiment at all. */
export const FLAG_OWNERS = [
  "src/preferences.ts",
  "src/features/settings/main/ExperimentalSettingsView.tsx",
  `${PROJECT_REACH_DOMAIN}/useProjectReachExperience.ts`,
];

/**
 * Render entries allowed to choose between the existing and the new path, with
 * the number of decisions each one may contain. Adding an entry is a reviewed
 * change to the fork contract, not an implementation detail.
 */
export const FORK_ENTRIES = {
  // Header project control in the project menu, and the share entry.
  "src/App.tsx": 2,
  // Header project control in the titlebar.
  "src/features/app-shell/DesktopTitlebarContext.tsx": 1,
  // Notice for changes made elsewhere.
  "src/features/source-control/SourceControlSidebar.tsx": 1,
};

/**
 * Registered new-path homes. Presentation only: no flag reads, no transports,
 * no second data layer. Each delivery registers its own home in the same change.
 */
export const NEW_PATH_DIRECTORIES = [
  // Header reach (115).
  "src/features/app-shell/project-reach",
  // One-screen invite / connect (116).
  "src/features/cloud/share/project-reach",
  // Changes made elsewhere as a receipt awaiting review (117).
  "src/features/changes",
  "src/features/source-control/reach",
];

/** The convention also lives next to the code it governs. */
export const CONVENTION_DOCUMENT = `${PROJECT_REACH_DOMAIN}/README.md`;
const CONVENTION_SECTIONS = ["Fork convention", "Retirement"];

/** Share and Git facts both paths must share instead of re-deriving. */
export const DATA_OWNERS = [
  "useProjectShares",
  "buildProjectShares",
  "useProjectShareActivity",
  "useCloudShare",
  "resolveCloudShareStatus",
  "resolveProjectLocationStatus",
  "getGitTitlebarStatus",
];

const SCAN_ROOTS = ["src", "packages/shared-ui/src"];
const SOURCE_PATTERN = /\.(?:[cm]?[jt]sx?)$/u;

export function projectReachGateErrors({ root }) {
  const errors = [];
  const flagOwners = new Set(FLAG_OWNERS);
  const forkEntries = new Map(Object.entries(FORK_ENTRIES));
  const declarations = new Map(DATA_OWNERS.map((owner) => [owner, []]));

  checkContractFilesExist({ errors, root, forkEntries });
  for (const file of sourceFiles(root)) {
    const source = code(readFileSync(path.join(root, file), "utf8"));
    checkFlagOwnership({ errors, file, source, flagOwners });
    checkForkEntries({ errors, file, source, forkEntries });
    collectDataOwners({ declarations, file, source });
  }
  checkNewPathDirectories({ errors, root });
  checkSharedDataLayer({ errors, declarations });
  checkDeclarations({ errors, root });

  return errors;
}

/** A renamed file silently empties a rule, so the contract names real paths. */
function checkContractFilesExist({ errors, root, forkEntries }) {
  const required = [...FLAG_OWNERS, `${PROJECT_REACH_DOMAIN}/index.ts`, ...forkEntries.keys()];
  for (const file of required) {
    if (!existsSync(path.join(root, file))) {
      errors.push(`${file} is named by the fork contract but does not exist; update the contract`);
    }
  }
  const conventionPath = path.join(root, CONVENTION_DOCUMENT);
  const convention = existsSync(conventionPath) ? readFileSync(conventionPath, "utf8") : null;
  if (convention === null) {
    errors.push(`${CONVENTION_DOCUMENT} must state the fork convention next to the code`);
    return;
  }
  for (const section of CONVENTION_SECTIONS) {
    if (!convention.includes(section)) errors.push(`${CONVENTION_DOCUMENT} must keep its ${section} section`);
  }
}

/** The stored flag stays invisible outside its three owners. */
function checkFlagOwnership({ errors, file, source, flagOwners }) {
  if (!source.includes(PROJECT_REACH_FLAG) || flagOwners.has(file)) return;
  errors.push(`${file} reads ${PROJECT_REACH_FLAG} directly; consume ${PROJECT_REACH_HOOK}() instead`);
}

/** Path selection happens at declared entries, never inside leaf components. */
function checkForkEntries({ errors, file, source, forkEntries }) {
  const decisions = count(source, `${PROJECT_REACH_HOOK}(`);
  if (decisions === 0) return;
  if (file.startsWith(`${PROJECT_REACH_DOMAIN}/`)) return;
  const allowed = forkEntries.get(file);
  if (allowed === undefined) {
    errors.push(`${file} forks on ${PROJECT_REACH_HOOK}() outside the declared render entries`);
    return;
  }
  if (decisions > allowed) {
    errors.push(`${file} contains ${decisions} ${PROJECT_REACH_HOOK}() decisions; the fork contract allows ${allowed}`);
  }
  if (!/from\s+["'][^"']*project-reach["']/u.test(source)) {
    errors.push(`${file} must import ${PROJECT_REACH_HOOK} from the project-reach public entry`);
  }
}

/** The new path renders; it does not re-decide and does not reach transports. */
function checkNewPathDirectories({ errors, root }) {
  for (const directory of NEW_PATH_DIRECTORIES) {
    for (const file of sourceFiles(root, directory)) {
      const source = code(readFileSync(path.join(root, file), "utf8"));
      if (source.includes(PROJECT_REACH_HOOK)) {
        errors.push(`${file} re-checks the experiment inside the new path; fork only at the render entry`);
      }
      if (/\bfetch\(/u.test(source) || source.includes("window.puppyoneDesktop")) {
        errors.push(`${file} reaches a transport directly; consume the shared data owners`);
      }
    }
  }
}

function collectDataOwners({ declarations, file, source }) {
  for (const owner of DATA_OWNERS) {
    if (new RegExp(`(?:function|const|let|class)\\s+${owner}\\b`, "u").test(source)) {
      declarations.get(owner).push(file);
    }
  }
}

/** One owner per fact, so the two paths cannot describe a project differently. */
function checkSharedDataLayer({ errors, declarations }) {
  for (const [owner, files] of declarations) {
    if (files.length === 1) continue;
    errors.push(files.length === 0
      ? `${owner} is named as a shared data owner but is no longer declared; update the fork contract`
      : `${owner} is declared in ${files.length} places (${files.join(", ")}); share / Git facts keep one owner`);
  }
}

/** The owners must actually declare the default-off flag and its settings row. */
function checkDeclarations({ errors, root }) {
  const preferences = readIfPresent(root, "src/preferences.ts");
  if (preferences !== null && !/enableProjectReach:\s*false/u.test(preferences)) {
    errors.push(`src/preferences.ts must default ${PROJECT_REACH_FLAG} to false`);
  }
  const settings = readIfPresent(root, "src/features/settings/main/ExperimentalSettingsView.tsx");
  if (settings !== null && !/messageKey:\s*"projectReach",\s*settingKey:\s*"enableProjectReach"/u.test(settings)) {
    errors.push("ExperimentalSettingsView must register projectReach with a localized row");
  }
  const hook = readIfPresent(root, `${PROJECT_REACH_DOMAIN}/useProjectReachExperience.ts`);
  if (hook !== null && count(hook, PROJECT_REACH_FLAG) !== 1) {
    errors.push(`${PROJECT_REACH_DOMAIN}/useProjectReachExperience.ts must read the stored flag exactly once`);
  }
  const entry = readIfPresent(root, `${PROJECT_REACH_DOMAIN}/index.ts`);
  if (entry !== null && !entry.includes(PROJECT_REACH_HOOK)) {
    errors.push(`${PROJECT_REACH_DOMAIN}/index.ts must export ${PROJECT_REACH_HOOK}`);
  }
}

function readIfPresent(root, file) {
  const absolute = path.join(root, file);
  return existsSync(absolute) ? code(readFileSync(absolute, "utf8")) : null;
}

/** Comments explain the contract; only executable code is governed by it. */
function code(source) {
  return source.replaceAll(/\/\*[\s\S]*?\*\//gu, " ").replaceAll(/\/\/[^\n]*/gu, " ");
}

function count(source, needle) {
  return source.split(needle).length - 1;
}

function* sourceFiles(root, directory) {
  for (const scanRoot of directory ? [directory] : SCAN_ROOTS) {
    const absolute = path.join(root, scanRoot);
    if (!existsSync(absolute)) continue;
    yield* walk(root, absolute);
  }
}

function* walk(root, directory) {
  for (const entry of readdirSync(directory).sort()) {
    const absolute = path.join(directory, entry);
    if (statSync(absolute).isDirectory()) yield* walk(root, absolute);
    else if (SOURCE_PATTERN.test(entry) && !entry.endsWith(".d.ts")) {
      yield path.relative(root, absolute).replaceAll(path.sep, "/");
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const errors = projectReachGateErrors({ root });
  if (errors.length) {
    console.error(`Project reach experiment gate failed with ${errors.length} error(s):`);
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log(
      `Project reach experiment gate OK: ${FLAG_OWNERS.length} flag owners, `
      + `${Object.keys(FORK_ENTRIES).length} declared render entries, `
      + `${NEW_PATH_DIRECTORIES.length} registered new-path homes, `
      + `${DATA_OWNERS.length} shared data owners.`,
    );
  }
}
