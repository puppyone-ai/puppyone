import type { DocumentNavigationPort } from "@puppyone/shared-ui";

/** Fixtures without navigation must still implement the Host's required port. */
export const unavailableDocumentNavigation: DocumentNavigationPort = Object.freeze({
  resolveReference: () => null,
  canOpenReference: () => false,
  openReference: () => { throw new Error("This test did not provide document navigation."); },
});
