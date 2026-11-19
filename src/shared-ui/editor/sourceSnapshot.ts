export type EditorSourceSnapshot = {
  content: string;
  revision: string;
};

export type EditorSourceRevision = {
  revision: string;
  /** Only an explicit local model transaction may make a Working Copy dirty. */
  origin: "local-edit" | "model-initialization";
};

/**
 * Imperative content boundary for editors whose canonical source lives
 * outside React state. Snapshot reads are explicit because they may copy the
 * complete document; replacement routes an accepted external version back
 * through the format-specific model.
 */
export type EditorSourceSnapshotPort = {
  /** A DOM-free model owned by the open document, used after this view detaches. */
  readonly retainedSource?: EditorSourceSnapshotPort;
  /** Complete active input before a destructive lifecycle operation. */
  prepareDetach?: () => void | Promise<void>;
  setInputEnabled?: (enabled: boolean) => void;
  readSnapshot: () => EditorSourceSnapshot;
  /** Apply raw canonical file content through the format-specific model. */
  replaceContent: (content: string) => EditorSourceSnapshot;
};
