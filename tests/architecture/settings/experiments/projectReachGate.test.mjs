import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  CONVENTION_DOCUMENT,
  DATA_OWNERS,
  FORK_ENTRIES,
  NEW_PATH_DIRECTORIES,
  PROJECT_REACH_DOMAIN,
  PROJECT_REACH_FLAG,
  PROJECT_REACH_HOOK,
  projectReachGateErrors,
} from "../../../../scripts/check-project-reach-gate.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function write(root, file, source) {
  const absolute = path.join(root, file);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, source);
}

/** The smallest tree that satisfies the contract: owners, entries, one data layer. */
function compliantRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "project-reach-gate-"));
  roots.push(root);
  write(root, "src/preferences.ts", `export const DEFAULTS = { ${PROJECT_REACH_FLAG}: false };\n`);
  write(root, "src/features/settings/main/ExperimentalSettingsView.tsx",
    `export const rows = [{ messageKey: "projectReach", settingKey: "${PROJECT_REACH_FLAG}" }];\n`);
  write(root, `${PROJECT_REACH_DOMAIN}/${PROJECT_REACH_HOOK}.ts`,
    `export function ${PROJECT_REACH_HOOK}() {\n  return read(s => s.experimentalSettings.${PROJECT_REACH_FLAG});\n}\n`);
  write(root, `${PROJECT_REACH_DOMAIN}/index.ts`,
    `export { ${PROJECT_REACH_HOOK} } from "./${PROJECT_REACH_HOOK}";\n`);
  write(root, CONVENTION_DOCUMENT, "# Project Reach Experience\n\n## Fork convention\n\n## Retirement\n");
  for (const [file, decisions] of Object.entries(FORK_ENTRIES)) write(root, file, forkEntry(file, decisions));
  write(root, "src/data/projectFacts.ts", DATA_OWNERS.map(owner => `export function ${owner}() {}\n`).join(""));
  return root;
}

function forkEntry(file, decisions) {
  const depth = file.split("/").length - 2;
  const entry = `${"../".repeat(depth) || "./"}${PROJECT_REACH_DOMAIN.replace("src/features/", "")}`;
  const forks = Array.from({ length: decisions }, (_, index) =>
    `export const path${index} = ${PROJECT_REACH_HOOK}() ? "project reach" : "existing";\n`);
  return `import { ${PROJECT_REACH_HOOK} } from "${entry}";\n${forks.join("")}`;
}

describe("project reach experiment gate", () => {
  it("accepts a two-path tree with one flag owner set, declared entries and one data layer", () => {
    expect(projectReachGateErrors({ root: compliantRoot() })).toEqual([]);
  });

  it("holds for the repository itself", () => {
    expect(projectReachGateErrors({ root: repositoryRoot })).toEqual([]);
  });

  it("rejects a surface that reads the stored flag instead of the consumption point", () => {
    const root = compliantRoot();
    write(root, "src/features/app-shell/DesktopProjectLocationSwitcher.tsx",
      `export const enabled = settings.${PROJECT_REACH_FLAG};\n`);
    expect(projectReachGateErrors({ root })).toEqual([
      `src/features/app-shell/DesktopProjectLocationSwitcher.tsx reads ${PROJECT_REACH_FLAG} directly;`
      + ` consume ${PROJECT_REACH_HOOK}() instead`,
    ]);
  });

  it("rejects a fork in a leaf component outside the declared render entries", () => {
    const root = compliantRoot();
    write(root, "src/features/cloud/share/ShareWizardDialog.tsx", forkEntry("src/features/cloud/share/ShareWizardDialog.tsx", 1));
    expect(projectReachGateErrors({ root })).toEqual([
      `src/features/cloud/share/ShareWizardDialog.tsx forks on ${PROJECT_REACH_HOOK}() outside the declared render entries`,
    ]);
  });

  it("rejects extra decisions inside a declared entry and a fork that bypasses the public entry", () => {
    const root = compliantRoot();
    write(root, "src/App.tsx", `import { ${PROJECT_REACH_HOOK} } from "./features/project-reach/${PROJECT_REACH_HOOK}";\n`
      + `export const a = ${PROJECT_REACH_HOOK}(), b = ${PROJECT_REACH_HOOK}(), c = ${PROJECT_REACH_HOOK}();\n`);
    expect(projectReachGateErrors({ root })).toEqual([
      `src/App.tsx contains 3 ${PROJECT_REACH_HOOK}() decisions; the fork contract allows 2`,
      "src/App.tsx must import useProjectReachExperience from the project-reach public entry",
    ]);
  });

  it("rejects a new-path file that re-decides or reaches a transport itself", () => {
    const root = compliantRoot();
    const file = `${NEW_PATH_DIRECTORIES[0]}/ProjectReachControl.tsx`;
    write(root, file, `export const reach = ${PROJECT_REACH_HOOK}();\nexport const load = () => fetch("/shares");\n`);
    expect(projectReachGateErrors({ root })).toEqual([
      `${file} forks on ${PROJECT_REACH_HOOK}() outside the declared render entries`,
      `${file} re-checks the experiment inside the new path; fork only at the render entry`,
      `${file} reaches a transport directly; consume the shared data owners`,
    ]);
  });

  it("rejects a second copy of a shared share or Git fact", () => {
    const root = compliantRoot();
    write(root, `${NEW_PATH_DIRECTORIES[1]}/useReachShares.ts`, `export function ${DATA_OWNERS[0]}() {}\n`);
    expect(projectReachGateErrors({ root })).toEqual([
      `${DATA_OWNERS[0]} is declared in 2 places`
      + ` (src/data/projectFacts.ts, ${NEW_PATH_DIRECTORIES[1]}/useReachShares.ts);`
      + " share / Git facts keep one owner",
    ]);
  });

  it("rejects a contract that names a file the repository no longer has", () => {
    const root = compliantRoot();
    const [entry] = Object.keys(FORK_ENTRIES);
    rmSync(path.join(root, entry));
    expect(projectReachGateErrors({ root })).toEqual([
      `${entry} is named by the fork contract but does not exist; update the contract`,
    ]);
  });

  it("rejects a convention document that lost the fork or retirement contract", () => {
    const root = compliantRoot();
    write(root, CONVENTION_DOCUMENT, "# Project Reach Experience\n\n## Fork convention\n");
    expect(projectReachGateErrors({ root })).toEqual([
      `${CONVENTION_DOCUMENT} must keep its Retirement section`,
    ]);

    rmSync(path.join(root, CONVENTION_DOCUMENT));
    expect(projectReachGateErrors({ root })).toEqual([
      `${CONVENTION_DOCUMENT} must state the fork convention next to the code`,
    ]);
  });

  it("rejects an experiment that defaults on, loses its settings row or reads the flag twice", () => {
    const root = compliantRoot();
    write(root, "src/preferences.ts", `export const DEFAULTS = { ${PROJECT_REACH_FLAG}: true };\n`);
    write(root, "src/features/settings/main/ExperimentalSettingsView.tsx", "export const rows = [];\n");
    write(root, `${PROJECT_REACH_DOMAIN}/${PROJECT_REACH_HOOK}.ts`,
      `export const ${PROJECT_REACH_HOOK} = () => read(s => s.${PROJECT_REACH_FLAG}) ?? fallback.${PROJECT_REACH_FLAG};\n`);
    expect(projectReachGateErrors({ root })).toEqual([
      `src/preferences.ts must default ${PROJECT_REACH_FLAG} to false`,
      "ExperimentalSettingsView must register projectReach with a localized row",
      `${PROJECT_REACH_DOMAIN}/${PROJECT_REACH_HOOK}.ts must read the stored flag exactly once`,
    ]);
  });
});
