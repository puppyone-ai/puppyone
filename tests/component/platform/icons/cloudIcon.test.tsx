/** @vitest-environment happy-dom */
import { createHash } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CloudIcon } from "../../../../src/components/icons/CloudIcon";

function render(props: Parameters<typeof CloudIcon>[0] = {}) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<CloudIcon {...props} />);
  return host.querySelector("svg")!;
}

describe("approved Cloud identity mark", () => {
  it("preserves the official Ant Design outline without a redraw or remote asset", () => {
    const icon = render();
    expect(icon.getAttribute("viewBox")).toBe("0 0 1024 1024");
    expect(icon.dataset.cloudIcon).toBe("ant-design");
    expect(icon.querySelectorAll("path")).toHaveLength(1);
    const path = icon.querySelector("[data-cloud-outline]")!;
    // Exact outline from ant-design-icons@7f2516ac, not a self-derived snapshot.
    expect(createHash("sha256").update(path.getAttribute("d")!).digest("hex"))
      .toBe("66e8adae39ab0601fd441b81c20946034cc14c2c8b516e2bb8676f83794187e1");
    expect(path.getAttribute("fill")).toBe("currentColor");
    expect(icon.getAttribute("stroke")).toBe("none");
    expect(icon.querySelector("image, use, filter, animate, linearGradient")).toBeNull();
  });

  it.each([9, 14, 16, 24])("keeps the existing %ipx layout slot", (size) => {
    const icon = render({ size });
    expect(icon.getAttribute("width")).toBe(String(size));
    expect(icon.getAttribute("height")).toBe(String(size));
  });

  it("occludes the folder only inside the linked badge's original cloud contour", () => {
    const icon = render({ backplate: true, className: "onboarding-project-cloud-badge" });
    const outline = icon.querySelector("[data-cloud-outline]")!.getAttribute("d")!;
    const backplate = icon.querySelector("[data-cloud-backplate]")!;
    expect(backplate.getAttribute("d")).toBe(outline.slice(0, outline.indexOf("zm")) + "z");
    expect(backplate.getAttribute("fill")).toBe("var(--po-surface)");
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
