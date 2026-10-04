import { describe, expect, it, vi } from "vitest";
import { createResourceUri, createWorkspaceResourceUri } from "@puppyone/shared-ui";
import { projectCloudHtml } from "../../../../src/features/cloud/workbench/cloudHtmlProjection";

const root = createResourceUri({ scheme: "puppyone-cloud", authority: "fixture.test", path: "https/api/v1/owner/project/root" });
const resource = (path: string) => createWorkspaceResourceUri(root, path);
const setup = () => ({ root, sign: vi.fn(async (path: string) => `https://fixture.test/inline?path=${encodeURIComponent(path)}&token=isolated`),
  readText: vi.fn(async (path: string) => ({ content: path.endsWith("theme.css")
    ? "h1 {background-image:url('../images/chart.svg')}" : "@import 'theme.css' screen; body {color:blue}" })) });
describe("Cloud HTML resource projection", () => {
  it("resolves document/CSS-relative resources without persisting capability URLs", async () => {
    const services = setup();
    const source = '<link rel="stylesheet" href="../styles/main.css"><img src="../images/chart.svg"><p style="background:url(../images/chart.svg)">Hello</p>';
    const projected = await projectCloudHtml(resource("pages/index.xhtml"), source, services, new AbortController().signal);
    expect(services.readText.mock.calls.map(([path]) => path)).toEqual([resource("styles/main.css"), resource("styles/theme.css")]);
    expect(services.sign).toHaveBeenCalledTimes(1);
    expect(services.sign).toHaveBeenCalledWith(resource("images/chart.svg"));
    expect(projected).toContain("@media screen");
    expect(projected).toContain("token=isolated");
    expect(source).not.toContain("token=");
    expect(projected).not.toContain('<link rel="stylesheet"');
  });
  it("preserves target identity and uses the authored workspace base", async () => {
    const services = setup();
    const projected = await projectCloudHtml(resource("pages/index.html"), '<base href="blob:old"><h1 data-puppyone-html-target="id">Hello</h1><img src="chart.svg">',
      services, new AbortController().signal, "../images/");
    expect(services.sign).toHaveBeenCalledWith(resource("images/chart.svg"));
    expect(projected).toContain('data-puppyone-html-target="id"');
    expect(projected).not.toContain('href="blob:old"');
  });
  it("rejects escapes, cancelled projections and dependency cycles", async () => {
    const services = setup();
    await expect(projectCloudHtml(resource("index.html"), '<img src="../../outside.svg">', services, new AbortController().signal)).rejects.toThrow(/outside/);
    await expect(projectCloudHtml(resource("index.html"), '<img src="photo.svg">', services, AbortSignal.abort())).rejects.toThrow();
    services.readText.mockResolvedValue({ content: "@import 'cycle.css';" });
    await expect(projectCloudHtml(resource("index.html"), '<link rel="stylesheet" href="cycle.css">', services, new AbortController().signal)).rejects.toThrow(/budget/);
  });
  it("leaves external bases and already absolute resources under the existing CSP", async () => {
    const services = setup();
    const source = '<base href="https://example.test/"><img src="asset.svg">';
    const projected = await projectCloudHtml(resource("index.html"), source, services, new AbortController().signal, "https://example.test/");
    expect(projected).toContain('href="https://example.test/"');
    expect(services.sign).not.toHaveBeenCalled();
  });
});
