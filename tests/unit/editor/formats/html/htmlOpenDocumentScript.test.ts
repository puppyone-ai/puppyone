/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { htmlOpenDocumentScript } from "../../../../../src/shared-ui/editor/viewers/html/htmlPageViewport";

function runScript(channel: string, html: string) {
  const posted: unknown[] = [];
  const parent = { postMessage: (value: unknown) => posted.push(value) };
  document.body.innerHTML = html;
  // Run the injected script in isolation with a fake window.parent.
  const source = htmlOpenDocumentScript(channel)
    .replace(/^<script>/, "").replace(/<\/script>$/, "");
  new Function("parent", "window", source)(parent, window);
  return posted;
}

describe("htmlOpenDocumentScript", () => {
  it("posts a workspace-relative document target on click", () => {
    const channel = "chan-1";
    const posted = runScript(channel, `<a id="open" href="topics/foo.md">Open</a>`);
    document.getElementById("open")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(posted).toEqual([{ type: "puppyone-html-open-document", channel, target: "topics/foo.md" }]);
  });

  it("prefers the data attribute over href", () => {
    const channel = "chan-2";
    const posted = runScript(channel,
      `<a id="open" href="ignored.md" data-puppyone-open="real.md">Open</a>`);
    document.getElementById("open")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect((posted[0] as { target: string }).target).toBe("real.md");
  });

  it("ignores external, fragment and protocol URLs", () => {
    const channel = "chan-3";
    const posted = runScript(channel, `
      <a id="ext" href="https://example.com">ext</a>
      <a id="frag" href="#section">frag</a>
      <a id="js" href="javascript:alert(1)">js</a>
    `);
    for (const id of ["ext", "frag", "js"]) {
      document.getElementById(id)!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
    expect(posted).toEqual([]);
  });

  it("is inert when the click lands outside any link", () => {
    const channel = "chan-4";
    const posted = runScript(channel, `<p id="text">plain</p>`);
    document.getElementById("text")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(posted).toEqual([]);
  });
});
