import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CLOUD_GIT_LIMIT_CODES } from "../../../../electron/main/cloud-publish-git-reconciliation.mjs";

// What Cloud accepts in a push, pinned byte for byte from
// puppyone-cloud:contracts/cloud-git-acceptance-v1.json. Desktop once kept its
// own copy of a server rule (merge tips refused) for a month after the server
// dropped it, and recognized "too large" by wording the server had changed;
// both repositories' tests stayed green. Changing this contract now fails this
// test until Desktop adapts (puppy-issues ISSUE-127).

const CONTRACT_SHA256 = "49f66fd7df22c8a7d266afb2d27a87296b638f232b4cb44581a5aae9fe02cf54";
const contractUrl = new URL("../../../fixtures/cloud/contracts/cloud-git-acceptance-v1.json", import.meta.url);
const payload = readFileSync(fileURLToPath(contractUrl));
const contract = JSON.parse(payload.toString("utf8"));

describe("Cloud Git acceptance cross-repository contract", () => {
  it("is the pinned server contract", () => {
    expect(createHash("sha256").update(payload).digest("hex")).toBe(CONTRACT_SHA256);
    expect(contract).toMatchObject({ contract: "puppyone.cloud-git-acceptance", version: 1 });
  });

  it("names exactly the refusal codes Desktop treats as size refusals", () => {
    expect([...CLOUD_GIT_LIMIT_CODES]).toEqual(contract.refusals.codes);
    expect(contract.refusals).toMatchObject({
      format: "<human reason> (puppyone-refusal=<code>)",
      same_content_can_pass: false,
    });
  });

  it("states the content rules Desktop's preflight follows", () => {
    // Desktop must not refuse what Cloud accepts, and refuses only what it cannot represent.
    expect(contract.commit_graph).toEqual({
      merge_commits: "accepted",
      octopus_merges: "accepted",
      unrelated_histories: "accepted",
      server_rewrites_history: false,
    });
    expect(contract.content.git_lfs).toBe("unsupported");
    expect(contract.limits.receive_pack_bytes).toBe(2 * 1024 ** 3);
  });
});
