/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  CloudPublishProgressIndicator,
  formatCloudPublishTransfer,
} from "../../../../src/features/cloud/initialization/CloudPublishProgressIndicator";
import type { CloudPublishProgressStage, CloudPublishTransfer } from "../../../../src/types/electron";
import { testT, withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); });

const MB = 1000 ** 2;
const format = (value: number, options?: Intl.NumberFormatOptions) => new Intl.NumberFormat("en", options).format(value);

function render(stage: CloudPublishProgressStage, transfer: CloudPublishTransfer | null, paused = false) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(withTestLocalization(
    <CloudPublishProgressIndicator stage={stage} transfer={transfer} paused={paused} t={testT} keepOpenNote={false} />,
  )));
  return host;
}

const sending: CloudPublishTransfer = { percent: 45, sentBytes: 12.34 * MB, bytesPerSecond: 1.06 * MB };

describe("Cloud publish upload progress", () => {
  it("draws the upload's share, bytes and rate on the Upload row", () => {
    const host = render("uploading", sending);
    const row = host.querySelector("li[aria-current='step']")!;
    expect(row.querySelector("strong")?.textContent).toBe("Upload");
    expect(row.querySelector(".desktop-cloud-publish-transfer-reading")?.textContent).toBe("45% · 12.3 MB · 1.1 MB/s");
    const meter = row.querySelector<HTMLElement>(".desktop-cloud-publish-transfer")!;
    // The run's own meter, scoped to the row: same classes, so the same look.
    expect(meter.classList.contains("desktop-cloud-publish-progress-meter")).toBe(true);
    expect(meter.getAttribute("role")).toBe("progressbar");
    expect(meter.getAttribute("aria-valuenow")).toBe("45");
    expect(meter.getAttribute("aria-valuetext")).toBe("45% · 12.3 MB · 1.1 MB/s");
    expect(meter.style.getPropertyValue("--desktop-cloud-publish-progress")).toBe("0.45");
    // One meter per run plus one for the upload, and nothing else drawn.
    expect(host.querySelectorAll("[role=progressbar]")).toHaveLength(2);
  });

  it("keeps fast-changing numbers out of the live region", () => {
    const host = render("uploading", sending);
    expect(host.querySelector(".desktop-cloud-publish-transfer-reading")?.getAttribute("aria-live")).toBeNull();
    expect(host.querySelector("[aria-live]")).toBeNull();
  });

  it("claims no total and no time left, because Git cannot know them yet", () => {
    const host = render("uploading", sending);
    expect(host.textContent).not.toMatch(/\bof\b|left|remaining|ETA|min|sec/i);
  });

  it("says only the share before Git has measured bytes, and drops the rate once done", () => {
    expect(formatCloudPublishTransfer({ percent: 2, sentBytes: null, bytesPerSecond: null }, format)).toBe("2%");
    expect(formatCloudPublishTransfer({ percent: 100, sentBytes: 48 * MB, bytesPerSecond: MB }, format))
      .toBe("100% · 48 MB");
    expect(formatCloudPublishTransfer({ percent: 10, sentBytes: 640 * 1000, bytesPerSecond: 512 * 1000 }, format))
      .toBe("10% · 640 kB · 512 kB/s");
    expect(formatCloudPublishTransfer({ percent: 80, sentBytes: 1.25 * 1000 ** 3, bytesPerSecond: 999 }, format))
      .toBe("80% · 1.3 GB · 999 byte/s");
  });

  it("draws nothing extra outside a running upload", () => {
    // Another step, a paused run, or an upload Git has not started writing.
    const cases: Array<[CloudPublishProgressStage, CloudPublishTransfer | null, boolean]> = [
      ["creating-project", sending, false],
      ["uploading", sending, true],
      ["uploading", null, false],
    ];
    for (const [stage, transfer, paused] of cases) {
      const host = render(stage, transfer, paused);
      expect(host.querySelector(".desktop-cloud-publish-transfer")).toBeNull();
      expect(host.querySelector(".desktop-cloud-publish-transfer-reading")).toBeNull();
      act(() => root?.unmount());
      root = null;
    }
  });
});
