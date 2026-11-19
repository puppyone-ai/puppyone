import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The Cloud takes a forced push like any Git server does, so nothing Desktop
 * sends may overwrite what is there: a change made in the Cloud meanwhile is
 * refused and merged, never replaced (the Cloud repository's core-loop test
 * shows a forced push would win). The one exception is the first push, which
 * creates main only while it does not exist yet.
 */
const ONLY_IF_ABSENT = "--force-with-lease=${CLOUD_DESTINATION_REF}:";

function sources(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const entry = path.join(directory, name);
    if (statSync(entry).isDirectory()) return name === "node_modules" ? [] : sources(entry);
    return /\.(mjs|cjs|js|ts)$/.test(name) ? [entry] : [];
  });
}

/** Each git push argument list in the source: an array whose first elements reach "push". */
function pushes(file: string, text: string) {
  return [...text.matchAll(/["'`]push["'`]/g)].flatMap((match) => {
    const before = text.lastIndexOf("[", match.index);
    const end = text.indexOf("]", match.index);
    const args = text.slice(before, end + 1);
    // "push" as a Git subcommand opens its array; "stash push" is not a push to a remote.
    return match.index! - before <= 80 && !/["'`]stash["'`]/.test(args) ? [{ file, args }] : [];
  });
}

describe("what Desktop pushes to a remote", () => {
  const all = sources("electron").flatMap((file) => pushes(file, readFileSync(file, "utf8")));

  it("finds the pushes it guards", () => {
    // Sending, publishing to a branch and the first push to the Cloud.
    expect(new Set(all.map(({ file }) => file))).toEqual(new Set([
      "electron/local-api/workspace.mjs",
      "electron/main/cloud-publish-git.mjs",
    ]));
  });

  it("never forces a push, except creating main while it is absent", () => {
    const forced = all.filter(({ args }) => /--force|["'`]-f["'`]/.test(args.replace(ONLY_IF_ABSENT, "")))
      .map(({ file, args }) => `${file}: ${args.replace(/\s+/g, " ")}`);
    expect(forced).toEqual([]);
    expect(all.filter(({ args }) => args.includes(ONLY_IF_ABSENT)).map(({ file }) => file))
      .toEqual(["electron/main/cloud-publish-git.mjs"]);
  });

  it("never pushes a refspec that replaces whatever the remote has", () => {
    const replacing = all.filter(({ args }) => /["'`]\+/.test(args)).map(({ file, args }) => `${file}: ${args}`);
    expect(replacing).toEqual([]);
  });
});
