/**
 * @vitest-environment happy-dom
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const stylesheetPath = path.resolve(
  testDirectory,
  "../../../../../packages/shared-ui/src/styles/editor/context-map-viewer.css",
);

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

describe("Context Map radial style geometry", () => {
  it("removes radial guide rings and the canvas dot grid", () => {
    const style = document.createElement("style");
    style.textContent = readFileSync(stylesheetPath, "utf8");
    document.head.appendChild(style);

    const canvas = document.createElement("div");
    canvas.className = "folder-relationship-canvas folder-relationship-radial-canvas";
    document.body.appendChild(canvas);

    expect(getComputedStyle(canvas).backgroundImage).toBe("none");
    expect(style.textContent).not.toContain("folder-relationship-radial-rings");
  });

  it("separates warm map-like references from the blue hierarchy lines", () => {
    const stylesheet = readFileSync(stylesheetPath, "utf8");

    expect(stylesheet).toMatch(
      /\.folder-relationship-radial-references path \{[^}]*opacity: 0\.42;[^}]*stroke: color-mix\(in srgb, var\(--po-warning\) 46%/,
    );
    expect(stylesheet).toContain(
      '.folder-relationship-radial-references path[data-bidirectional="true"]',
    );
    expect(stylesheet).toMatch(
      /\.folder-relationship-radial-hierarchy path \{[\s\S]*?stroke: color-mix\(in srgb, var\(--po-accent\)/,
    );
    expect(stylesheet).not.toContain("var(--po-purple)");
  });

  it("keeps hierarchy and reference paths substantial at overview scale", () => {
    const stylesheet = readFileSync(stylesheetPath, "utf8");

    expect(stylesheet).toMatch(
      /\.folder-relationship-radial-hierarchy path \{[\s\S]*?stroke-width: 3\.4px/,
    );
    expect(stylesheet).toMatch(
      /\.folder-relationship-radial-references path \{[\s\S]*?stroke-width: 2\.2px/,
    );
    expect(stylesheet).not.toMatch(
      /\.folder-relationship-(?:radial|layered)-references path \{[^}]*var\(--relationship-strength\)/,
    );
  });

  it("keeps radial cards out of document flow after the shared card rule is applied", () => {
    const style = document.createElement("style");
    style.textContent = readFileSync(stylesheetPath, "utf8");
    document.head.appendChild(style);

    const node = document.createElement("div");
    node.className = "folder-relationship-card folder-relationship-radial-node";
    node.style.left = "420px";
    node.style.top = "260px";
    document.body.appendChild(node);

    const computedStyle = getComputedStyle(node);
    expect(computedStyle.position).toBe("absolute");
    expect(computedStyle.left).toBe("420px");
    expect(computedStyle.top).toBe("260px");
    expect(computedStyle.transform).toBe("translate(-50%, -22px)");

    node.dataset.root = "true";
    expect(getComputedStyle(node).transform).toBe("translate(-50%, -50%)");
  });

  it("keeps radial folders visually unchanged when expanded", () => {
    const style = document.createElement("style");
    style.textContent = readFileSync(stylesheetPath, "utf8");
    document.head.appendChild(style);

    const node = document.createElement("button");
    node.className = "folder-relationship-card folder-relationship-radial-node";
    node.dataset.folder = "true";
    const hitarea = document.createElement("span");
    hitarea.className = "folder-relationship-card-hitarea";
    node.appendChild(hitarea);
    document.body.appendChild(node);

    const collapsedNodeStyle = getComputedStyle(node);
    const collapsedHitareaStyle = getComputedStyle(hitarea);
    const collapsedAppearance = {
      background: collapsedHitareaStyle.background,
      boxShadow: collapsedHitareaStyle.boxShadow,
      color: collapsedNodeStyle.color,
    };

    node.dataset.expanded = "true";

    const expandedNodeStyle = getComputedStyle(node);
    const expandedHitareaStyle = getComputedStyle(hitarea);
    expect({
      background: expandedHitareaStyle.background,
      boxShadow: expandedHitareaStyle.boxShadow,
      color: expandedNodeStyle.color,
    }).toEqual(collapsedAppearance);
  });

  it("uses a label cue instead of a rectangular focus frame on tree folders", () => {
    const stylesheet = readFileSync(stylesheetPath, "utf8");

    expect(stylesheet).toMatch(
      /\.folder-relationship-card\.folder-relationship-radial-node:focus-visible[\s\S]*?> \.folder-relationship-card-hitarea \{\s*outline: none;/,
    );
    expect(stylesheet).toMatch(
      /\.folder-relationship-card\.folder-relationship-radial-node:focus-visible[\s\S]*?\.folder-relationship-card-copy strong[\s\S]*?text-decoration: underline;/,
    );
  });

  it("keeps layered nodes absolutely positioned after the shared card rule", () => {
    const style = document.createElement("style");
    style.textContent = readFileSync(stylesheetPath, "utf8");
    document.head.appendChild(style);

    const node = document.createElement("button");
    node.className = "folder-relationship-card folder-relationship-layered-node";
    node.style.left = "320px";
    node.style.top = "248px";
    document.body.appendChild(node);

    const computedStyle = getComputedStyle(node);
    expect(computedStyle.position).toBe("absolute");
    expect(computedStyle.left).toBe("320px");
    expect(computedStyle.top).toBe("248px");
    expect(computedStyle.transform).toBe("translate(-50%, -22px)");
  });
});
