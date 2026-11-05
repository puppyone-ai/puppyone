import { DEFAULT_MACOS_WINDOW_BUTTON_POSITION } from "../../window-chrome-profile.mjs";
import { convertMacosOfficeDocumentToDocx } from "./office-document-converter.mjs";
import { passTitleBarScrollToPage } from "./title-bar-scroll.mjs";

export function createMacosPlatformAdapter({
  arch,
  officeDocumentConverter = convertMacosOfficeDocumentToDocx,
}) {
  return Object.freeze({
    platform: "macos",
    arch,
    primaryModifier: "meta",
    windowChrome: Object.freeze({
      mode: "overlay",
      browserWindowOptions: Object.freeze({
        titleBarStyle: "hiddenInset",
        titleBarOverlay: true,
        trafficLightPosition: DEFAULT_MACOS_WINDOW_BUTTON_POSITION,
      }),
      focusApplication: (app) => app.focus?.({ steal: true }),
      supportsDockIcon: true,
      shouldReapplyProfile: true,
      // A title bar that floats over the page passes scrolling on to it.
      passTitleBarScrollToPage,
    }),
    documents: Object.freeze({
      supportedInputs: Object.freeze([".doc", ".rtf"]),
      convertOfficeDocumentToDocx: officeDocumentConverter,
    }),
    updater: Object.freeze({ supported: true, installMode: "squirrel" }),
  });
}
