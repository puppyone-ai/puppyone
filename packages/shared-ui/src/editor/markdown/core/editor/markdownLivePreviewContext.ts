import { EditorSelection, Facet, Prec, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { findWikiLinkTokens } from "../links/wikiLinkModel";
import { findMarkdownLinkTokens, isExternalMarkdownHref } from "../links/markdownLinkModel";
import { getMarkdownEmbedHost } from "../../platform/codemirror/embedHost";
import {
  createCapabilityPrincipal,
  workspaceIdForDocument,
  type CapabilityPrincipal,
  type CapabilityPurpose,
} from "../../platform/security/capabilityPrincipal";
import { getDocRevision } from "../../platform/brokers/transactionBroker";
import { getMarkdownHeadingPosition } from "../links/markdownHeadingIndex";
import {
  MarkdownLinkInteractionSession,
  resolveMarkdownHrefInteraction,
  resolveWikiLinkInteraction,
  type MarkdownLinkPointerActivation,
} from "../state/markdownLinkInteraction";
import {
  EMPTY_MARKDOWN_LINK_COMMANDS,
  type MarkdownAssetUrlResolver,
  type MarkdownHtmlTrustMode,
  type MarkdownLinkCommands,
  type MarkdownLinkGraph,
} from "../../../registry/viewerTypes";

export const markdownHtmlTrustModeFacet = Facet.define<MarkdownHtmlTrustMode, MarkdownHtmlTrustMode>({
  combine(values) {
    return values.length > 0 ? values[values.length - 1] : "safe";
  },
});

export const markdownLinkGraphFacet = Facet.define<MarkdownLinkGraph | null, MarkdownLinkGraph | null>({
  combine(values) {
    return values.length > 0 ? values[values.length - 1] : null;
  },
});

export const markdownLinkCommandsFacet = Facet.define<MarkdownLinkCommands, MarkdownLinkCommands>({
  combine(values) {
    return values.length > 0 ? values[values.length - 1] : EMPTY_MARKDOWN_LINK_COMMANDS;
  },
});

export const markdownDocumentPathFacet = Facet.define<string, string>({
  combine(values) {
    return values.length > 0 ? values[values.length - 1] : "";
  },
});

export const markdownAssetUrlResolverFacet = Facet.define<MarkdownAssetUrlResolver | null, MarkdownAssetUrlResolver | null>({
  combine(values) {
    return values.length > 0 ? values[values.length - 1] : null;
  },
});

export const markdownAssetResolverRevisionFacet = Facet.define<number, number>({
  combine(values) {
    return values.length > 0 ? values[values.length - 1] : 0;
  },
});

/**
 * Host-injected stable workspace identity. When empty, principals fall back to
 * `workspaceIdForDocument(documentPath)`.
 */
export const markdownWorkspaceIdFacet = Facet.define<string, string>({
  combine(values) {
    return values.length > 0 ? values[values.length - 1] : "";
  },
});

/** Host-injected workspace root used for asset-policy containment checks. */
export const markdownWorkspaceRootFacet = Facet.define<string | null, string | null>({
  combine(values) {
    return values.length > 0 ? values[values.length - 1] : null;
  },
});

export function markdownLivePreviewContextExtension(
  htmlTrustMode: MarkdownHtmlTrustMode,
  markdownLinkGraph: MarkdownLinkGraph | null,
  documentPath: string,
  markdownAssetUrlResolver: MarkdownAssetUrlResolver | null,
  workspaceId = "",
  workspaceRoot: string | null = null,
  markdownLinkCommands: MarkdownLinkCommands = EMPTY_MARKDOWN_LINK_COMMANDS,
  markdownAssetResolverRevision = 0,
): Extension {
  return [
    markdownHtmlTrustModeFacet.of(htmlTrustMode),
    markdownLinkGraphFacet.of(markdownLinkGraph),
    markdownLinkCommandsFacet.of(markdownLinkCommands),
    markdownDocumentPathFacet.of(documentPath),
    markdownAssetUrlResolverFacet.of(markdownAssetUrlResolver),
    markdownAssetResolverRevisionFacet.of(markdownAssetResolverRevision),
    markdownWorkspaceIdFacet.of(workspaceId),
    markdownWorkspaceRootFacet.of(workspaceRoot),
    markdownLinkInteractionPlugin,
    Prec.high(markdownLinkOpenHandler),
  ];
}

/**
 * Build a capability principal from live editor state. This is the single,
 * canonical way to mint a principal: it reads the host-injected workspace
 * identity facets, the per-view embed host id, and the current document
 * revision. Ad-hoc `"workspace"` / path-only principals are not permitted.
 */
export function createPrincipalFromView(
  view: EditorView,
  purpose: CapabilityPurpose,
  extra: { executionSessionId?: string } = {},
): CapabilityPrincipal {
  const documentPath = view.state.facet(markdownDocumentPathFacet);
  const workspaceId = view.state.facet(markdownWorkspaceIdFacet) || workspaceIdForDocument(documentPath);
  const host = getMarkdownEmbedHost(view);
  return createCapabilityPrincipal({
    editorViewId: host.viewId,
    workspaceId,
    documentPath,
    documentRevision: getDocRevision(view.state.doc),
    purpose,
    executionSessionId: extra.executionSessionId,
  });
}

/** Read the host-injected workspace root, if any. */
export function getMarkdownWorkspaceRoot(view: EditorView): string | null {
  return view.state.facet(markdownWorkspaceRootFacet);
}

class MarkdownLinkInteractionViewState extends MarkdownLinkInteractionSession {
  update(update: ViewUpdate) {
    if (update.docChanged) this.cancelPointer();
  }

  destroy() {
    this.cancelPointer();
  }
}

const markdownLinkInteractionPlugin = ViewPlugin.fromClass(MarkdownLinkInteractionViewState);

const markdownLinkOpenHandler = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0) return false;
    const linkElement = getMarkdownLinkElementFromEvent(event, view);
    const session = view.plugin(markdownLinkInteractionPlugin);
    if (!linkElement || view.composing) {
      session?.cancelPointer();
      return false;
    }
    const activation = getMarkdownLinkPointerActivation(linkElement);
    if (!activation) return false;
    const selection = view.state.selection;
    session?.beginPointer(
      activation,
      event,
      selection.ranges.length === 1 && selection.main.empty ? selection.main.anchor : null,
      getDocRevision(view.state.doc),
    );
    return false;
  },
  mousemove(event, view) {
    view.plugin(markdownLinkInteractionPlugin)?.updatePointer(event);
    return false;
  },
  mouseup(event, view) {
    if (event.button !== 0 || view.composing) return false;
    const selection = view.state.selection;
    const releaseElement = getMarkdownLinkCandidateFromEvent(event, view);
    const completed = view.plugin(markdownLinkInteractionPlugin)?.completePointer(
      selection.ranges.length === 1 && selection.main.empty,
      getDocRevision(view.state.doc),
      releaseElement ? getMarkdownLinkPointerActivation(releaseElement) : null,
    ) ?? null;
    if (!completed || !openMarkdownLinkActivation(completed.activation, view)) return false;
    if (
      completed.restoreSelectionAt <= view.state.doc.length
      && view.state.selection.main.anchor !== completed.restoreSelectionAt
    ) {
      view.dispatch({ selection: EditorSelection.cursor(completed.restoreSelectionAt) });
    }
    view.plugin(markdownLinkInteractionPlugin)?.recordHandledPointerUp();
    event.preventDefault();
    event.stopPropagation();
    return true;
  },
  mouseleave(_event, view) {
    view.plugin(markdownLinkInteractionPlugin)?.cancelPointer();
    return false;
  },
  blur(_event, view) {
    view.plugin(markdownLinkInteractionPlugin)?.cancelPointer();
    return false;
  },
  pointercancel(_event, view) {
    view.plugin(markdownLinkInteractionPlugin)?.cancelPointer();
    return false;
  },
  dragstart(_event, view) {
    view.plugin(markdownLinkInteractionPlugin)?.cancelPointer();
    return false;
  },
  click(event, view) {
    const session = view.plugin(markdownLinkInteractionPlugin);
    if (event.detail > 0) {
      if (session?.consumeDuplicateClick()) {
        event.preventDefault();
        event.stopPropagation();
        return true;
      }
      // Pointer activation is owned by the complete mousedown -> mouseup
      // gesture above. A standalone browser click must not bypass movement,
      // selection, revision, or release-target validation.
      return false;
    }
    return openMarkdownLinkFromEvent(event, view);
  },
  keydown(event, view) {
    if (event.key !== "Enter" || view.composing) return false;
    const linkElement = getMarkdownLinkElementFromEvent(event, view);
    if (!linkElement) return false;
    return openMarkdownLinkFromEvent(event, view);
  },
});

function openMarkdownLinkFromEvent(event: Event, view: EditorView): boolean {
  if (event.defaultPrevented) return false;
  const linkElement = getMarkdownLinkElementFromEvent(event, view);
  if (!linkElement) return false;

  const opened = openMarkdownLinkElement(linkElement, view);
  if (!opened) return false;

  event.preventDefault();
  event.stopPropagation();
  return true;
}

function getMarkdownLinkElementFromEvent(event: Event, view: EditorView): HTMLElement | null {
  const linkElement = getMarkdownLinkCandidateFromEvent(event, view);
  return linkElement?.dataset.mdLinkInteraction === "navigate" ? linkElement : null;
}

function getMarkdownLinkCandidateFromEvent(event: Event, view: EditorView): HTMLElement | null {
  const targetElement = getEventTargetElement(event.target);
  if (!targetElement) return null;

  const linkElement = targetElement.closest<HTMLElement>(
    ".cm-md-wiki-link-label[data-wiki-target], .cm-md-link-label[data-md-href], a.cm-md-inline-html[data-md-href], .cm-md-inline-html[data-md-href]",
  );
  if (
    !linkElement
    || !view.dom.contains(linkElement)
  ) return null;
  return linkElement;
}

function openMarkdownLinkElement(linkElement: HTMLElement, view: EditorView): boolean {
  if (linkElement.dataset.mdLinkInteraction !== "navigate") return false;
  const activation = getMarkdownLinkPointerActivation(linkElement);
  return activation ? openMarkdownLinkActivation(activation, view) : false;
}

function getMarkdownLinkPointerActivation(
  linkElement: HTMLElement,
): MarkdownLinkPointerActivation | null {
  const wikiTarget = linkElement.dataset.wikiTarget?.trim() || null;
  const href = linkElement.dataset.mdHref?.trim() || null;
  return wikiTarget || href ? { wikiTarget, href } : null;
}

function openMarkdownLinkActivation(
  activation: MarkdownLinkPointerActivation,
  view: EditorView,
): boolean {
  if (activation.wikiTarget) return openWikiLinkTarget(activation.wikiTarget, view);
  return activation.href ? openMarkdownHref(activation.href, view) : false;
}

function openWikiLinkTarget(wikiTarget: string, view: EditorView): boolean {
  const linkGraph = view.state.facet(markdownLinkGraphFacet);
  const linkCommands = view.state.facet(markdownLinkCommandsFacet);
  const sourcePath = view.state.facet(markdownDocumentPathFacet);
  const interaction = resolveWikiLinkInteraction(wikiTarget, {
    documentPath: sourcePath,
    linkGraph,
    linkCommands,
    hasSameDocumentHeading: (fragment) => getMarkdownHeadingPosition(view.state, fragment) !== null,
  });
  if (interaction.action !== "navigate") return false;
  if (interaction.kind === "same-document") return revealMarkdownHeading(view, wikiTarget);

  if (!interaction.resolvedTarget || !linkCommands.openWikiLink) return false;
  linkCommands.openWikiLink(interaction.resolvedTarget, sourcePath);
  return true;
}

export function openMarkdownHref(href: string, view: EditorView): boolean {
  const documentPath = view.state.facet(markdownDocumentPathFacet);
  const linkGraph = view.state.facet(markdownLinkGraphFacet);
  const linkCommands = view.state.facet(markdownLinkCommandsFacet);
  const interaction = resolveMarkdownHrefInteraction(href, {
    documentPath,
    linkGraph,
    linkCommands,
    hasSameDocumentHeading: (fragment) => getMarkdownHeadingPosition(view.state, fragment) !== null,
  });
  if (interaction.action !== "navigate") return false;
  if (interaction.kind === "same-document") return revealMarkdownHeading(view, href);

  const host = getMarkdownEmbedHost(view);
  const result = host.links.resolve(
    createPrincipalFromView(view, "link-open"),
    href,
  );

  if (result.action === "deny") return false;

  if (result.action === "navigate-internal") {
    const resolvedTarget = linkGraph?.resolveMarkdownLink(documentPath, result.path) ?? null;
    if (!resolvedTarget?.exists || !linkCommands.openWikiLink) return false;
    if (resolvedTarget.path === documentPath && resolvedTarget.heading) {
      return revealMarkdownHeading(view, `#${resolvedTarget.heading}`);
    }
    linkCommands.openWikiLink(resolvedTarget, documentPath);
    return true;
  }

  if (result.action === "open-external" || result.action === "confirm-external") {
    return openExternalMarkdownHref(result.href, view);
  }

  return false;
}

function revealMarkdownHeading(view: EditorView, fragment: string): boolean {
  const position = getMarkdownHeadingPosition(view.state, fragment);
  if (position === null) return false;
  view.dispatch({ effects: EditorView.scrollIntoView(position, { y: "start" }) });
  return true;
}

function openExternalMarkdownHref(href: string, view: EditorView): boolean {
  const linkCommands = view.state.facet(markdownLinkCommandsFacet);
  if (linkCommands.openExternalUrl) {
    void Promise.resolve().then(() => linkCommands.openExternalUrl?.(href)).catch((error) => {
      console.warn("Unable to open external Markdown link:", error);
    });
    return true;
  }
  // Shared editor code never falls back to ambient window authority. Desktop,
  // browser, and cloud hosts must inject an explicit external-link capability.
  return false;
}

function getEventTargetElement(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
}

export function findMarkdownLinkTokenAt(source: string, from: number, to: number): { href: string } | null {
  return findMarkdownLinkTokens(source).find((token) => token.from === from && token.to === to) ?? null;
}

export function findWikiLinkTokenAt(source: string, from: number, to: number): { target: string } | null {
  return findWikiLinkTokens(source).find((token) => token.from === from && token.to === to) ?? null;
}
