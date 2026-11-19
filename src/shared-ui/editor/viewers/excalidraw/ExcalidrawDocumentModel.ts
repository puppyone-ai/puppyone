import type { ExcalidrawInitialDataState } from "@excalidraw/excalidraw/dist/types/excalidraw/types";
import type { EditorSourceSnapshot } from "../../sourceSnapshot";

export function parseWhiteboard(content: string): ExcalidrawInitialDataState | null {
  try {
    const data = JSON.parse(content);
    if (!data || data.type !== "excalidraw" || data.version !== 2 || !Array.isArray(data.elements)) return null;
    if (data.appState != null && (typeof data.appState !== "object" || Array.isArray(data.appState))) return null;
    if (data.files != null && (typeof data.files !== "object" || Array.isArray(data.files))) return null;
    const ids = new Set<string>();
    for (const element of data.elements) {
      if (!element || typeof element.id !== "string" || ids.has(element.id)
        || !["rectangle", "diamond", "ellipse", "text", "arrow", "line", "freedraw", "image", "frame", "magicframe", "embeddable", "iframe"].includes(element.type)
        || ![element.x, element.y, element.width, element.height].every(Number.isFinite)) return null;
      ids.add(element.id);
    }
    return data;
  } catch { return null; }
}

/** DOM-free retained source. Excalidraw owns undo while mounted; replacement remounts it. */
export class ExcalidrawDocumentModel {
  readonly retainedSource = this;
  private sequence = 0;
  private generation = 0;
  private enabled = true;
  private baseline: string | null = null;
  private listeners = new Set<() => void>();
  private snapshot: EditorSourceSnapshot;
  private scene: ExcalidrawInitialDataState | null;

  constructor(content: string) {
    this.scene = parseWhiteboard(content);
    this.snapshot = { content, revision: `excalidraw:${++this.sequence}` };
  }
  readSnapshot = () => this.snapshot;
  getGeneration = () => this.generation;
  getScene = () => this.scene;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  setInputEnabled = (enabled: boolean) => { this.enabled = enabled; };
  replaceContent = (content: string): EditorSourceSnapshot => {
    this.scene = parseWhiteboard(content);
    this.baseline = null;
    this.snapshot = { content, revision: `excalidraw:${++this.sequence}` };
    this.generation++;
    this.listeners.forEach((listener) => listener());
    return this.snapshot;
  };
  /** First normalized SDK scene establishes equivalence without rewriting the user's JSON. */
  acceptScene = (content: string, generation: number): boolean => {
    if (!this.scene || generation !== this.generation || !this.enabled) return false;
    if (this.baseline === null) { this.baseline = content; return false; }
    if (content === this.baseline) return false;
    this.baseline = content;
    this.scene = parseWhiteboard(content);
    this.snapshot = { content, revision: `excalidraw:${++this.sequence}` };
    return true;
  };
  dispose = () => { this.enabled = false; this.listeners.clear(); };
}
