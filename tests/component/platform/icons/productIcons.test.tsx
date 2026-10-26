/** @vitest-environment happy-dom */
import { FolderClosed, Laptop } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import {
  CloudIcon,
  CloudOffIcon,
  CloudUploadIcon,
  DisclosureIcon,
  FOLDER_ICON_PATHS,
  FolderIcon,
  HOME_ICON_PATH,
  HomeIcon,
  LocalIcon,
  PRODUCT_ICONS,
} from "../../../../packages/shared-ui/src/icons/productIcons";
import { FileGlyphIcon, FilePreviewIcon } from "../../../../packages/shared-ui/src/file/fileIcons";

function svg(element: ReactElement) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(element);
  return host.querySelector("svg")!;
}

const paths = (element: SVGElement) => [...element.querySelectorAll("path")].map((path) => path.getAttribute("d"));

describe("product icons", () => {
  it("states every product meaning with exactly one drawing", () => {
    expect(Object.keys(PRODUCT_ICONS).sort()).toEqual(["cloud", "cloud-off", "cloud-upload", "disclosure", "folder", "home", "local"]);
    for (const [meaning, Icon] of Object.entries(PRODUCT_ICONS)) {
      expect(svg(<Icon size={16} />).dataset.productIcon).toBe(meaning);
    }
  });

  it("draws a folder as the hollow closed folder", () => {
    const folder = svg(<FolderIcon size={14} />);
    expect(paths(folder)).toEqual(paths(svg(<FolderClosed />)));
    expect(paths(folder)).toEqual([...FOLDER_ICON_PATHS]);
    expect(folder.getAttribute("fill")).toBe("none");
  });

  it("draws this computer as the hollow laptop", () => {
    const local = svg(<LocalIcon size={14} strokeWidth={1.6} />);
    expect(paths(local)).toEqual(paths(svg(<Laptop />)));
    expect(local.getAttribute("fill")).toBe("none");
    expect(local.getAttribute("stroke-width")).toBe("1.6");
  });

  it("draws home as one open-door outline whose door posts run into the ground", () => {
    const home = svg(<HomeIcon size={16} />);
    expect(paths(home)).toEqual([HOME_ICON_PATH]);
    expect(home.getAttribute("fill")).toBe("none");
    // The outline starts at the foot of the right door post and closes back
    // down it, so no base segment runs beneath the door (x 9..15 at y 21).
    expect(HOME_ICON_PATH.startsWith("M15 21h4")).toBe(true);
    expect(HOME_ICON_PATH).toContain("2 2h4v-8");
    expect(HOME_ICON_PATH.endsWith("z")).toBe(true);
    expect(HOME_ICON_PATH.match(/M/gi)).toHaveLength(1);
  });

  it("weights the house optically to match the laptop at the same stroke width", () => {
    const local = svg(<LocalIcon size={16} strokeWidth={1.65} />);
    const home = svg(<HomeIcon size={16} strokeWidth={1.65} />);
    expect(local.getAttribute("stroke-width")).toBe("1.65");
    expect(Number(home.getAttribute("stroke-width"))).toBeCloseTo(1.815, 3);
    expect(Number(svg(<HomeIcon />).getAttribute("stroke-width"))).toBeCloseTo(2.2, 3);
  });

  it("gives the file-tree folder the product folder shape", () => {
    for (const icon of [
      svg(<FileGlyphIcon name="notes" type="folder" size={18} />),
      svg(<FilePreviewIcon name="notes" type="folder" size={64} />),
    ]) {
      expect(icon.dataset.productIcon).toBe("folder");
      expect(paths(icon)).toEqual([...FOLDER_ICON_PATHS]);
    }
  });

  it("builds every Cloud variant on the one product cloud outline", () => {
    const outline = svg(<CloudIcon />).querySelector("[data-cloud-outline]")!.getAttribute("d");
    for (const Variant of [CloudUploadIcon, CloudOffIcon]) {
      const icon = svg(<Variant size={16} />);
      expect(icon.dataset.cloudIcon).toBe("puppyone");
      expect(icon.querySelector("[data-cloud-outline]")!.getAttribute("d")).toBe(outline);
      expect(icon.querySelector("[data-cloud-mark]")).not.toBeNull();
      expect(icon.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it.each([10, 12, 13, 14])("draws the same 7px disclosure chevron with a 1.25px line in a %ipx box", (size) => {
    const icon = svg(<DisclosureIcon size={size} />);
    const scale = size / 24;
    const points = icon.querySelector("path")!.getAttribute("d")!.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    const ys = [points[1], points[3], points[5]].map((y) => y * scale);
    const xs = [points[0], points[2], points[4]].map((x) => x * scale);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(7, 2);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(3.5, 2);
    expect(Number(icon.getAttribute("stroke-width")) * scale).toBeCloseTo(1.25, 2);
    expect(icon.getAttribute("width")).toBe(String(size));
  });

  it("points a controlled disclosure down when expanded and leaves native details to CSS", () => {
    const open = svg(<DisclosureIcon expanded className="tree-disclosure-marker" />);
    expect(open.getAttribute("style")).toContain("rotate(90deg)");
    expect(open.dataset.expanded).toBe("true");
    expect(open.classList.contains("po-disclosure-icon")).toBe(true);
    expect(open.classList.contains("tree-disclosure-marker")).toBe(true);
    const closed = svg(<DisclosureIcon expanded={false} />);
    expect(closed.getAttribute("style")).toBeNull();
    expect(closed.dataset.expanded).toBe("false");
    const native = svg(<DisclosureIcon />);
    expect(native.hasAttribute("data-expanded")).toBe(false);
    expect(native.getAttribute("aria-hidden")).toBe("true");
  });

  it("cuts the unreachable Cloud's slash with a mask that stays unique per instance", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<><CloudOffIcon /><CloudOffIcon /></>);
    const masks = [...host.querySelectorAll("mask")].map((mask) => mask.id);
    expect(masks).toHaveLength(2);
    expect(new Set(masks).size).toBe(2);
    for (const id of masks) {
      expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(host.querySelector(`[mask="url(#${id})"]`)).not.toBeNull();
    }
  });
});
