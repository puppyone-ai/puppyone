import "../../../../src/styles/cascade.css";
import "../../../../src/cloud-globals.css";
import "../../../../src/styles.css";
import { createRoot } from "react-dom/client";
import { TestLocalizationProvider } from "@puppyone/localization/testing";
import { MinimalOnboarding } from "../../../../src/components/MinimalOnboarding";
import englishCatalog from "../../../../src/localization/catalog-loaders/en";
import { createTestSurfaceAppearance } from "../../../support/react/surfaceAppearance";

const query = new URLSearchParams(window.location.search);
const themeMode = query.get("theme") === "light" ? "light" : "dark";
document.documentElement.classList.toggle("dark", themeMode === "dark");
const noop = async () => undefined;
const location = async () => ({ grantId: "fixture-location", path: "/example/Projects" });

createRoot(document.getElementById("root")!).render(
  <TestLocalizationProvider locale="en" messages={englishCatalog}>
    <MinimalOnboarding
      appearance={createTestSurfaceAppearance({ themeMode })}
      projectItems={query.get("state") === "projects" ? [{
        id: "example-project",
        label: "Notes",
        localPath: "/example/Projects/Notes",
        lastOpenedAt: null,
      }] : []}
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
