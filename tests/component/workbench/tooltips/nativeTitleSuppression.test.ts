/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it } from "vitest";
import { installNativeTitleSuppression } from "../../../../src/lib/nativeTitleSuppression";

let stopSuppression: (() => void) | null = null;

afterEach(() => {
  stopSuppression?.();
  stopSuppression = null;
  document.body.replaceChildren();
});

async function flushMutationObserver() {
  await Promise.resolve();
}

describe("native title suppression", () => {
  it("removes existing and subsequently inserted native titles", async () => {
    document.body.innerHTML = '<button title="Existing">Visible</button>';
    stopSuppression = installNativeTitleSuppression();
    expect(document.querySelector("button")?.hasAttribute("title")).toBe(false);

    const later = document.createElement("span");
    later.title = "Later";
    document.body.append(later);
    await flushMutationObserver();
    expect(later.hasAttribute("title")).toBe(false);
  });

  it("preserves the accessible name of frames and icon-only controls", async () => {
    stopSuppression = installNativeTitleSuppression();
    const frame = document.createElement("iframe");
    frame.title = "Document preview";
    const button = document.createElement("button");
    button.title = "Refresh";
    document.body.append(frame, button);
    await flushMutationObserver();

    expect(frame.getAttribute("aria-label")).toBe("Document preview");
    expect(button.getAttribute("aria-label")).toBe("Refresh");
    expect(document.querySelector("[title]")).toBeNull();
  });

  it("keeps custom hints and accessibility descriptions while removing native titles", async () => {
    document.body.innerHTML = '<button title="Native hint" aria-label="Accessible action" aria-describedby="help" aria-description="Action details" data-tooltip="Custom hint">Action</button><span id="help">Help</span>';
    stopSuppression = installNativeTitleSuppression();
    const button = document.querySelector("button")!;
    expect(button.hasAttribute("title")).toBe(false);
    expect(button.dataset.tooltip).toBe("Custom hint");
    expect(button.getAttribute("aria-label")).toBe("Accessible action");
    expect(button.getAttribute("aria-describedby")).toBe("help");
    expect(button.getAttribute("aria-description")).toBe("Action details");

    button.title = "Reintroduced by a third-party control";
    await flushMutationObserver();
    expect(button.hasAttribute("title")).toBe(false);
    expect(button.getAttribute("aria-label")).toBe("Accessible action");
  });

  it("removes SVG title bubbles while retaining their accessible name", async () => {
    stopSuppression = installNativeTitleSuppression();
    const container = document.createElement("div");
    container.innerHTML = '<svg><title>Provider icon</title><path /></svg>';
    document.body.append(container);
    await flushMutationObserver();

    const svg = document.querySelector("svg");
    expect(svg?.querySelector("title")).toBeNull();
    expect(svg?.getAttribute("aria-label")).toBe("Provider icon");
  });
});
