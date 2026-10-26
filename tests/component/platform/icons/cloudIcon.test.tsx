/** @vitest-environment happy-dom */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CLOUD_ICON_PATH, CloudIcon } from "../../../../packages/shared-ui/src/icons/productIcons";

function render(props: Parameters<typeof CloudIcon>[0] = {}) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<CloudIcon {...props} />);
  return host.querySelector("svg")!;
}

describe("product Cloud mark", () => {
  it("draws PuppyOne's own stroked cloud on the shared 24px icon grid", () => {
    const icon = render();
    expect(icon.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(icon.dataset.cloudIcon).toBe("puppyone");
    expect(icon.dataset.productIcon).toBe("cloud");
    expect(icon.querySelectorAll("path")).toHaveLength(1);
    expect(icon.querySelector("[data-cloud-outline]")!.getAttribute("d")).toBe(CLOUD_ICON_PATH);
    expect(icon.getAttribute("fill")).toBe("none");
    expect(icon.getAttribute("stroke")).toBe("currentColor");
    expect(icon.getAttribute("stroke-linejoin")).toBe("round");
    expect(icon.querySelector("image, use, filter, animate, linearGradient")).toBeNull();
  });

  it("is symmetric: a dome on two equal shoulders over a flat base", () => {
    const numbers = CLOUD_ICON_PATH.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    // Start and end points of the base mirror around x=12 on the same baseline.
    expect(numbers[0] + 17.2).toBeCloseTo(24, 6);
    expect(CLOUD_ICON_PATH).toMatch(/^M6\.8 19A3\.8 3\.8 /);
    expect(CLOUD_ICON_PATH).toMatch(/A3\.8 3\.8 0 1 1 17\.2 19Z$/);
  });

  it("shares the folder and laptop line weight, defaulting to 2 like them", () => {
    expect(render().getAttribute("stroke-width")).toBe("2");
    expect(render({ strokeWidth: 1.65 }).getAttribute("stroke-width")).toBe("1.65");
  });

  it.each([9, 14, 16, 24])("keeps the existing %ipx layout slot", (size) => {
    const icon = render({ size });
    expect(icon.getAttribute("width")).toBe(String(size));
    expect(icon.getAttribute("height")).toBe(String(size));
  });

  it("occludes what a linked badge overlaps inside its own silhouette", () => {
    const icon = render({ backplate: true, className: "onboarding-project-cloud-badge" });
    const backplate = icon.querySelector("[data-cloud-backplate]")!;
    expect(backplate.getAttribute("d")).toBe(CLOUD_ICON_PATH);
    expect(backplate.getAttribute("fill")).toBe("var(--po-surface)");
    expect(backplate.getAttribute("stroke")).toBe("none");
    expect(backplate.nextElementSibling).toBe(icon.querySelector("[data-cloud-outline]"));
    expect(icon.classList.contains("onboarding-project-cloud-badge")).toBe(true);
  });

  it("defaults to a decorative, unfocusable mark without duplicating its parent's label", () => {
    expect(render().getAttribute("aria-hidden")).toBe("true");
    expect(render().getAttribute("focusable")).toBe("false");
    const named = render({ "aria-label": "Cloud", role: "img" });
    expect(named.getAttribute("aria-hidden")).toBeNull();
    expect(named.getAttribute("aria-label")).toBe("Cloud");
  });
});
