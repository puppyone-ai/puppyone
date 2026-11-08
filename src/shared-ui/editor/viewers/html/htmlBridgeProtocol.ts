export type HtmlSelectionMessage = { type: "selection"; id: string; edit: boolean;
  reason: "focus" | "select" | "measure";
  anchor?: { x: number; y: number; width: number; height: number };
  rect: { x: number; y: number; width: number; height: number };
  clip: { top: number; right: number; bottom: number; left: number };
  styles: Record<string, string | boolean> };
export type HtmlBridgeMessage = { type: "viewport"; x: number; y: number } | HtmlSelectionMessage | { type: "ready"; ids: string[] }
  | { type: "pointer"; x: number; y: number }
  | { type: "hover"; x: number; y: number } | { type: "hover-end" }
  | { type: "style-check"; request: string; supported: boolean }
  | { type: "clear" } | { type: "history"; direction: "undo" | "redo" };

/** Bounds every field before frame data can affect host layout or command routing. */
export function decodeHtmlBridgeMessage(value: unknown): HtmlBridgeMessage | null {
  if (!value || typeof value !== "object") return null;
  const message = value as Record<string, unknown>;
  if (message.type === "style-check" && typeof message.request === "string" && message.request.length < 80
    && typeof message.supported === "boolean") return { type: "style-check", request: message.request, supported: message.supported };
  if ((message.type === "viewport" || message.type === "pointer" || message.type === "hover") && [message.x, message.y].every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 1e7)) return { type: message.type, x: message.x as number, y: message.y as number };
  if (message.type === "hover-end") return { type: "hover-end" };
  if (message.type === "clear") return { type: "clear" };
  if (message.type === "history" && (message.direction === "undo" || message.direction === "redo")) return { type: "history", direction: message.direction };
  if (message.type === "ready" && Array.isArray(message.ids) && message.ids.length <= 12000
    && message.ids.every((id) => typeof id === "string" && /^t[a-z0-9]{1,8}$/.test(id))) return { type: "ready", ids: message.ids };
  if (message.type !== "selection" || typeof message.id !== "string" || !/^t[a-z0-9]{1,8}$/.test(message.id)
    || typeof message.reason !== "string" || !["focus", "select", "measure"].includes(message.reason)
    || typeof message.edit !== "boolean" || !message.rect || typeof message.rect !== "object"
    || !message.clip || typeof message.clip !== "object"
    || !message.styles || typeof message.styles !== "object") return null;
  const rect = message.rect as HtmlSelectionMessage["rect"];
  const anchor = (message.anchor ?? rect) as HtmlSelectionMessage["rect"];
  if (!anchor || ![anchor.x, anchor.y, anchor.width, anchor.height].every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 1e7) || anchor.width < 0 || anchor.height < 0) return null;
  const clip = message.clip as HtmlSelectionMessage["clip"];
  if (![rect.x, rect.y, rect.width, rect.height].every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 1e7)
    || rect.width < 0 || rect.height < 0) return null;
  if (![clip.top, clip.right, clip.bottom, clip.left].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1e7)) return null;
  const styles: Record<string, string | boolean> = {};
  for (const name of ["fontFamily", "fontSize", "fontWeight", "lineHeight", "color", "backgroundColor", "textAlign",
    "letterSpacing", "fontStyle", "textTransform", "textDecoration", "padding", "borderRadius", "width", "height", "margin", "transformed"]) {
    const entry = (message.styles as Record<string, unknown>)[name];
    if (typeof entry === "string" && entry.length <= 256 || typeof entry === "boolean") styles[name] = entry;
  }
  return { type: "selection", id: message.id, edit: message.edit, reason: message.reason as HtmlSelectionMessage["reason"], anchor: { x: anchor.x, y: anchor.y, width: anchor.width, height: anchor.height }, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    clip: { top: clip.top, right: clip.right, bottom: clip.bottom, left: clip.left }, styles };
}

export type HtmlOpenDocumentMessage = Readonly<{
  type: "puppyone-html-open-document";
  channel: string;
  target: string;
}>;

const OPEN_DOCUMENT_TYPE = "puppyone-html-open-document";
const MAX_CHANNEL_LENGTH = 64;
const MAX_TARGET_LENGTH = 2048;

/**
 * The frame is untrusted content. It may only express "open this relative
 * path": the channel proves the message came from the script this host
 * injected, and the target is bounded before it reaches the navigation port.
 */
export function decodeHtmlOpenDocumentMessage(
  value: unknown,
  expectedChannel: string,
): HtmlOpenDocumentMessage | null {
  if (!value || typeof value !== "object") return null;
  const message = value as Record<string, unknown>;
  if (message.type !== OPEN_DOCUMENT_TYPE) return null;
  if (
    typeof message.channel !== "string"
    || message.channel.length === 0
    || message.channel.length > MAX_CHANNEL_LENGTH
    || message.channel !== expectedChannel
  ) return null;
  if (
    typeof message.target !== "string"
    || message.target.length === 0
    || message.target.length > MAX_TARGET_LENGTH
    || /[\u0000-\u001f\u007f\\]/u.test(message.target)
  ) return null;
  return Object.freeze({
    type: OPEN_DOCUMENT_TYPE,
    channel: message.channel,
    target: message.target,
  });
}
