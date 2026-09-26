/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { CloudAgentCatalog } from "../../../../src/features/app-shell/auxiliary-workbench/CloudAgentCatalog";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

it("shows a brand mark for every Cloud Agent without extra onboarding copy", () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(withTestLocalization(<CloudAgentCatalog />)));

  const agentRows = container.querySelectorAll<HTMLElement>(
    ".desktop-cloud-agent-catalog-item[data-brand-id]",
  );
  expect(agentRows).toHaveLength(12);
  for (const row of agentRows) {
    const images = row.querySelectorAll<HTMLImageElement>(".po-agent-brand-image");
    expect(images.length, row.dataset.brandId).toBeGreaterThan(0);
    expect(images[0].getAttribute("src"), row.dataset.brandId).toContain("/assets/icons/agents/");
  }
  expect(container.querySelector(".desktop-cloud-agent-catalog-detail")).toBeNull();
  expect(container.querySelector(".desktop-cloud-agent-catalog-dot")).toBeNull();
  expect(container.querySelector(".desktop-cloud-agent-catalog-item.is-custom svg")).not.toBeNull();
  expect(container.querySelectorAll(".desktop-cloud-agent-catalog-item button")).toHaveLength(0);
});
