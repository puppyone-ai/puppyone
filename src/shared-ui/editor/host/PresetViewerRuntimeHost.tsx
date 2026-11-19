"use client";

import {
  createContext,
  useContext,
  type ReactNode,
} from "react";
import type {
  PresetViewerContribution,
  PresetViewerRenderContext,
} from "../registry/viewerTypes";

export type IsolatedPresetViewerSurfaceRenderer = (request: Readonly<{
  viewer: PresetViewerContribution;
  context: PresetViewerRenderContext;
}>) => ReactNode;

export type PresetViewerRuntimeHostAdapter = Readonly<{
  renderIsolatedSurface: IsolatedPresetViewerSurfaceRenderer;
}>;

const PresetViewerRuntimeHostContext = createContext<PresetViewerRuntimeHostAdapter | null>(null);

/**
 * Desktop supplies this composition port at the application root. Shared UI
 * stays portable and never imports Electron or owns native surface sessions.
 */
export function PresetViewerRuntimeHostProvider({
  adapter,
  children,
}: {
  adapter: PresetViewerRuntimeHostAdapter | null;
  children: ReactNode;
}) {
  return (
    <PresetViewerRuntimeHostContext.Provider value={adapter}>
      {children}
    </PresetViewerRuntimeHostContext.Provider>
  );
}

export function usePresetViewerRuntimeHost(): PresetViewerRuntimeHostAdapter | null {
  return useContext(PresetViewerRuntimeHostContext);
}
