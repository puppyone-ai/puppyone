"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type {
  EditorSourceRevision,
  EditorSourceSnapshotPort,
} from "../../sourceSnapshot";
import { PlainTextEditor } from "../code/PlainTextEditor";

type CsvSourceEditorProps = Readonly<{
  content: string;
  nodeName: string;
  onSnapshotPortChange: (port: EditorSourceSnapshotPort | null) => void;
  onSourceRevisionChange: (revision: EditorSourceRevision) => void;
  readOnly: boolean;
}>;

/** Source-mode adapter that preserves the existing textarea presentation. */
export function CsvSourceEditor({
  content,
  nodeName,
  onSnapshotPortChange,
  onSourceRevisionChange,
  readOnly,
}: CsvSourceEditorProps) {
  const [value, setValue] = useState(content);
  const valueRef = useRef(content);
  const revisionSequenceRef = useRef(0);
  const revisionRef = useRef(createRevision(nodeName, 0));
  const callbacksRef = useRef({ onSnapshotPortChange, onSourceRevisionChange });
  callbacksRef.current = { onSnapshotPortChange, onSourceRevisionChange };

  useLayoutEffect(() => {
    valueRef.current = content;
    setValue(content);
  }, [content]);

  useLayoutEffect(() => {
    const port: EditorSourceSnapshotPort = {
      readSnapshot: () => ({ content: valueRef.current, revision: revisionRef.current }),
      replaceContent: (nextContent) => {
        revisionSequenceRef.current += 1;
        revisionRef.current = createRevision(nodeName, revisionSequenceRef.current);
        valueRef.current = nextContent;
        setValue(nextContent);
        return { content: nextContent, revision: revisionRef.current };
      },
    };
    callbacksRef.current.onSnapshotPortChange(port);
    callbacksRef.current.onSourceRevisionChange({
      revision: revisionRef.current,
      origin: "model-initialization",
    });
    return () => callbacksRef.current.onSnapshotPortChange(null);
  }, [nodeName]);

  const handleChange = useCallback((nextContent: string) => {
    revisionSequenceRef.current += 1;
    revisionRef.current = createRevision(nodeName, revisionSequenceRef.current);
    valueRef.current = nextContent;
    setValue(nextContent);
    callbacksRef.current.onSourceRevisionChange({
      revision: revisionRef.current,
      origin: "local-edit",
    });
  }, [nodeName]);

  return (
    <PlainTextEditor
      textSelectionScope="csv"
      content={value}
      nodeName={nodeName}
      readOnly={readOnly}
      onChange={readOnly ? undefined : handleChange}
    />
  );
}

function createRevision(documentId: string, sequence: number): string {
  return `csv-source:${documentId}:${sequence}`;
}
