import { describe, expect, it, vi } from "vitest";
import { createTemplateIntentStore } from "../../../../electron/main/template-intent-store.mjs";

const origin = "https://www.puppyone.ai";
const templateId = "661ae398-24fb-5c14-ac58-83acea9f66e9";
const releaseId = "9c8ecc0c-08a8-5d4e-b3c6-c3ac4bb4e73e";
const storeLink = `${origin}/t/${templateId}?release=${releaseId}`;
const launchLink = `puppyone://templates/import?id=${templateId}&release=${releaseId}`;

function store() {
  let next = 0;
  return createTemplateIntentStore({ origin, channel: "stable", newId: () => `intent-${++next}` });
}
const live = (...ids) => (id) => ids.includes(id);

describe("template links waiting for a window", () => {
  it("keeps a link the store sent as its share link, and ignores anything else", () => {
    const intents = store();
    expect(intents.receive("https://evil.example/t/whatever")).toBeNull();
    expect(intents.pending).toBeNull();
    expect(intents.receive(launchLink)).toEqual({ id: "intent-1", url: storeLink, ownerId: null, copied: false });
  });

  it("lets a newer store link replace one that is still waiting", () => {
    const intents = store();
    const first = intents.receive(launchLink);
    const second = intents.receive(storeLink);
    expect(intents.assign(first, 1)).toBe(false);
    expect(intents.assign(second, 1)).toBe(true);
    expect(intents.read(1, live(1))).toEqual({ id: "intent-2", url: storeLink, copied: false });
  });

  it("does not read the clipboard while a link the store sent is waiting", () => {
    const intents = store();
    intents.receive(launchLink);
    const readText = vi.fn(() => storeLink);
    expect(intents.claimCopied(readText, 1)).toBe(false);
    expect(readText).not.toHaveBeenCalled();
    expect(intents.read(1, live(1))?.copied).toBe(false);
  });

  it("takes a copied store link for the window that asked, marked as copied", () => {
    const intents = store();
    expect(intents.claimCopied(() => `  ${storeLink}\n`, 7)).toBe(true);
    expect(intents.read(8, live(7, 8))).toBeNull();
    expect(intents.read(7, live(7, 8))).toEqual({ id: "intent-1", url: storeLink, copied: true });
  });

  it("leaves other clipboard text alone and waits for nothing", () => {
    const intents = store();
    for (const text of ["", "meeting notes", `see ${storeLink}`, "https://github.com/user/repo"]) {
      expect(intents.claimCopied(() => text, 1)).toBe(false);
    }
    expect(intents.pending).toBeNull();
  });

  it("passes a link on when the window it was handed to has closed", () => {
    const intents = store();
    const intent = intents.receive(launchLink);
    intents.assign(intent, 3);
    expect(intents.read(4, live(3, 4))).toBeNull();
    expect(intents.read(4, live(4))).toEqual({ id: "intent-1", url: storeLink, copied: false });
  });

  it("stops waiting once its own window has shown it, and not for anyone else", () => {
    const intents = store();
    intents.claimCopied(() => storeLink, 5);
    intents.acknowledge("intent-1", 6);
    intents.acknowledge("intent-0", 5);
    expect(intents.pending).not.toBeNull();
    intents.acknowledge("intent-1", 5);
    expect(intents.pending).toBeNull();
    expect(intents.read(5, live(5))).toBeNull();
  });
});
