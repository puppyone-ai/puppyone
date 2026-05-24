export const APP_Z_INDEX = {
  // Persistent app chrome: headers, sidebars, and action slots.
  // Dialogs must not compete with this layer; they render through a
  // body portal at `modal` / `modalNested`.
  chrome: 500,
  chromeRaised: 501,

  // Floating menus anchored to chrome/content controls.
  popover: 10000,
  popoverNested: 10001,

  // Blocking surfaces. Use ModalPortal so parent stacking contexts
  // cannot trap the backdrop under page chrome.
  modal: 11000,
  modalNested: 11001,

  // Transient global notices may appear over dialogs.
  toast: 12000,
} as const;
