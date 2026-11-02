/**
 * @vitest-environment happy-dom
 */
import React, { act, StrictMode, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useHomepageProjectView } from "../../../../src/components/onboarding/OnboardingProjectToolbar";
import type { ProjectHomeItem } from "../../../../src/lib/workspaceHomeModel";
import { initializeDesktopPreferences } from "../../../../src/preferencesStore";
import { renderWithTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const project = (id: string, lastModifiedAt: string | null): ProjectHomeItem => ({
  id, label: id, localPath: `/projects/${id}`, lastModifiedAt,
});
const older = "2026-09-01T00:00:00.000Z";
const newer = "2026-10-01T00:00:00.000Z";

let root: Root | null = null;
let shown: string[] = [];

function View({ items, held = false }: { items: ProjectHomeItem[]; held?: boolean }) {
  const { visibleItems } = useHomepageProjectView(items, held);
  useEffect(() => { shown = visibleItems.map((item) => item.id); });
  return null;
}

const show = (items: ProjectHomeItem[], held = false) => act(() => {
  renderWithTestLocalization(root!, <StrictMode><View items={items} held={held} /></StrictMode>);
});

beforeEach(() => {
  initializeDesktopPreferences();
  root = createRoot(document.createElement("div"));
  shown = [];
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

describe("the Homepage's project view", () => {
  it("keeps a row in place when a newer date arrives while it is on screen", () => {
    show([project("alpha", newer), project("beta", older)]);
    expect(shown).toEqual(["alpha", "beta"]);

    show([project("alpha", newer), project("beta", "2026-11-01T00:00:00.000Z")]);

    expect(shown).toEqual(["alpha", "beta"]);
  });

  it("takes a first date for a row that had none", () => {
    show([project("alpha", older), project("beta", null)]);
    expect(shown).toEqual(["alpha", "beta"]);

    show([project("alpha", older), project("beta", newer)]);

    expect(shown).toEqual(["beta", "alpha"]);
  });

  it("starts over when the list is held, so a return shows the newest order", () => {
    show([project("alpha", newer), project("beta", older)]);

    show([project("alpha", newer), project("beta", older)], true);
    expect(shown).toEqual([]);

    show([project("alpha", newer), project("beta", "2026-11-01T00:00:00.000Z")]);
    expect(shown).toEqual(["beta", "alpha"]);
  });
});
