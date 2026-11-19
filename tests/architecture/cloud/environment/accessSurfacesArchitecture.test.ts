import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Access surfaces in the Cloud facade", () => {
  it("keeps no legacy leaf resource aliases", () => {
    const facade = readFileSync("src/lib/cloudApi.ts", "utf8");
    expect(facade).not.toMatch(/DesktopCloudConnector|listCloudConnectors|updateCloudConnector|\/connectors\b/);
  });
});
