/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FilePreview } from "../../../../../packages/shared-ui/src/editor/host/FilePreview";
import { withTestLocalization } from "../../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

describe("binary fallback viewer", () => {
  it("renders the registered binary route as a minimal inert signal surface", async () => {
    await act(async () => root.render(withTestLocalization(<FilePreview
      showHeader={false}
      node={{ id: "payload.bin", path: "payload.bin", name: "payload.bin", type: "file" }}
      fileContent={{ path: "payload.bin", name: "payload.bin", type: "file", content: null, mimeType: "application/octet-stream" }}
    />)));

    for (let attempt = 0; attempt < 100 && !container.querySelector(".document-preview"); attempt++) {
      await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
    }

    const surface = container.querySelector(".document-preview");
    expect(surface).not.toBeNull();
    expect(surface?.textContent).toBe("Binary file · BIN");
    expect(surface?.getAttribute("aria-label")).toContain("payload.bin");
    expect(container.querySelector(".document-preview__signal, .document-preview__rule")).toBeNull();
    expect(container.querySelector("iframe, canvas, [contenteditable=true]")).toBeNull();
  });
});
