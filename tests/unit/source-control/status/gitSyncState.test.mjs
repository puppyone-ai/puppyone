import { describe, expect, it } from "vitest";
import { getGitSyncState } from "../../../../src/features/source-control/viewModel";

// Message IDs and interpolations are the contract; this also locks bidi isolation.
const t = (id, values) => values ? `${id} ${JSON.stringify(values)}` : id;
const remote = (name, url = "https://example.com/repo.git") => ({ name, fetchUrl: url, pushUrl: url, branches: [] });
const origin = remote("origin");
const cloud = remote("Puppyone", "https://example.com/git/project.git");
const status = (overrides = {}) => ({
  isRepo: true, branch: "topic", headCommitId: "head", remotes: [],
  effectiveHosting: { kind: "generic-git" }, syncTarget: null, ...overrides,
});
const target = (overrides = {}) => ({ remote: "origin", ref: "origin/main", exists: true, ahead: 0, behind: 0, ...overrides });
const cases = [
  ["no snapshot", null],
  ["not a repository", status({ isRepo: false })],
  ["local only", status()],
  ["initial branch", status({ branch: null })],
  ["detached branch", status({ branch: "detached" })],
  ["cloud backup configured without remote", status(), null, { backup: { enabled: true } }],
  ["cloud backup disabled without remote", status(), null, { backup: { enabled: false } }],
  ["cloud target absent", status({ effectiveHosting: { kind: "puppyone-cloud" } })],
  ["cloud remote absent", status({ effectiveHosting: { kind: "puppyone-cloud" }, syncTarget: target({ remote: null, ref: null }) })],
  ["cloud empty ref", status({ effectiveHosting: { kind: "puppyone-cloud" }, syncTarget: target({ ref: "" }) })],
];

for (const [ahead, behind] of [[0, 0], [2, 0], [0, 3], [2, 3]]) {
  for (const exists of [false, true]) {
    for (const headCommitId of [null, "head"]) {
      const syncTarget = target({ exists, ahead, behind });
      cases.push([`cloud ${ahead}/${behind} exists=${exists} head=${headCommitId}`, status({
        effectiveHosting: { kind: "puppyone-cloud" }, syncTarget, headCommitId,
      })]);
      for (const publishRemote of [origin, cloud]) {
        cases.push([`publish ${publishRemote.name} ${ahead}/${behind} exists=${exists} head=${headCommitId}`, status({
          remotes: [publishRemote], syncTarget, headCommitId,
        })]);
      }
    }
  }
  for (const upstreamRemote of [origin, cloud]) {
    cases.push([`upstream ${upstreamRemote.name} ${ahead}/${behind}`, status({ remotes: [upstreamRemote] }), {
      upstream: `${upstreamRemote.name}/main`, ahead, behind,
    }]);
  }
}

for (const [name, remotes, config] of [
  ["origin preferred", [cloud, origin], null],
  ["named puppyone fallback", [remote("other"), remote("Puppyone")], null],
  ["first remote fallback", [remote("other"), remote("second")], null],
  ["canonical cloud URL under another name", [remote("backup", cloud.fetchUrl)], null],
  ["source-of-truth preferred", [origin, cloud], { sync: { sourceOfTruth: { remote: "Puppyone", branch: "sync" } }, git: { primaryRemote: "origin", watchedBranch: "watch" }, backup: { remote: "origin", branch: "backup" } }],
  ["primary remote preferred", [origin, cloud], { git: { primaryRemote: "Puppyone", watchedBranch: "watch" }, backup: { remote: "origin", branch: "backup" } }],
  ["backup remote preferred", [origin, cloud], { backup: { remote: "Puppyone", branch: "backup" } }],
  ["watched branch fallback", [origin], { git: { watchedBranch: "watch" } }],
  ["missing preferred remote falls back", [origin], { git: { primaryRemote: "missing" } }],
]) {
  cases.push([name, status({ remotes }), null, config]);
}
cases.push(
  ["publish without HEAD or target", status({ remotes: [origin], headCommitId: null })],
  ["empty publish ref preserved", status({ remotes: [origin], syncTarget: target({ ref: "" }) })],
  ["upstream without matching remote", status(), { upstream: "elsewhere/main" }],
  ["upstream without slash", status({ remotes: [origin] }), { upstream: "origin", ahead: 2, behind: 0 }],
  ["upstream uses fetch URL if push absent", status({ remotes: [{ ...cloud, pushUrl: null }] }), { upstream: "Puppyone/main", ahead: 2, behind: 0 }],
  ["upstream ignores cloud name with generic URL", status({ remotes: [remote("puppyone")] }), { upstream: "puppyone/main", ahead: 2, behind: 0 }],
  ["cloud hosting precedes upstream", status({ effectiveHosting: { kind: "puppyone-cloud" } }), { upstream: "origin/main", ahead: 9, behind: 9 }],
);

describe("Git sync state characterization", () => {
  it.each(cases)("preserves %s", (_name, snapshot, branch = null, config = null) => {
    expect(getGitSyncState(snapshot, branch, config, t)).toMatchSnapshot();
  });
});
