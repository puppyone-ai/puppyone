// Native IPC ownership boundary. The product model continues to own scene
// semantics; this adapter fences messages already queued before host changes.
type Port = {
  readSnapshot(): { content: string };
  replaceContent(text: string): unknown;
  setInputEnabled?(value: boolean): void;
};
type Boot = { generation: number; text: string; canEdit: boolean };
export function createWhiteboardBridge(boot: Boot, post: (message: object) => void) {
  let generation = boot.generation;
  let sent = boot.text;
  let enabled = boot.canEdit;
  let port: Port | null = null;
  let replacing = false;
  let attachment = 0;
  const source = {
    attachSource(next: Port) {
      if (port && port !== next) port.setInputEnabled?.(false);
      port = next;
      const owner = ++attachment;
      next.setInputEnabled?.(enabled);
      return () => {
        if (attachment === owner) {
          port = null;
          next.setInputEnabled?.(false);
        }
      };
    },
    reportRevision(revision: { origin: string }) {
      if (!enabled || replacing || revision.origin === 'model-initialization') return;
      const text = port?.readSnapshot().content;
      if (text === undefined || text === sent) return;
      sent = text;
      post({ type: 'content', generation, text });
    },
  };
  return {
    source,
    ready() { post({ type: 'ready', generation }); },
    link(link: string) { post({ type: 'link', generation, link }); },
    reset(text: string, next: number) {
      generation = next;
      sent = text;
      replacing = true;
      try { port?.replaceContent(text); } finally { replacing = false; }
    },
    setEnabled(value: boolean, next: number) {
      generation = next;
      enabled = value;
      port?.setInputEnabled?.(value);
    },
  };
}
