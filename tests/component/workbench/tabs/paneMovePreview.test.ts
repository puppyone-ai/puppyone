/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  PANE_MOVE_PREVIEW_CLASS,
  applyPaneMovePreviewSnapshot,
  capturePaneMovePreview,
  createPaneMovePreview,
  destroyPaneMovePreview,
  movePaneMovePreview,
} from "../../../../src/features/editor-workbench/drag-and-drop/paneMovePreview";

afterEach(() => {
  document.body.innerHTML = "";
  delete window.puppyoneDesktop;
});

describe("pane move preview", () => {
  it("builds an immediate themed shell that follows the pointer without cloning pane DOM", () => {
    const overlay = document.createElement("div");
    overlay.id = "desktop-overlay-root";
    overlay.className = "desktop-overlay-root dark";
    document.body.append(overlay);
    const pane = document.createElement("section");
    pane.dataset.editorPaneId = "editor-pane-1";
    pane.id = "live-pane";
    const content = document.createElement("div");
    content.className = "desktop-editor-pane-content";
    content.id = "live-content";
    content.textContent = "Draft";
    content.getBoundingClientRect = () => new DOMRect(0, 0, 400, 600);
    pane.append(content);
    document.body.append(pane);

    const preview = createPaneMovePreview(pane, 120, 80);
    expect(preview.className).toBe(PANE_MOVE_PREVIEW_CLASS);
    expect(preview.getAttribute("aria-hidden")).toBe("true");
    expect(preview.dataset.ready).toBe("false");
    expect(preview.parentElement).toBe(overlay);
    expect(preview.style.width).toBe("104px");
    expect(preview.style.height).toBe("156px");
    expect(preview.style.transform).toContain("120px");
    expect(preview.style.transform).toContain("80px");
    expect(preview.querySelector("[data-editor-pane-id]")).toBeNull();
    expect(preview.querySelector("#live-pane")).toBeNull();
    expect(preview.querySelector("#live-content")).toBeNull();
    expect(preview.textContent).not.toContain("Draft");

    applyPaneMovePreviewSnapshot(preview, {
      dataUrl: "data:image/png;base64,c25hcHNob3Q=",
      width: 104,
      height: 156,
    });
    expect(preview.dataset.ready).toBe("true");
    expect(preview.querySelector("img")?.getAttribute("src")).toContain("data:image/png");

    movePaneMovePreview(preview, 240, 160);
    expect(preview.style.transform).toContain("240px");
    expect(preview.style.transform).toContain("160px");

    destroyPaneMovePreview(preview);
    expect(document.body.querySelector(`.${PANE_MOVE_PREVIEW_CLASS}`)).toBeNull();
  });

  it("requests a compositor snapshot for the pane content bounds", async () => {
    let capturedRequest: unknown = null;
    window.puppyoneDesktop = {
      capturePanePreview: async (request) => {
        capturedRequest = request;
        return {
          dataUrl: "data:image/png;base64,c25hcHNob3Q=",
          width: 120,
          height: 80,
        };
      },
    } as NonNullable<typeof window.puppyoneDesktop>;
    const pane = document.createElement("section");
    const content = document.createElement("div");
    content.className = "desktop-editor-pane-content";
    content.getBoundingClientRect = () => new DOMRect(24, 36, 640, 420);
    pane.append(content);
    document.body.append(pane);

    await expect(capturePaneMovePreview(pane)).resolves.toMatchObject({
      width: 120,
      height: 80,
    });
    expect(capturedRequest).toEqual({ x: 24, y: 36, width: 640, height: 420 });
  });
});
