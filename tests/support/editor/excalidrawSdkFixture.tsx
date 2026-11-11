import { useLayoutEffect, useState } from "react";

type Element = { id: string; type: string; x: number; y: number; width: number; height: number;
  version: number; customData: { marker: string } };
type Scene = { elements: Element[]; appState: Record<string, unknown>; files: Record<string, unknown> };

// Only the external canvas SDK is simulated here. The matrix keeps the real
// Viewer, retained model, Document Session, watcher and persistence queue.
// Drawing, native undo and SDK serialization run in the required Electron test.
export function Excalidraw({ initialData, onChange }: {
  initialData: Scene; onChange: (elements: Element[], state: Scene["appState"], files: Scene["files"]) => void;
}) {
  const [scene, setScene] = useState(initialData);
  useLayoutEffect(() => onChange(scene.elements, scene.appState, scene.files), [onChange, scene]);
  return <button data-whiteboard-marker={scene.elements[0]?.customData.marker}
    onClick={() => setScene({ ...scene, elements: scene.elements.map(element => ({
      ...element, version: 2, customData: { marker: "human" },
    })) })}>Edit whiteboard</button>;
}

export const FONT_FAMILY = { "Liberation Sans": 9 };
export const THEME = { LIGHT: "light", DARK: "dark" };
export const CaptureUpdateAction = { NEVER: "never" };
export const restoreAppState = () => ({});
export const hashElementsVersion = (elements: Element[]) => elements.reduce((sum, element) => sum + element.version, 0);
export const serializeAsJSON = (elements: Element[], state: Scene["appState"], files: Scene["files"]) => JSON.stringify({
  type: "excalidraw", version: 2, elements, appState: { viewBackgroundColor: state.viewBackgroundColor }, files,
});
export const MainMenu = Object.assign(() => null, {
  DefaultItems: { SaveAsImage: () => null, ClearCanvas: () => null, ChangeCanvasBackground: () => null },
});
