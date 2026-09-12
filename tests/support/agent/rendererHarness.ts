

import React from "react";

import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, vi } from "vitest";

import { withTestLocalization } from "../react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.useRealTimers();
  document.body.innerHTML = "";
  document.head.querySelectorAll("style[data-agent-layout-test]").forEach((node) => node.remove());
});

function render(node: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(withTestLocalization(node)));
  return container;
}

function runtimeEntry(id: string, displayName: string) {
  return {
    descriptor: { id, displayName, iconKey: id, distribution: "user-installed" },
    readiness: {
      runtimeId: id,
      provider: id,
      status: "ready" as const,
      code: "READY" as const,
      version: "1.0.0",
      minimumVersion: null,
      message: "Ready",
      selectable: true,
    },
  };
}

function modelSessionControl(models: Array<{ model: string; displayName: string; description?: string }>, value: string | null) {
  return [{
    id: "model" as const,
    value,
    options: models.map((model) => ({
      value: model.model,
      label: model.displayName,
      description: model.description,
    })),
  }];
}

export { root, render, runtimeEntry, modelSessionControl };
