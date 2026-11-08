import { randomUUID } from "node:crypto";
import { parseTemplateLink, templateLinkFromCopiedText, templateShareLink } from "../../shared/desktop/template-link.mjs";

/**
 * The one template link waiting for a window to show it.
 *
 * A link the store sent (a launch argument, an opened URL, a second launch)
 * replaces whatever was waiting. A link copied from the store page is only
 * looked for when nothing is waiting, so a link the store sent goes first.
 * A waiting link belongs to the window it was handed to, until that window
 * closes; then the next window to ask takes it.
 */
export function createTemplateIntentStore({ origin, channel, newId = randomUUID }) {
  const options = { origin, channel };
  let pending = null;
  return {
    get pending() { return pending; },
    /** A link from the store. Returns the waiting intent, or null for anything else. */
    receive(value) {
      let url;
      try { url = templateShareLink(parseTemplateLink(value, options), origin); } catch { return null; }
      pending = { id: newId(), url, ownerId: null, copied: false };
      return pending;
    },
    /** Hands a waiting intent to a window, unless a newer link replaced it meanwhile. */
    assign(intent, ownerId) {
      if (!intent || pending !== intent) return false;
      intent.ownerId = ownerId;
      return true;
    },
    /** Reads the clipboard only when nothing waits, and keeps only a whole store link. */
    claimCopied(readText, ownerId) {
      if (pending) return false;
      const url = templateLinkFromCopiedText(readText(), options);
      if (!url) return false;
      pending = { id: newId(), url, ownerId, copied: true };
      return true;
    },
    /** What a window may show: the waiting link, if it is this window's or no live window's. */
    read(senderId, isLiveWindow) {
      if (pending && pending.ownerId !== null && !isLiveWindow(pending.ownerId)) pending.ownerId = null;
      if (!pending || (pending.ownerId !== null && pending.ownerId !== senderId)) return null;
      pending.ownerId = senderId;
      return { id: pending.id, url: pending.url, copied: pending.copied };
    },
    /** The window has shown the card; the link stops waiting. */
    acknowledge(id, senderId) {
      if (pending?.id === id && pending.ownerId === senderId) pending = null;
    },
  };
}
