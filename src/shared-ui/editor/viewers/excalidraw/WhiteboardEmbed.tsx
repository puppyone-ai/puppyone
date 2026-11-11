import { useEffect, useState } from "react";
import { useLocalization } from "@puppyone/localization/react";
import type { MarkdownAssetUrlResolver, MarkdownResolvedAssetUrl, PresetViewerRenderContext } from "../../registry/viewerTypes";
import { useEditorDependencies, useEditorTaskController } from "../../runtime/EditorTaskContext";
import { resolveMarkdownAssetPath } from "../../markdown/assetResolution";
import { HtmlPreviewFrame } from "../html/HtmlPreviewFrame";

export function isLocalHtmlEmbed(link: string): boolean {
  return !!link && !/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(link) && /\.html?(?:[?#].*)?$/i.test(link);
}

export function WhiteboardEmbed({ link, documentPath, resolver, htmlTrustMode, workspaceRoot, documentNavigation }: {
  link: string;
  documentPath: string;
  resolver?: MarkdownAssetUrlResolver | null;
} & Pick<PresetViewerRenderContext, "htmlTrustMode" | "workspaceRoot" | "documentNavigation">) {
  const { t } = useLocalization();
  const { revision } = useEditorDependencies();
  const createController = useEditorTaskController();
  const [page, setPage] = useState<{ key: string; content: string; url: string } | null>(null);
  const key = `${documentPath}:${link}:${revision}`;
  const path = resolveMarkdownAssetPath(documentPath, link, workspaceRoot);
  useEffect(() => {
    if (!resolver || !path || !isLocalHtmlEmbed(link)) return;
    const controller = createController();
    let asset: MarkdownResolvedAssetUrl | null = null;
    let unsubscribe: (() => void) | undefined;
    let loadSequence = 0;
    const load = async (url: string | null) => {
      const sequence = ++loadSequence;
      setPage(null);
      if (!url) return;
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) return;
        const content = await response.text();
        if (!controller.signal.aborted && sequence === loadSequence && content.length <= 2 * 1024 * 1024) setPage({ key, content, url });
      } catch { /* Missing or removed embeds remain placeholders, never change the board. */ }
    };
    void Promise.resolve(resolver(documentPath, link, controller.signal)).then((result) => {
      if (typeof result === "object" && result) asset = result;
      if (controller.signal.aborted) { void asset?.revoke?.(); return; }
      unsubscribe = asset?.subscribe?.((url) => { void load(url); });
      void load(typeof result === "string" ? result : result?.url ?? null);
    }).catch(() => undefined);
    return () => { controller.abort(); unsubscribe?.(); void asset?.revoke?.(); };
  }, [createController, documentPath, key, link, path, resolver]);
  return page?.key === key && path
    ? <HtmlPreviewFrame path={path} title={link} content={page.content} fileUrl={page.url} htmlTrustMode={htmlTrustMode} interactive documentNavigation={documentNavigation} />
    : <div className="editor-state">{t("editor.whiteboard.embedUnavailable")}</div>;
}
