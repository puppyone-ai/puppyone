import type { MarkdownLocalization } from "../../core/editor/markdownLocalization";
import { mountSanitizedMermaidSvg, type MermaidSvgMount } from "./mermaidRenderer";

const DEFAULT_MIN_SCALE = 0.7;
const MIN_SCALE = 0.1;
const MAX_SCALE = 2;
const SCALE_STEP = 0.1;

export type MermaidViewportController = Readonly<{
  controls: HTMLElement;
  mount: (svg: string, openHref: (href: string) => void) => void;
  clear: () => void;
  destroy: () => void;
}>;

export function createMermaidViewportController({
  preview,
  t,
  onGeometryChange,
}: {
  preview: HTMLElement;
  t: MarkdownLocalization["t"];
  onGeometryChange: () => void;
}): MermaidViewportController {
  let activeMount: MermaidSvgMount | null = null;
  let zoomScale: number | null = null;

  const controls = document.createElement("div");
  controls.className = "cm-md-mermaid-zoom-controls";
  controls.hidden = true;

  const zoomOutButton = createZoomButton("−", t("editor.markdown.mermaid.zoomOut"));
  const zoomLevel = document.createElement("span");
  zoomLevel.className = "cm-md-mermaid-zoom-level";
  zoomLevel.textContent = "100%";
  zoomLevel.setAttribute("role", "status");
  zoomLevel.setAttribute("aria-live", "polite");
  const zoomInButton = createZoomButton("+", t("editor.markdown.mermaid.zoomIn"));
  const fitButton = createZoomButton(t("editor.markdown.mermaid.fit"), t("editor.markdown.mermaid.fitWidth"));
  fitButton.classList.add("is-fit");
  controls.append(zoomOutButton, zoomLevel, zoomInButton, fitButton);

  const getPreviewContentWidth = () => {
    const style = getComputedStyle(preview);
    const padding = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
    return Math.max(1, preview.clientWidth - (Number.isFinite(padding) ? padding : 0));
  };

  const getFitScale = (mount: MermaidSvgMount) => {
    if (!mount.intrinsicSize) return 1;
    return Math.min(1, getPreviewContentWidth() / mount.intrinsicSize.width);
  };

  const updateControls = () => {
    const available = activeMount?.intrinsicSize != null && zoomScale != null;
    controls.hidden = !available;
    if (!available || zoomScale == null) return;
    const percent = Math.round(zoomScale * 100);
    zoomLevel.textContent = `${percent}%`;
    zoomLevel.setAttribute("aria-label", t("editor.markdown.mermaid.zoomLevel", { percent }));
    zoomOutButton.disabled = zoomScale <= MIN_SCALE;
    zoomInButton.disabled = zoomScale >= MAX_SCALE;
  };

  const applyScale = (nextScale: number) => {
    const mount = activeMount;
    if (!mount?.intrinsicSize) return;
    const previousCenterRatio = getHorizontalCenterRatio(preview);
    zoomScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
    mount.setScale(zoomScale);
    restoreHorizontalCenter(preview, previousCenterRatio);
    updateControls();
    onGeometryChange();
  };

  zoomOutButton.onclick = (event) => {
    stopControlEvent(event);
    applyScale((zoomScale ?? 1) - SCALE_STEP);
  };
  zoomInButton.onclick = (event) => {
    stopControlEvent(event);
    applyScale((zoomScale ?? 1) + SCALE_STEP);
  };
  fitButton.onclick = (event) => {
    stopControlEvent(event);
    if (activeMount) applyScale(getFitScale(activeMount));
  };

  const clear = () => {
    activeMount?.dispose();
    activeMount = null;
    updateControls();
  };

  return Object.freeze({
    controls,
    mount(svg, openHref) {
      const previousCenterRatio = activeMount?.intrinsicSize
        ? getHorizontalCenterRatio(preview)
        : 0.5;
      activeMount?.dispose();
      activeMount = mountSanitizedMermaidSvg(preview, svg, openHref);
      activeMount.element.classList.add("cm-md-mermaid-svg-root");
      if (!activeMount.intrinsicSize) {
        zoomScale = null;
        updateControls();
        return;
      }

      zoomScale ??= Math.min(1, Math.max(DEFAULT_MIN_SCALE, getFitScale(activeMount)));
      activeMount.setScale(zoomScale);
      restoreHorizontalCenter(preview, previousCenterRatio);
      updateControls();
    },
    clear,
    destroy() {
      clear();
      controls.remove();
    },
  });
}

function createZoomButton(label: string, accessibleLabel: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "cm-md-mermaid-zoom-action";
  button.textContent = label;
  button.title = accessibleLabel;
  button.setAttribute("aria-label", accessibleLabel);
  return button;
}

function getHorizontalCenterRatio(preview: HTMLElement): number {
  return preview.scrollWidth > 0
    ? (preview.scrollLeft + preview.clientWidth / 2) / preview.scrollWidth
    : 0.5;
}

function restoreHorizontalCenter(preview: HTMLElement, centerRatio: number) {
  const nextScrollLeft = centerRatio * preview.scrollWidth - preview.clientWidth / 2;
  preview.scrollLeft = Math.max(0, Math.min(preview.scrollWidth - preview.clientWidth, nextScrollLeft));
}

function stopControlEvent(event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
}
