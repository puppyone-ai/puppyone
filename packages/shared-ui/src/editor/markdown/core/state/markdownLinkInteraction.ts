import type {
  MarkdownLinkCommands,
  MarkdownLinkGraph,
  MarkdownWikiLinkResolvedTarget,
} from "../../../registry/viewerTypes";
import { isExternalMarkdownHref } from "../links/markdownLinkModel";
import { isSafeHref } from "../../platform/policy/markdownUrlPolicy";

export type MarkdownLinkInteractionKind = "same-document" | "workspace" | "external";

export type MarkdownLinkInteraction =
  | Readonly<{
      action: "navigate";
      kind: MarkdownLinkInteractionKind;
      resolvedTarget: MarkdownWikiLinkResolvedTarget | null;
    }>
  | Readonly<{
      action: "edit";
      resolvedTarget: MarkdownWikiLinkResolvedTarget | null;
    }>
  | Readonly<{
      action: "unavailable";
      reason: "unsafe" | "missing-capability" | "unresolved";
      resolvedTarget: MarkdownWikiLinkResolvedTarget | null;
    }>;

type ResolvedMarkdownLinkAction = Exclude<MarkdownLinkInteraction, { action: "edit" }>;

export type MarkdownLinkResolutionContext = Readonly<{
  documentPath: string;
  linkGraph: MarkdownLinkGraph | null;
  linkCommands: MarkdownLinkCommands;
  hasSameDocumentHeading: (fragment: string) => boolean;
  editing?: boolean;
}>;

/**
 * Canonical interaction policy for a rendered Markdown href. Projection and
 * event handling both consume this result, so ARIA, cursor, hover, and the
 * actual command cannot drift into separate definitions of "clickable".
 */
export function resolveMarkdownHrefInteraction(
  href: string,
  context: MarkdownLinkResolutionContext,
): MarkdownLinkInteraction {
  const value = href.trim();
  if (!isSafeHref(value)) return withEditing(unavailable("unsafe"), context.editing);

  if (value.startsWith("#")) {
    return withEditing(context.hasSameDocumentHeading(value)
      ? navigate("same-document", null)
      : unavailable("unresolved"), context.editing);
  }

  if (isExternalMarkdownHref(value)) {
    return withEditing(context.linkCommands.openExternalUrl
      ? navigate("external", null)
      : unavailable("missing-capability"), context.editing);
  }

  const resolvedTarget = context.linkGraph?.resolveMarkdownLink(context.documentPath, value) ?? null;
  if (!resolvedTarget?.exists) return withEditing(unavailable("unresolved", resolvedTarget), context.editing);
  if (!context.linkCommands.openWikiLink) {
    return withEditing(unavailable("missing-capability", resolvedTarget), context.editing);
  }
  return withEditing(navigate("workspace", resolvedTarget), context.editing);
}

export function resolveWikiLinkInteraction(
  target: string,
  context: MarkdownLinkResolutionContext,
): MarkdownLinkInteraction {
  const value = target.trim();
  if (value.startsWith("#")) {
    return withEditing(context.hasSameDocumentHeading(value)
      ? navigate("same-document", null)
      : unavailable("unresolved"), context.editing);
  }

  const resolvedTarget = context.linkGraph?.resolveWikiLink(context.documentPath, value) ?? null;
  if (!resolvedTarget?.exists) return withEditing(unavailable("unresolved", resolvedTarget), context.editing);
  if (!context.linkCommands.openWikiLink) {
    return withEditing(unavailable("missing-capability", resolvedTarget), context.editing);
  }
  return withEditing(navigate("workspace", resolvedTarget), context.editing);
}

function navigate(
  kind: MarkdownLinkInteractionKind,
  resolvedTarget: MarkdownWikiLinkResolvedTarget | null,
): Extract<ResolvedMarkdownLinkAction, { action: "navigate" }> {
  return { action: "navigate", kind, resolvedTarget };
}

function unavailable(
  reason: Extract<MarkdownLinkInteraction, { action: "unavailable" }>["reason"],
  resolvedTarget: MarkdownWikiLinkResolvedTarget | null = null,
): Extract<ResolvedMarkdownLinkAction, { action: "unavailable" }> {
  return { action: "unavailable", reason, resolvedTarget };
}

function withEditing(
  interaction: ResolvedMarkdownLinkAction,
  editing = false,
): MarkdownLinkInteraction {
  return editing
    ? { action: "edit", resolvedTarget: interaction.resolvedTarget }
    : interaction;
}

export type MarkdownLinkPointerActivation = Readonly<{
  href: string | null;
  wikiTarget: string | null;
}>;

type PendingPointerGesture = {
  activation: MarkdownLinkPointerActivation;
  documentRevision: string;
  clientX: number;
  clientY: number;
  selectionAnchor: number | null;
  cancelled: boolean;
};

const MAX_CLICK_MOVEMENT_PX = 4;

export type CompletedMarkdownLinkPointerGesture = Readonly<{
  activation: MarkdownLinkPointerActivation;
  restoreSelectionAt: number;
}>;

/** Pointer gesture state owned by exactly one Markdown EditorView. */
export class MarkdownLinkInteractionSession {
  private pending: PendingPointerGesture | null = null;
  private suppressNextClickUntil = 0;

  beginPointer(
    activation: MarkdownLinkPointerActivation,
    event: Pick<MouseEvent, "clientX" | "clientY">,
    selectionAnchor: number | null,
    documentRevision: string,
  ) {
    this.pending = {
      activation,
      documentRevision,
      clientX: event.clientX,
      clientY: event.clientY,
      selectionAnchor,
      cancelled: false,
    };
  }

  updatePointer(event: Pick<MouseEvent, "clientX" | "clientY">) {
    if (!this.pending) return;
    if (
      Math.abs(event.clientX - this.pending.clientX) > MAX_CLICK_MOVEMENT_PX
      || Math.abs(event.clientY - this.pending.clientY) > MAX_CLICK_MOVEMENT_PX
    ) {
      this.pending.cancelled = true;
    }
  }

  cancelPointer() {
    this.pending = null;
  }

  completePointer(
    selectionIsEmpty: boolean,
    documentRevision: string,
    releaseActivation: MarkdownLinkPointerActivation | null = null,
  ): CompletedMarkdownLinkPointerGesture | null {
    const pending = this.pending;
    this.pending = null;
    if (
      !pending
      || pending.cancelled
      || pending.selectionAnchor === null
      || !selectionIsEmpty
      || pending.documentRevision !== documentRevision
      || !releaseActivation
      || !sameActivation(pending.activation, releaseActivation)
    ) {
      return null;
    }
    return {
      activation: pending.activation,
      restoreSelectionAt: pending.selectionAnchor,
    };
  }

  recordHandledPointerUp(now = Date.now()) {
    this.suppressNextClickUntil = now + 700;
  }

  consumeDuplicateClick(now = Date.now()): boolean {
    if (this.suppressNextClickUntil < now) return false;
    this.suppressNextClickUntil = 0;
    return true;
  }
}

function sameActivation(
  left: MarkdownLinkPointerActivation,
  right: MarkdownLinkPointerActivation,
): boolean {
  return left.href === right.href && left.wikiTarget === right.wikiTarget;
}
