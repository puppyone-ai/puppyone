import type { EditorState } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import { bidiIsolate, type MessageFormatter } from "@puppyone/localization/core";
import type { MarkdownAssetUrlResolver, MarkdownHtmlTrustMode, MarkdownLinkGraph } from "../../../registry/viewerTypes";
import { markdownFeatureCompositionFacet } from "../features/markdownFeatureContract";
import {
  findMarkdownLinkTokens,
  isExternalMarkdownHref,
  type MarkdownLinkToken,
} from "../links/markdownLinkModel";
import { findWikiLinkTokens, type MarkdownWikiLinkToken } from "../links/wikiLinkModel";
import type { MarkdownElementPlan } from "../plans/markdownPlanTypes";
import type { IndexedMarkdownPlan } from "../plans/markdownPlanIndex";
import { isSafeHref } from "../../platform/policy/markdownHtmlSanitizerPolicy";
import type { MarkdownRevealedSourceRange } from "../state/revealedSource";
import { isInlineDecorationKind, type MarkdownElement } from "../syntax/markdownElements";
import { InlineHtmlLineBreakWidget } from "../widgets/inlineWidgets";
import {
  addReplacementDecoration,
  addSourceSyntaxDecoration,
  isRevealedInlineRange,
  reserveRange,
  type InlineRevealRange,
  type MarkdownDecorationBuilders,
  type OccupiedRange,
} from "./decorationPrimitives";
import { markdownLocalizationFacet } from "../editor/markdownLocalization";
import { markdownLinkCommandsFacet } from "../editor/markdownLivePreviewContext";
import { getMarkdownFragmentPosition } from "../links/markdownFragmentTargets";
import {
  resolveMarkdownHrefInteraction,
  resolveWikiLinkInteraction,
  type MarkdownLinkInteraction,
} from "../state/markdownLinkInteraction";

export function addInlineMarkdownDecorations(
  state: EditorState,
  lineFrom: number,
  text: string,
  builders: MarkdownDecorationBuilders,
  inlineRevealRange: InlineRevealRange | null,
  revealedSourceRange: MarkdownRevealedSourceRange | null,
  htmlTrustMode: MarkdownHtmlTrustMode,
  markdownLinkGraph: MarkdownLinkGraph | null,
  documentPath: string,
  markdownAssetUrlResolver: MarkdownAssetUrlResolver | null,
  linePlans: readonly IndexedMarkdownPlan[],
  initialOccupied: OccupiedRange[] = [],
) {
  const t = state.facet(markdownLocalizationFacet).t;
  const featureComposition = state.facet(markdownFeatureCompositionFacet);
  const occupied = [...initialOccupied];
  const lineTo = lineFrom + text.length;
  const entries = linePlans
    .filter(({ element, plan }) => (
      isInlineDecorationKind(element.kind)
      && plan.sourceRange.from <= lineTo
      && plan.sourceRange.to >= lineFrom
    ))
    .sort((left, right) => compareInlineDecorationPriority(left.element, right.element));
  const elements = entries.map(({ element }) => element);
  const tokenLookup = createInlineTokenLookup(text, elements);

  for (const { element, plan } of entries) {
    if (element.kind === "inlineHtml") {
      // A multi-line inline element intersects every physical line it spans.
      // Emit its range decorations exactly once, from the line that owns the
      // opening marker.
      if (element.from < lineFrom || element.from > lineTo) continue;
      addInlineHtmlElementDecoration(
        state,
        element,
        plan,
        builders,
        inlineRevealRange,
        markdownLinkGraph,
        documentPath,
      );
      continue;
    }

    const expandedFeatureAtom = (
      plan.presentation === "inlineAtom"
      && plan.capabilities.expand
      && revealedSourceRange?.presentation === "inline"
      && revealedSourceRange.from === plan.sourceRange.from
      && revealedSourceRange.to === plan.sourceRange.to
    );
    const featureWidget = plan.presentation === "inlineAtom" && !expandedFeatureAtom
      ? featureComposition?.createInlineWidget(plan, {
          htmlTrustMode,
          markdownLinkGraph,
          documentPath,
          markdownAssetUrlResolver,
        }) ?? null
      : null;
    if (featureWidget) {
      if (!reserveRange(occupied, plan.sourceRange.from, plan.sourceRange.to)) continue;
      addReplacementDecoration(
        builders,
        Decoration.replace({ widget: featureWidget, inclusive: false }),
        plan.sourceRange.from,
        plan.sourceRange.to,
      );
      continue;
    }
    if (expandedFeatureAtom) continue;

    const overlapsExclusiveRange = occupied.some((range) => (
      element.from < range.to && element.to > range.from
    ));
    if (overlapsExclusiveRange) continue;

    switch (element.kind) {
      case "wikiLink":
        addWikiLinkElementDecoration(state, element, lineFrom, tokenLookup, builders, inlineRevealRange, markdownLinkGraph, documentPath, t);
        break;
      case "link":
        addLinkElementDecoration(state, element, lineFrom, text, tokenLookup, builders, inlineRevealRange, markdownLinkGraph, documentPath, t);
        break;
      case "strong":
        addDelimitedInlineElementDecoration(element, builders, inlineRevealRange, "cm-md-syntax-strong");
        break;
      case "emphasis":
        addDelimitedInlineElementDecoration(element, builders, inlineRevealRange, "cm-md-syntax-emphasis");
        break;
      case "inlineCode":
        addDelimitedInlineElementDecoration(element, builders, inlineRevealRange, "cm-md-syntax-monospace");
        break;
      case "strike":
        addDelimitedInlineElementDecoration(element, builders, inlineRevealRange, "cm-md-syntax-strikethrough");
        break;
      case "escape":
        addEscapeElementDecoration(element, builders);
        break;
      default:
        break;
    }
  }
}

type InlineTokenLookup = {
  linksByFrom: ReadonlyMap<number, MarkdownLinkToken>;
  wikiLinksByFrom: ReadonlyMap<number, MarkdownWikiLinkToken>;
};

function createInlineTokenLookup(
  text: string,
  elements: readonly MarkdownElement[],
): InlineTokenLookup {
  const kinds = new Set(elements.map((element) => element.kind));
  return {
    linksByFrom: kinds.has("link")
      ? new Map(findMarkdownLinkTokens(text).map((token) => [token.from, token]))
      : new Map(),
    wikiLinksByFrom: kinds.has("wikiLink")
      ? new Map(findWikiLinkTokens(text).map((token) => [token.from, token]))
      : new Map(),
  };
}

function compareInlineDecorationPriority(left: MarkdownElement, right: MarkdownElement): number {
  const priority = (element: MarkdownElement): number => {
    switch (element.kind) {
      case "image":
      case "mathInline":
        return 0;
      case "inlineHtml":
        return 1;
      case "wikiLink":
        return 2;
      case "link":
        return 3;
      case "inlineCode":
        return 4;
      case "strong":
        return 5;
      case "strike":
        return 6;
      case "emphasis":
        return 7;
      case "escape":
        return 8;
      default:
        return 9;
    }
  };

  return priority(left) - priority(right) || left.from - right.from || right.to - left.to;
}

function addInlineHtmlElementDecoration(
  state: EditorState,
  element: MarkdownElement,
  plan: MarkdownElementPlan,
  builders: MarkdownDecorationBuilders,
  inlineRevealRange: InlineRevealRange | null,
  markdownLinkGraph: MarkdownLinkGraph | null,
  documentPath: string,
) {
  if (element.kind !== "inlineHtml") return;
  applyInlineHtmlPlan(
    state,
    plan,
    builders,
    inlineRevealRange,
    markdownLinkGraph,
    documentPath,
  );
}

function applyInlineHtmlPlan(
  state: EditorState,
  plan: MarkdownElementPlan,
  builders: MarkdownDecorationBuilders,
  inlineRevealRange: InlineRevealRange | null,
  markdownLinkGraph: MarkdownLinkGraph | null,
  documentPath: string,
) {
  if (plan.presentation === "visibleSource") return;

  const revealSourceSyntax = isRevealedInlineRange(
    plan.sourceRange.from,
    plan.sourceRange.to,
    inlineRevealRange,
  );

  if (plan.presentation === "inlineAtom" && plan.atom.kind === "lineBreak") {
    if (!revealSourceSyntax) {
      addReplacementDecoration(
        builders,
        Decoration.replace({
          widget: new InlineHtmlLineBreakWidget(plan.layout.lineBreaks),
          inclusive: false,
        }),
        plan.sourceRange.from,
        plan.sourceRange.to,
      );
    } else {
      addSourceSyntaxDecoration(
        builders,
        plan.sourceRange.from,
        plan.sourceRange.to,
        "inline-html",
        true,
      );
    }
    return;
  }

  if (plan.presentation !== "inlineMark" || plan.mark.kind !== "inlineHtmlMark") return;

  for (const markerRange of plan.markerRanges) {
    addSourceSyntaxDecoration(builders, markerRange.from, markerRange.to, "inline-html", revealSourceSyntax);
  }

  if (plan.contentRange.from >= plan.contentRange.to) return;
  const attributes = { ...plan.mark.attributes };
  const href = attributes["data-md-href"];
  if (href) {
    delete attributes.role;
    delete attributes.tabindex;
    delete attributes["aria-disabled"];
    Object.assign(attributes, getMarkdownLinkInteractionAttributes(
      resolveMarkdownHrefInteraction(href, {
        documentPath,
        linkGraph: markdownLinkGraph,
        linkCommands: state.facet(markdownLinkCommandsFacet),
        hasSameDocumentTarget: (fragment) => getMarkdownFragmentPosition(state, fragment) !== null,
        editing: revealSourceSyntax,
      }),
    ));
  }
  builders.decorations.push(
    Decoration.mark({
      tagName: plan.mark.tagName,
      class: plan.mark.className ?? "cm-md-inline-html",
      attributes,
      inclusive: false,
    }).range(plan.contentRange.from, plan.contentRange.to),
  );
}

function addDelimitedInlineElementDecoration(
  element: MarkdownElement,
  builders: MarkdownDecorationBuilders,
  inlineRevealRange: InlineRevealRange | null,
  contentClass: string,
) {
  const contentRange = element.contentRange;
  if (!contentRange || contentRange.from >= contentRange.to) return;

  const revealSourceSyntax = isRevealedInlineRange(element.from, element.to, inlineRevealRange);
  for (const markerRange of element.markerRanges) {
    addSourceSyntaxDecoration(builders, markerRange.from, markerRange.to, "delimiter", revealSourceSyntax);
  }
  builders.decorations.push(Decoration.mark({ class: contentClass }).range(contentRange.from, contentRange.to));
}

function addEscapeElementDecoration(element: MarkdownElement, builders: MarkdownDecorationBuilders) {
  for (const markerRange of element.markerRanges) {
    addSourceSyntaxDecoration(builders, markerRange.from, markerRange.to, "escape", false);
  }
}

function addWikiLinkElementDecoration(
  state: EditorState,
  element: MarkdownElement,
  lineFrom: number,
  tokenLookup: InlineTokenLookup,
  builders: MarkdownDecorationBuilders,
  inlineRevealRange: InlineRevealRange | null,
  markdownLinkGraph: MarkdownLinkGraph | null,
  documentPath: string,
  t: MessageFormatter,
) {
  const candidate = tokenLookup.wikiLinksByFrom.get(element.from - lineFrom);
  const token = candidate && lineFrom + candidate.to === element.to ? candidate : null;
  if (!token || !element.contentRange || element.contentRange.from >= element.contentRange.to) return;

  const resolvedTarget = markdownLinkGraph?.resolveWikiLink(documentPath, token.target) ?? null;
  const revealSourceSyntax = isRevealedInlineRange(element.from, element.to, inlineRevealRange);
  const interaction = resolveWikiLinkInteraction(token.target, {
    documentPath,
    linkGraph: markdownLinkGraph,
    linkCommands: state.facet(markdownLinkCommandsFacet),
    hasSameDocumentTarget: (fragment) => getMarkdownFragmentPosition(state, fragment) !== null,
    editing: revealSourceSyntax,
  });
  const classes = [
    "cm-md-syntax-link",
    "cm-md-wiki-link-label",
    resolvedTarget?.exists ? "is-resolved" : "",
    interaction.action === "unavailable" && interaction.reason === "unresolved" ? "is-missing" : "",
    resolvedTarget?.ambiguous ? "is-ambiguous" : "",
  ].filter(Boolean).join(" ");
  const linkTitle = getWikiLinkTitle(resolvedTarget, token.target, t);

  addInlineSourceSyntaxDecorations(builders, element, revealSourceSyntax);
  builders.decorations.push(
    Decoration.mark({
      class: classes,
      attributes: {
        "data-wiki-target": token.target,
        ...getMarkdownLinkInteractionAttributes(interaction),
        "aria-label": linkTitle,
        title: getMarkdownInteractionTitle(interaction, linkTitle, t),
      },
    }).range(element.contentRange.from, element.contentRange.to),
  );
}

function addLinkElementDecoration(
  state: EditorState,
  element: MarkdownElement,
  lineFrom: number,
  text: string,
  tokenLookup: InlineTokenLookup,
  builders: MarkdownDecorationBuilders,
  inlineRevealRange: InlineRevealRange | null,
  markdownLinkGraph: MarkdownLinkGraph | null,
  documentPath: string,
  t: MessageFormatter,
) {
  if (!element.contentRange || element.contentRange.from >= element.contentRange.to) return;

  const candidate = tokenLookup.linksByFrom.get(element.from - lineFrom);
  const token = candidate && lineFrom + candidate.to === element.to ? candidate : null;
  const href = token?.href ?? getAutolinkHref(element, lineFrom, text);
  if (!href) return;

  const resolvedTarget = markdownLinkGraph?.resolveMarkdownLink(documentPath, href) ?? null;
  const revealSourceSyntax = isRevealedInlineRange(element.from, element.to, inlineRevealRange);
  const interaction = resolveMarkdownHrefInteraction(href, {
    documentPath,
    linkGraph: markdownLinkGraph,
    linkCommands: state.facet(markdownLinkCommandsFacet),
    hasSameDocumentTarget: (fragment) => getMarkdownFragmentPosition(state, fragment) !== null,
    editing: revealSourceSyntax,
  });
  const linkClasses = [
    "cm-md-syntax-link",
    "cm-md-link-label",
    resolvedTarget ? "cm-md-document-link-label" : "",
    resolvedTarget?.exists ? "is-resolved" : "",
    resolvedTarget && !resolvedTarget.exists ? "is-missing" : "",
    interaction.action === "unavailable" && interaction.reason === "unresolved" ? "is-missing" : "",
    resolvedTarget?.ambiguous ? "is-ambiguous" : "",
    isExternalMarkdownHref(href) && isSafeHref(href) ? "is-external" : "",
  ].filter(Boolean).join(" ");
  const linkTitle = getMarkdownLinkTitle(resolvedTarget, href, t);

  addInlineSourceSyntaxDecorations(builders, element, revealSourceSyntax);
  builders.decorations.push(
    Decoration.mark({
      class: linkClasses,
      attributes: {
        "data-md-href": href,
        ...getMarkdownLinkInteractionAttributes(interaction),
        "aria-label": linkTitle,
        title: getMarkdownInteractionTitle(interaction, linkTitle, t),
      },
    }).range(element.contentRange.from, element.contentRange.to),
  );
}

function getMarkdownLinkInteractionAttributes(
  interaction: MarkdownLinkInteraction,
): Record<string, string> {
  if (interaction.action === "navigate") {
    return {
      "data-md-link-interaction": "navigate",
      "data-po-content-interaction": "navigation",
      role: "link",
      tabindex: "0",
    };
  }
  if (interaction.action === "edit") {
    return {
      "data-md-link-interaction": "edit",
      "data-po-content-interaction": "text",
    };
  }
  return {
    "data-md-link-interaction": "unavailable",
    "data-po-content-interaction": "text",
    "data-md-link-unavailable-reason": interaction.reason,
  };
}

function getAutolinkHref(element: MarkdownElement, lineFrom: number, text: string): string | null {
  if (!element.contentRange || text[element.from - lineFrom] !== "<") return null;
  const href = text.slice(element.contentRange.from - lineFrom, element.contentRange.to - lineFrom).trim();
  return href || null;
}

function addInlineSourceSyntaxDecorations(
  builders: MarkdownDecorationBuilders,
  element: MarkdownElement,
  revealSourceSyntax: boolean,
) {
  const contentRange = element.contentRange;
  if (!contentRange) return;

  addSourceSyntaxDecoration(builders, element.from, contentRange.from, element.kind === "wikiLink" ? "wiki-link" : "link", revealSourceSyntax);
  addSourceSyntaxDecoration(builders, contentRange.to, element.to, element.kind === "wikiLink" ? "wiki-link" : "link", revealSourceSyntax);
}

function getMarkdownOpenTitle(target: string, t: MessageFormatter): string {
  return t("editor.markdown.openLinkHint", { target: bidiIsolate(target) });
}

function getMarkdownInteractionTitle(
  interaction: MarkdownLinkInteraction,
  target: string,
  t: MessageFormatter,
): string {
  return interaction.action === "navigate" ? getMarkdownOpenTitle(target, t) : target;
}

function getWikiLinkTitle(
  resolvedTarget: ReturnType<MarkdownLinkGraph["resolveWikiLink"]> | null,
  target: string,
  t: MessageFormatter,
): string {
  if (!resolvedTarget) return target;
  if (!resolvedTarget.exists) {
    return t("editor.markdown.missingLinkedNote", { target: bidiIsolate(target) });
  }
  if (resolvedTarget.ambiguous) {
    return t("editor.markdown.ambiguousLinkedNote", {
      path: bidiIsolate(resolvedTarget.path ?? target),
    });
  }
  return resolvedTarget.path ?? target;
}

function getMarkdownLinkTitle(
  resolvedTarget: ReturnType<MarkdownLinkGraph["resolveMarkdownLink"]> | null,
  href: string,
  t: MessageFormatter,
): string {
  if (!resolvedTarget) return href;
  if (!resolvedTarget.exists) {
    return t("editor.markdown.missingLinkedNote", { target: bidiIsolate(href) });
  }
  if (resolvedTarget.ambiguous) {
    return t("editor.markdown.ambiguousLinkedNote", {
      path: bidiIsolate(resolvedTarget.path ?? href),
    });
  }
  return resolvedTarget.path ?? href;
}
