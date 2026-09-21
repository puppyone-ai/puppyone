import {
  getMermaidThemeSnapshot,
  peekMermaidDiagram,
  useEditorTaskOwner,
  mountSanitizedMermaidSvg,
  renderMermaidDiagram,
  subscribeMermaidThemeChanges,
  type MermaidSvgMount,
} from "@puppyone/shared-ui";
import { useEffect, useRef, useState } from "react";
import { useLocalization } from "@puppyone/localization/react";
import { InlineLoading } from "../../../../components/loading";
import { useAgentMarkdownEnvironment } from "./AgentMarkdownEnvironment";
import { AgentMarkdownSourceBlock } from "./AgentMarkdownSourceBlock";
import type { AgentMarkdownRichBlockProps } from "./agentMarkdownBlockRegistry";

type MermaidState = "deferred" | "pending" | "loading" | "ready" | "failed";

export function AgentMarkdownMermaidBlock({ source }: AgentMarkdownRichBlockProps) {
  const { t } = useLocalization();
  const { openExternalUrl } = useAgentMarkdownEnvironment();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mountRef = useRef<MermaidSvgMount | null>(null);
  const themeKeyRef = useRef("");
  const owner = useEditorTaskOwner();
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined");
  const [themeRevision, setThemeRevision] = useState(0);
  const [state, setState] = useState<MermaidState>(visible ? "pending" : "deferred");

  useEffect(() => {
    const host = hostRef.current;
    if (!host || visible || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setVisible(true);
      observer.disconnect();
    }, { rootMargin: "240px 0px" });
    observer.observe(host);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => subscribeMermaidThemeChanges(() => {
    if (hostRef.current && getMermaidThemeSnapshot(hostRef.current).key !== themeKeyRef.current) {
      setThemeRevision((value) => value + 1);
    }
  }), []);

  useEffect(() => () => { mountRef.current?.dispose(); mountRef.current = null; }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !visible) return;
    const controller = new AbortController();
    const theme = getMermaidThemeSnapshot(host);
    themeKeyRef.current = theme.key;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const present = (svg: string) => {
      clearTimeout(timer);
      mountRef.current?.dispose();
      mountRef.current = mountSanitizedMermaidSvg(host, svg, openExternalUrl);
      setState("ready");
    };
    try {
      const cached = peekMermaidDiagram(source, theme);
      if (cached) { present(cached.svg); return; }
    } catch { /* report through the render error path */ }
    if (!mountRef.current) {
      setState("pending");
      timer = setTimeout(() => setState("loading"), 150);
    }
    void renderMermaidDiagram({ source, theme, signal: controller.signal, owner: owner ?? undefined }).then((result) => {
      if (controller.signal.aborted) return;
      present(result.svg);
    }).catch(() => {
      clearTimeout(timer);
      if (controller.signal.aborted) return;
      setState("failed");
    });
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [openExternalUrl, owner, source, themeRevision, visible]);

  return (
    <figure className={`desktop-agent-mermaid is-${state}`}>
      <figcaption>{t("agent.markdown.diagram")}</figcaption>
      <div className="desktop-agent-mermaid-stage">
        {state === "loading" && (
          <InlineLoading
            label={null}
            size="xs"
            tone="neutral"
            ariaLabel={t("agent.markdown.diagramRendering")}
          />
        )}
        {state === "failed" && <AgentMarkdownSourceBlock language="mermaid" source={source} />}
        <div ref={hostRef} className="desktop-agent-mermaid-host" hidden={state === "failed"} />
      </div>
    </figure>
  );
}
