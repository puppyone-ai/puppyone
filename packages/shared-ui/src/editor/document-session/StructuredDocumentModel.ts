import type { EditorSourceSnapshot } from "../sourceSnapshot";
import { DOCUMENT_HISTORY_POLICY } from "./historyPolicy";

export type StructuredDocumentSnapshot<T> = Readonly<{
  document: T;
  error: string | null;
  content: string;
  revision: string;
}>;

/** Format-owned parsing/serialization with a shared bounded transaction history. */
export class StructuredDocumentModel<T> {
  readonly retainedSource = this;
  private state: StructuredDocumentSnapshot<T>;
  private sequence = 0;
  private undoStack: StructuredDocumentSnapshot<T>[] = [];
  private redoStack: StructuredDocumentSnapshot<T>[] = [];
  private listeners = new Set<() => void>();
  private inputEnabled = true;
  setInputEnabled = (enabled: boolean): void => { this.inputEnabled = enabled; };

  constructor(
    private readonly kind: string,
    content: string,
    private readonly parse: (content: string) => { document: T; error: string | null },
    private readonly serialize: (document: T) => string,
  ) {
    this.state = { ...parse(content), content, revision: this.revision() };
  }

  getSnapshot = (): StructuredDocumentSnapshot<T> => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  readSnapshot = (): EditorSourceSnapshot => ({ content: this.state.content, revision: this.state.revision });

  replaceContent = (content: string): EditorSourceSnapshot => {
    this.undoStack = [];
    this.redoStack = [];
    this.publish({ ...this.parse(content), content, revision: this.revision() });
    return this.readSnapshot();
  };

  edit = (document: T): boolean => {
    if (!this.inputEnabled) return false;
    const content = this.serialize(document);
    if (content === this.state.content) return false;
    this.undoStack.push(this.state);
    this.redoStack = [];
    this.trimHistory();
    this.publish({ document, content, error: null, revision: this.revision() });
    return true;
  };

  undo = (): boolean => this.travel(this.undoStack, this.redoStack);
  redo = (): boolean => this.travel(this.redoStack, this.undoStack);

  dispose = (): void => {
    this.inputEnabled = false;
    this.listeners.clear();
    this.undoStack = [];
    this.redoStack = [];
  };

  private travel(from: StructuredDocumentSnapshot<T>[], to: StructuredDocumentSnapshot<T>[]): boolean {
    if (!this.inputEnabled) return false;
    const next = from.pop();
    if (!next) return false;
    to.push(this.state);
    this.trimHistory();
    this.publish({ ...next, revision: this.revision() });
    return true;
  }

  private trimHistory(): void {
    let budget = DOCUMENT_HISTORY_POLICY.maxBytes;
    for (const stack of [this.undoStack, this.redoStack]) {
      let keep = 0;
      for (let index = stack.length - 1; index >= 0 && keep < DOCUMENT_HISTORY_POLICY.maxEntries; index--) {
        // Raw source plus the parsed JSON tree, conservatively measured using
        // its serialized representation. No DOM or platform handles are stored.
        const bytes = (stack[index].content.length + JSON.stringify(stack[index].document).length) * 2;
        if (bytes > budget) break;
        budget -= bytes;
        keep++;
      }
      stack.splice(0, stack.length - keep);
    }
  }

  private revision(): string { return `${this.kind}:${++this.sequence}`; }
  private publish(state: StructuredDocumentSnapshot<T>): void {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }
}
