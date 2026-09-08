import type mermaid from "mermaid";
import type { MermaidConfig } from "mermaid";
import { getSafeMarkdownHref } from "../../platform/policy/markdownUrlPolicy";
import { subscribeTypographyChanges } from "../../../../core/typography";
import { bindInlineHtmlDomInteractions } from "../html/inlineHtmlDomAdapter";

type MermaidModule = typeof mermaid;

export type MermaidThemeSnapshot = {
  key: string;
  config: MermaidConfig;
};

export type MermaidRenderResult = {
  svg: string;
  cacheKey: string;
  themeKey: string;
};

export type MermaidSvgMount = Readonly<{
  element: HTMLElement;
  dispose: () => void;
}>;

export type MermaidRenderRequest = {
  source: string;
  theme?: MermaidThemeSnapshot;
};

export type MermaidDebouncedRenderRequest = MermaidRenderRequest & {
  delayMs?: number;
  onResult: (result: MermaidRenderResult) => void;
  onError: (error: Error) => void;
};

export type MermaidThemeChangeUnsubscribe = () => void;

const MERMAID_CACHE_LIMIT = 48;
export const MERMAID_MAX_SOURCE_BYTES = 128 * 1024;
export const MERMAID_MAX_SVG_BYTES = 4 * 1024 * 1024;

let mermaidModulePromise: Promise<MermaidModule> | null = null;
let mermaidRenderQueue: Promise<void> = Promise.resolve();
let initializedThemeKey = "";
let renderSequence = 0;
let themeObserver: MutationObserver | null = null;
let colorSchemeQuery: MediaQueryList | null = null;
let colorSchemeListener: (() => void) | null = null;
let themeNotificationFrame: number | null = null;
let typographyChangeUnsubscribe: (() => void) | null = null;

const svgCache = new Map<string, string>();
const themeChangeSubscribers = new Set<() => void>();

export function getMermaidThemeSnapshot(root: Element = document.documentElement): MermaidThemeSnapshot {
  const style = getComputedStyle(root);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const background = read("--po-editor-bg", "#ffffff");
  const panel = read("--po-panel", "#f7f3ec");
  const text = read("--po-text", "#2f2a24");
  const textMuted = read("--po-text-muted", "#8a8073");
  const accent = read("--po-accent", "#2563eb");
  const divider = read("--po-divider", "#ded4c7");
  const success = read("--po-success", "#16a34a");
  const warning = read("--po-warning", "#d97706");
  const danger = read("--po-danger", "#dc2626");
  const fontFamily = read(
    "--po-font-editor-content-user",
    read(
      "--po-editor-content-font",
      read("--po-font-content", read("--po-font-sans", "ui-sans-serif, system-ui, sans-serif")),
    ),
  );
  const isDark = isDarkColor(background);

  const config: MermaidConfig = {
    startOnLoad: false,
    securityLevel: "strict",
    suppressErrorRendering: true,
    theme: "base",
    darkMode: isDark,
    htmlLabels: false,
    fontFamily,
    themeVariables: {
      background,
      mainBkg: panel,
      secondBkg: background,
      tertiaryColor: panel,
      primaryColor: panel,
      primaryTextColor: text,
      primaryBorderColor: divider,
      secondaryColor: background,
      secondaryTextColor: text,
      secondaryBorderColor: divider,
      tertiaryTextColor: text,
      tertiaryBorderColor: divider,
      lineColor: textMuted,
      textColor: text,
      noteTextColor: text,
      noteBkgColor: panel,
      noteBorderColor: divider,
      edgeLabelBackground: background,
      clusterBkg: panel,
      clusterBorder: divider,
      defaultLinkColor: textMuted,
      nodeBorder: divider,
      actorBkg: panel,
      actorBorder: divider,
      actorTextColor: text,
      signalColor: textMuted,
      signalTextColor: text,
      labelBoxBkgColor: panel,
      labelBoxBorderColor: divider,
      labelTextColor: text,
      loopTextColor: text,
      activationBkgColor: panel,
      activationBorderColor: divider,
      sequenceNumberColor: background,
      pie1: accent,
      pie2: success,
      pie3: warning,
      pie4: danger,
      git0: accent,
      git1: success,
      git2: warning,
      git3: danger,
      fontFamily,
    },
  };

  return {
    config,
    key: JSON.stringify(config),
  };
}

export async function renderMermaidDiagram({
  source,
  theme = getMermaidThemeSnapshot(),
}: MermaidRenderRequest): Promise<MermaidRenderResult> {
  if (utf8ByteLength(source) > MERMAID_MAX_SOURCE_BYTES) {
    throw new Error("Mermaid source exceeds the render limit.");
  }
  const normalizedSource = normalizeMermaidSource(source);
  if (!normalizedSource) {
    throw new Error("Mermaid diagram is empty.");
  }

  const cacheKey = `${theme.key}\n${normalizedSource}`;
  const cachedSvg = svgCache.get(cacheKey);
  if (cachedSvg) {
    touchCacheEntry(cacheKey, cachedSvg);
    return {
      svg: cachedSvg,
      cacheKey,
      themeKey: theme.key,
    };
  }

  const sanitizedSvg = await enqueueMermaidRender(async () => {
    const mermaidInstance = await getMermaidModule();
    ensureMermaidInitialized(mermaidInstance, theme);

    const parseResult = await mermaidInstance.parse(normalizedSource, { suppressErrors: true });
    if (!parseResult) {
      throw new Error("Invalid Mermaid syntax.");
    }

    const { svg } = await mermaidInstance.render(createMermaidRenderId(), normalizedSource);
    if (utf8ByteLength(svg) > MERMAID_MAX_SVG_BYTES) {
      throw new Error("Mermaid SVG exceeds the render limit.");
    }
    return sanitizeMermaidSvg(svg);
  });
  setCacheEntry(cacheKey, sanitizedSvg);

  return {
    svg: sanitizedSvg,
    cacheKey,
    themeKey: theme.key,
  };
}

function enqueueMermaidRender<T>(render: () => Promise<T>): Promise<T> {
  const queuedRender = mermaidRenderQueue.then(render, render);
  mermaidRenderQueue = queuedRender.then(
    () => undefined,
    () => undefined,
  );
  return queuedRender;
}

export function createDebouncedMermaidRenderer() {
  let renderTimer: number | null = null;
  let requestId = 0;
  let disposed = false;

  return {
    render(request: MermaidDebouncedRenderRequest) {
      requestId += 1;
      const currentRequestId = requestId;
      if (renderTimer !== null) window.clearTimeout(renderTimer);

      renderTimer = window.setTimeout(() => {
        renderTimer = null;
        renderMermaidDiagram(request)
          .then((result) => {
            if (disposed || currentRequestId !== requestId) return;
            request.onResult(result);
          })
          .catch((error) => {
            if (disposed || currentRequestId !== requestId) return;
            request.onError(toError(error));
          });
      }, request.delayMs ?? 250);
    },
    cancel() {
      disposed = true;
      requestId += 1;
      if (renderTimer !== null) {
        window.clearTimeout(renderTimer);
        renderTimer = null;
      }
    },
  };
}

export function subscribeMermaidThemeChanges(callback: () => void): MermaidThemeChangeUnsubscribe {
  themeChangeSubscribers.add(callback);
  ensureMermaidThemeObserver();

  return () => {
    themeChangeSubscribers.delete(callback);
    if (themeChangeSubscribers.size === 0) disconnectMermaidThemeObserver();
  };
}

function normalizeMermaidSource(source: string): string {
  return source.replace(/\r\n?/g, "\n").trim();
}

async function getMermaidModule(): Promise<MermaidModule> {
  mermaidModulePromise ??= import("mermaid").then((module) => module.default);
  return mermaidModulePromise;
}

function ensureMermaidInitialized(mermaidInstance: MermaidModule, theme: MermaidThemeSnapshot) {
  if (initializedThemeKey === theme.key) return;
  mermaidInstance.initialize(theme.config);
  initializedThemeKey = theme.key;
}

function createMermaidRenderId(): string {
  renderSequence += 1;
  return `puppyone-mermaid-${Date.now()}-${renderSequence}`;
}

export function sanitizeMermaidSvg(svg: string): string {
  if (utf8ByteLength(svg) > MERMAID_MAX_SVG_BYTES) {
    throw new Error("Mermaid SVG exceeds the render limit.");
  }
  const template = document.createElement("template");
  template.innerHTML = svg;

  template.content.querySelectorAll([
    "script",
    "iframe",
    "object",
    "embed",
    "link",
    "meta",
    "base",
    "foreignObject",
    "animate",
    "animateMotion",
    "animateTransform",
    "set",
    "discard",
  ].join(",")).forEach((node) => node.remove());
  const localIds = new Set(
    Array.from(template.content.querySelectorAll<HTMLElement>("[id]"))
      .map((element) => element.id.trim())
      .filter((id) => /^[A-Za-z_][\w:.-]*$/.test(id)),
  );
  for (const element of Array.from(template.content.querySelectorAll("*"))) {
    if (element.tagName.toLowerCase() === "style") {
      if (containsUnsafeMermaidCss(element.textContent ?? "", localIds)) element.remove();
      continue;
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name === "href" || name === "xlink:href") {
        reduceMermaidSvgHref(element, attribute, localIds);
      } else if (
        (name === "style" || /^(?:fill|stroke|filter|clip-path|mask|marker(?:-start|-mid|-end)?)$/.test(name)) &&
        containsUnsafeMermaidCss(attribute.value, localIds)
      ) {
        element.removeAttribute(attribute.name);
      } else if (isUnsafeMermaidSvgAttribute(attribute)) {
        element.removeAttribute(attribute.name);
      }
    }
  }

  const sanitized = template.innerHTML;
  if (utf8ByteLength(sanitized) > MERMAID_MAX_SVG_BYTES) {
    throw new Error("Sanitized Mermaid SVG exceeds the render limit.");
  }
  return sanitized;
}

/**
 * Mounts a sanitized Mermaid fragment behind a Shadow DOM boundary.
 *
 * This is the shared presentation boundary for every read-only Mermaid
 * surface. Callers provide the only link-opening capability; the generated SVG
 * never receives a live external href and cannot inherit host-page CSS.
 */
export function mountSanitizedMermaidSvg(
  host: HTMLElement,
  svg: string,
  openHref: (href: string) => void = () => {},
): MermaidSvgMount {
  const renderRoot = document.createElement("span");
  renderRoot.className = "po-safe-mermaid-svg-root";
  const shadowRoot = renderRoot.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = ":host{display:block;max-width:100%}svg{display:block;max-width:100%;height:auto}";
  const template = document.createElement("template");
  template.innerHTML = sanitizeMermaidSvg(svg);
  shadowRoot.append(style, template.content);
  bindInlineHtmlDomInteractions(shadowRoot, { openHref });
  host.replaceChildren(renderRoot);
  return Object.freeze({
    element: renderRoot,
    dispose: () => {
      if (renderRoot.parentNode === host) renderRoot.remove();
    },
  });
}

function isUnsafeMermaidSvgAttribute(attribute: Attr): boolean {
  const name = attribute.name.toLowerCase();

  if (name.startsWith("on")) return true;
  if (name === "src" || name === "srcset") return true;
  return false;
}

function reduceMermaidSvgHref(element: Element, attribute: Attr, localIds: ReadonlySet<string>) {
  const value = attribute.value.trim();
  const ownerTagName = element.tagName.toLowerCase();

  // SVG paint references remain local to the already-sanitized fragment.
  // Anchor navigation is different: it is an activation capability and must
  // be routed through the same LinkBroker used by every other Markdown link.
  if (ownerTagName !== "a" && value.startsWith("#") && localIds.has(value.slice(1))) return;

  removeAttributeExactly(element, attribute);
  if (ownerTagName !== "a") return;
  const href = getSafeMarkdownHref(value);
  if (!href) return;
  element.setAttribute("data-md-href", href);
  element.setAttribute("role", "link");
  element.setAttribute("tabindex", "0");
}

function containsUnsafeMermaidCss(value: string, localIds: ReadonlySet<string>): boolean {
  if (/@import|expression\s*\(|behavior\s*:|-moz-binding|(?:https?|data|blob|file):|image-set\s*\(/i.test(value)) {
    return true;
  }
  let unsafeLocalReference = false;
  const withoutLocalReferences = value.replace(
    /url\(\s*(["']?)#([A-Za-z_][\w:.-]*)\1\s*\)/gi,
    (_match, _quote, id: string) => {
      if (!localIds.has(id)) unsafeLocalReference = true;
      return "";
    },
  );
  return unsafeLocalReference || /url\s*\(/i.test(withoutLocalReferences);
}

function removeAttributeExactly(element: Element, attribute: Attr) {
  if (attribute.namespaceURI) {
    element.removeAttributeNS(attribute.namespaceURI, attribute.localName);
    return;
  }
  element.removeAttribute(attribute.name);
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function ensureMermaidThemeObserver() {
  if (themeObserver) return;

  themeObserver = new MutationObserver(scheduleMermaidThemeChangeNotification);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style", "data-theme", "data-color-scheme"],
  });
  if (document.body) {
    themeObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme", "data-color-scheme"],
    });
  }

  if ("matchMedia" in window) {
    colorSchemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
    colorSchemeListener = scheduleMermaidThemeChangeNotification;
    colorSchemeQuery.addEventListener("change", colorSchemeListener);
  }
  typographyChangeUnsubscribe = subscribeTypographyChanges(document, scheduleMermaidThemeChangeNotification);
}

function disconnectMermaidThemeObserver() {
  themeObserver?.disconnect();
  themeObserver = null;
  if (colorSchemeQuery && colorSchemeListener) {
    colorSchemeQuery.removeEventListener("change", colorSchemeListener);
  }
  colorSchemeQuery = null;
  colorSchemeListener = null;
  typographyChangeUnsubscribe?.();
  typographyChangeUnsubscribe = null;
  if (themeNotificationFrame !== null) {
    window.cancelAnimationFrame(themeNotificationFrame);
    themeNotificationFrame = null;
  }
}

function scheduleMermaidThemeChangeNotification() {
  if (themeNotificationFrame !== null) return;

  themeNotificationFrame = window.requestAnimationFrame(() => {
    themeNotificationFrame = null;
    for (const callback of Array.from(themeChangeSubscribers)) callback();
  });
}

function setCacheEntry(cacheKey: string, svg: string) {
  svgCache.set(cacheKey, svg);
  while (svgCache.size > MERMAID_CACHE_LIMIT) {
    const oldestKey = svgCache.keys().next().value;
    if (!oldestKey) break;
    svgCache.delete(oldestKey);
  }
}

function touchCacheEntry(cacheKey: string, svg: string) {
  svgCache.delete(cacheKey);
  svgCache.set(cacheKey, svg);
}

function isDarkColor(value: string): boolean {
  const rgb = parseCssColor(value);
  if (!rgb) return false;
  const luminance = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  return luminance < 0.45;
}

function parseCssColor(value: string): { r: number; g: number; b: number } | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (hex) {
    const raw = hex[1];
    const normalized = raw.length === 3
      ? raw.split("").map((character) => `${character}${character}`).join("")
      : raw;
    return {
      r: Number.parseInt(normalized.slice(0, 2), 16),
      g: Number.parseInt(normalized.slice(2, 4), 16),
      b: Number.parseInt(normalized.slice(4, 6), 16),
    };
  }

  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(value.trim());
  if (!rgb) return null;

  return {
    r: Number.parseFloat(rgb[1]),
    g: Number.parseFloat(rgb[2]),
    b: Number.parseFloat(rgb[3]),
  };
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(String(error));
}
