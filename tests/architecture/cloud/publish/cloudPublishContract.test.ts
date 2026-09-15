import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CONTRACT_SHA256 = "6158201c48957b88fc103aca756417316305d25ea3109cbe5d3e2cf1f3d1823d";
const contractUrl = new URL("../../../../contracts/cloud-project-publish-v1.json", import.meta.url);

describe("Cloud Project publish cross-repository contract", () => {
  it("uses the pinned backend-compatible v1 fixture", () => {
    const payload = readFileSync(fileURLToPath(contractUrl));
    const contract = JSON.parse(payload.toString("utf8"));

    expect(createHash("sha256").update(payload).digest("hex")).toBe(CONTRACT_SHA256);
    expect(contract.contract).toBe("puppyone.cloud-project-publish");
    expect(contract.version).toBe(1);
    expect(contract.identity).toEqual({
      organization: "explicit request field",
      project: "server-created Project id",
      repository_target: "project_root",
      local_binding: false,
      device_registration: false,
    });
    expect(contract.operations.create_empty_project.request.org_id).toBe("required string");
    expect(
      contract.operations.issue_project_root_credential.response_echoes_credential,
    ).toBe(false);
  });
});
