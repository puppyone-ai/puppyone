import { useEffect, useLayoutEffect, useState } from "react";
import { FileText, Folder, GitBranch } from "lucide-react";
import { useLocalization } from "@puppyone/localization/react";
import { DesktopWindowChrome } from "../../components/DesktopWindowChrome";
import { parseTitlebarActionsSettings } from "../../preferences";
import { DesktopOverlayPortal } from "./DesktopOverlayPortal";
import { DesktopTitlebarActions } from "./DesktopTitlebarActions";
import type { HeaderCoachmarkId } from "./headerCoachmarks";
import "./header-coachmark-visual-smoke.css";

const requestedFeature = new URLSearchParams(window.location.search).get("feature");
const initialFeature: HeaderCoachmarkId = requestedFeature === "changes" ? "changes" : "agent";
const fixtureCopy = {
  project: "My first project",
  branch: "main",
  filesLabel: "Files",
  filesHeading: "文件",
  gettingStartedFile: "Getting Started.md",
  planFile: "项目计划.md",
  sourcesFile: "资料清单.csv",
  title: "开始使用 puppyone",
  subtitle: "为你和你的 Agent 打造的本地文件工作空间。",
  editHeading: "做一次编辑",
  editBody: "把下面这行改成你想做的事，然后保存。",
  note: "我的第一个项目：整理一份产品计划",
  agentHeading: "和你的 Agent 一起工作",
  agentBody: "准备好后，选择一个 Agent。它会使用当前项目作为上下文。",
} as const;

/** Deterministic browser fixture for product review of the two Header coachmarks. */
export function HeaderCoachmarkVisualSmokeHarness() {
  const [active, setActive] = useState<HeaderCoachmarkId | null>(initialFeature);
  const { locale, setLanguagePreference } = useLocalization();

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.add("dark");
    root.dataset.initialTheme = "dark";
    return () => {
      root.classList.remove("dark");
      delete root.dataset.initialTheme;
    };
  }, []);

  useEffect(() => {
    if (locale === "zh-Hans") return;
    void setLanguagePreference("zh-Hans");
  }, [locale, setLanguagePreference]);

  return (
    <main className="app-shell dark header-coachmark-visual-smoke" data-header-coachmark-ready="true">
      <DesktopOverlayPortal theme="dark">{null}</DesktopOverlayPortal>
      <div className="desktop-shell">
        <DesktopWindowChrome
          context={(
            <div className="header-coachmark-visual-context">
              <Folder size={14} aria-hidden="true" />
              <strong>{fixtureCopy.project}</strong>
              <GitBranch size={13} aria-hidden="true" />
              <span>{fixtureCopy.branch}</span>
            </div>
          )}
          actions={(
            <DesktopTitlebarActions
              titlebarActionsSettings={parseTitlebarActionsSettings(null)}
              terminalSidebarOpen={false}
              terminalToolEnabled
              gitChangesAvailable
              gitChangesOpen={false}
              gitChangesStatus={{ conflicts: 0, incoming: 0, localChanges: 3, outgoing: 0 }}
              onToggleTerminal={() => setActive(null)}
              onToggleGitChanges={() => setActive(null)}
              activeCoachmark={active}
              onAcknowledgeCoachmark={() => setActive(null)}
            />
          )}
        />
        <div className="header-coachmark-visual-body">
          <aside className="header-coachmark-visual-explorer" aria-label={fixtureCopy.filesLabel}>
            <div className="header-coachmark-visual-explorer-title">{fixtureCopy.filesHeading}</div>
            <div className="selected"><FileText size={14} />{fixtureCopy.gettingStartedFile}</div>
            <div><FileText size={14} />{fixtureCopy.planFile}</div>
            <div><FileText size={14} />{fixtureCopy.sourcesFile}</div>
          </aside>
          <section className="header-coachmark-visual-editor">
            <article>
              <h1>{fixtureCopy.title}</h1>
              <p>{fixtureCopy.subtitle}</p>
              <h2>{fixtureCopy.editHeading}</h2>
              <p>{fixtureCopy.editBody}</p>
              <div className="header-coachmark-visual-note">{fixtureCopy.note}</div>
              <h2>{fixtureCopy.agentHeading}</h2>
              <p>{fixtureCopy.agentBody}</p>
            </article>
          </section>
        </div>
      </div>
    </main>
  );
}
