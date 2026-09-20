export type EditorLayoutParticipant = Readonly<{
  prepare(): void;
  commit(): void;
}>;

const participants = new WeakMap<Document, Map<HTMLElement, EditorLayoutParticipant>>();

/** Window-local, engine-neutral contract. Each mounted view owns its geometry
 * and scroll state; the shell only brackets mutations to its allocated space. */
export function registerEditorLayoutParticipant(element: HTMLElement, participant: EditorLayoutParticipant) {
  let registry = participants.get(element.ownerDocument);
  if (!registry) participants.set(element.ownerDocument, registry = new Map());
  registry.set(element, participant);
  return () => {
    if (registry.get(element) === participant) registry.delete(element);
  };
}

export function commitEditorLayout(root: HTMLElement, mutate: () => void): void {
  const affected = [...(participants.get(root.ownerDocument)?.entries() ?? [])]
    .filter(([element]) => element.isConnected && root.contains(element));
  for (const [, participant] of affected) participant.prepare();
  try {
    mutate();
  } finally {
    for (const [element, participant] of affected) {
      if (element.isConnected && participants.get(root.ownerDocument)?.get(element) === participant) participant.commit();
    }
  }
}
