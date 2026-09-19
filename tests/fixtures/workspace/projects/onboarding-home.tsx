import "../../../../src/styles/cascade.css";
import "../../../../src/cloud-globals.css";
import "../../../../src/styles.css";
import { createRoot } from "react-dom/client";
import { TestLocalizationProvider } from "@puppyone/localization/testing";
import { MinimalOnboarding } from "../../../../src/components/MinimalOnboarding";
import englishCatalog from "../../../../src/localization/catalog-loaders/en";
import chineseCatalog from "../../../../src/localization/catalog-loaders/zh-Hans";
import frenchCatalog from "../../../../src/localization/catalog-loaders/fr";
import { createTestSurfaceAppearance } from "../../../support/react/surfaceAppearance";

const query = new URLSearchParams(window.location.search);
const locale = query.get("locale") === "zh-Hans" ? "zh-Hans" : query.get("locale") === "fr" ? "fr" : "en";
const themeMode = query.get("theme") === "light" ? "light" : "dark";
const messages = { en: englishCatalog, "zh-Hans": chineseCatalog, fr: frenchCatalog }[locale];
document.documentElement.classList.toggle("dark", themeMode === "dark");
const noop = async () => undefined;
const location = async () => ({ grantId: "fixture-location", path: "/example/Projects" });

createRoot(document.getElementById("root")!).render(
  <TestLocalizationProvider locale={locale} messages={messages}>
    <MinimalOnboarding
      appearance={createTestSurfaceAppearance({ themeMode })}
      onChooseWorkspace={noop}
      onOpenWorkspacePath={noop}
      onOpenDroppedWorkspace={noop}
      onChooseProjectLocation={location}
      onDefaultProjectLocation={location}
      onCreateProject={async () => { throw new Error("Visual fixture does not create projects"); }}
      onCloneRepository={async () => false}
    />
  </TestLocalizationProvider>,
);
