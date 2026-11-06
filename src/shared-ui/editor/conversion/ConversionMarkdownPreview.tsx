import { useEffect, useMemo, useState } from "react";
import { MarkdownCodeMirrorEditor } from "../markdown/MarkdownCodeMirrorEditor";
import type { ConversionResult } from "./types";

export default function ConversionMarkdownPreview({ result }: { result: ConversionResult }) {
  const [lease, setLease] = useState({ assets: new Map<string, string>(), revision: 0 });
  useEffect(() => {
    const urls = new Map(result.assets.map(asset => [
      `assets/${asset.name}`, URL.createObjectURL(new Blob([new Uint8Array(asset.bytes)], { type: asset.mimeType })),
    ]));
    setLease(previous => ({ assets: urls, revision: previous.revision + 1 }));
    return () => { for (const url of urls.values()) URL.revokeObjectURL(url); };
  }, [result]);
  const resolver = useMemo(() => (_source: string, href: string) => lease.assets.get(href) ?? null, [lease]);
  return <MarkdownCodeMirrorEditor value={result.markdown} readOnly livePreview blockDragEnabled={false}
    documentPath="converted.md" markdownAssetUrlResolver={resolver} markdownAssetResolverRevision={lease.revision} htmlTrustMode="safe" />;
}
