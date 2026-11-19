import { useCallback, useLayoutEffect, useMemo, useSyncExternalStore, type KeyboardEvent } from "react";
import { useDocumentModelOwner } from "./DocumentModelOwner";
import { useEditableDocumentSource } from "./EditableDocumentSourceContext";
import { StructuredDocumentModel } from "./StructuredDocumentModel";

export function useStructuredDocumentModel<T>(options: {
  kind: string;
  documentId: string;
  content: string;
  canEdit: boolean;
  parse: (content: string) => { document: T; error: string | null };
  serialize: (document: T) => string;
}) {
  const owner = useDocumentModelOwner();
  const source = useEditableDocumentSource();
  const model = useMemo(() => {
    const create = () => new StructuredDocumentModel(options.kind, options.content, options.parse, options.serialize);
    return owner?.getOrCreate(options.kind, create) ?? create();
    // Input changes go through the Working Copy, never recreate the model.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, options.kind, options.documentId]);
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);

  useLayoutEffect(() => {
    owner?.activate(model);
    if (!source) return;
    const detach = source.attachSource(model);
    source.reportRevision({ revision: model.getSnapshot().revision, origin: "model-initialization" });
    return detach;
  }, [model, owner, source]);

  useLayoutEffect(() => {
    if (!source && model.readSnapshot().content !== options.content) model.replaceContent(options.content);
  }, [model, options.content, source]);

  const report = useCallback((changed: boolean) => {
    if (changed) source?.reportRevision({ revision: model.getSnapshot().revision, origin: "local-edit" });
  }, [model, source]);
  const edit = useCallback((document: T) => {
    if (options.canEdit) report(model.edit(document));
  }, [model, options.canEdit, report]);
  const onHistoryKeyDown = useCallback((event: KeyboardEvent) => {
    if (!options.canEdit || event.nativeEvent.isComposing || !(event.metaKey || event.ctrlKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key !== "z" && key !== "y") return;
    event.preventDefault();
    event.stopPropagation();
    report(key === "y" || event.shiftKey ? model.redo() : model.undo());
  }, [model, options.canEdit, report]);

  return { model, state, edit, onHistoryKeyDown };
}
