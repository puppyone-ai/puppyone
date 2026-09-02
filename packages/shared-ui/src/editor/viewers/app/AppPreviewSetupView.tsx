import {
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  FileCode2,
  FolderOpen,
  FolderSearch,
  Globe2,
  Link2,
  LoaderCircle,
  Play,
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocalization } from "@puppyone/localization/react";
import { parseAppPreviewManifest } from "../../../../../../shared/appPreviewManifest.js";
import type {
  AppPreviewController,
  AppPreviewDetectionResult,
  AppPreviewProjectCandidate,
  AppPreviewSetup,
} from "../../../core/types";

type SetupScreen = "detecting" | "detected" | "projects" | "methods" | "html" | "url" | "advanced";
type DetectionStatus = "detecting" | "ready" | "failed" | "unavailable";

const EMPTY_DETECTION: AppPreviewDetectionResult = { projects: [], htmlFiles: [] };

export function AppPreviewSetupView({
  appName,
  appPath,
  content,
  controller,
  settings = false,
  onConfigured,
  onCancel,
}: {
  appName: string;
  appPath: string;
  content: string;
  controller: AppPreviewController | null | undefined;
  settings?: boolean;
  onConfigured: (content: string) => void;
  onCancel?: () => void;
}) {
  const { t } = useLocalization();
  const configuredLaunch = useMemo(() => {
    if (!settings) return null;
    try {
      return parseAppPreviewManifest(content, { appPath }).launch;
    } catch {
      return null;
    }
  }, [appPath, content, settings]);
  const [screen, setScreen] = useState<SetupScreen>(() => getSettingsScreen(configuredLaunch, settings));
  const [detection, setDetection] = useState<AppPreviewDetectionResult>(EMPTY_DETECTION);
  const [detectionStatus, setDetectionStatus] = useState<DetectionStatus>(
    controller?.detect ? "detecting" : "unavailable",
  );
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [htmlPath, setHtmlPath] = useState(configuredLaunch?.kind === "static-file" ? configuredLaunch.path : "");
  const [url, setUrl] = useState(configuredLaunch?.kind === "existing-url" ? configuredLaunch.url : "http://localhost:3000/");
  const [cwd, setCwd] = useState(configuredLaunch?.kind === "local-server" ? configuredLaunch.cwd : "");
  const [command, setCommand] = useState(configuredLaunch?.kind === "local-server" ? formatCommand(configuredLaunch.command) : "");
  const [startPath, setStartPath] = useState(configuredLaunch?.kind === "local-server" ? getStartPath(configuredLaunch.url) : "/");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!controller?.detect) {
      setDetectionStatus("unavailable");
      if (!settings) setScreen("methods");
      return;
    }
    setDetectionStatus("detecting");
    if (!settings) setScreen("detecting");
    void controller.detect(appPath).then((result) => {
      if (cancelled) return;
      setDetection(result);
      setDetectionStatus("ready");
      setSelectedProjectId(result.projects[0]?.id ?? null);
      setHtmlPath((current) => current || result.htmlFiles[0]?.path || "");
      if (settings) return;
      setScreen(result.projects.length === 1
        ? "detected"
        : result.projects.length > 1 ? "projects" : "methods");
    }).catch(() => {
      if (cancelled) return;
      setDetectionStatus("failed");
      if (!settings) setScreen("methods");
    });
    return () => {
      cancelled = true;
    };
  }, [appPath, controller, settings]);

  const selectedProject = useMemo(
    () => detection.projects.find((candidate) => candidate.id === selectedProjectId) ?? detection.projects[0] ?? null,
    [detection.projects, selectedProjectId],
  );
  const noDetectedProject = !settings
    && detectionStatus === "ready"
    && detection.projects.length === 0;
  const detectionUnavailable = !settings
    && (detectionStatus === "failed" || detectionStatus === "unavailable");
  const showMethodSuggestions = noDetectedProject || detectionUnavailable;

  const saveAndStart = async (setup: AppPreviewSetup) => {
    if (!controller?.configure || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await controller.configure({
        path: appPath,
        name: appName,
        setup,
        expectedContent: content,
      });
      onConfigured(result.content);
    } catch (reason) {
      setError(toSetupError(reason, t));
      setBusy(false);
    }
  };

  const startProject = (candidate: AppPreviewProjectCandidate | null) => {
    if (!candidate) return;
    void saveAndStart({ kind: "local-server", cwd: candidate.cwd, command: candidate.command });
  };

  return (
    <div className="app-setup-scroll">
      <div className="app-setup-panel" data-screen={screen}>
        {screen !== "detecting"
          && screen !== "detected"
          && !(screen === "methods" && detection.projects.length === 0)
          && !settings ? (
          <button className="app-setup-back" type="button" data-po-interaction="navigation" onClick={() => {
            setError(null);
            setScreen(detection.projects.length === 1 ? "detected" : "methods");
          }}>
            <ChevronLeft size={14} aria-hidden="true" /> {t("editor.app.setup.back")}
          </button>
        ) : null}

        {screen === "detecting" ? (
          <SetupHero
            icon={<LoaderCircle className="app-setup-spinner" size={22} aria-hidden="true" />}
            title={t("editor.app.setup.title")}
            detail={t("editor.app.setup.detail")}
          >
            <div className="app-setup-detecting" role="status">{t("editor.app.setup.detecting")}</div>
          </SetupHero>
        ) : screen === "detected" && selectedProject ? (
          <SetupHero
            icon={<Globe2 size={22} aria-hidden="true" />}
            title={t("editor.app.setup.detectedTitle")}
            detail={t("editor.app.setup.detectedDetail")}
          >
            <ProjectCard candidate={selectedProject} recommended />
            <button className="app-setup-primary" type="button" disabled={busy} onClick={() => startProject(selectedProject)}>
              <Play size={14} aria-hidden="true" />
              {busy ? t("editor.app.setup.starting") : t("editor.app.setup.startProject")}
            </button>
            <button className="app-setup-link" type="button" data-po-interaction="navigation" disabled={busy} onClick={() => setScreen("methods")}>
              {t("editor.app.setup.anotherMethod")}
            </button>
          </SetupHero>
        ) : screen === "projects" ? (
          <SetupHero
            icon={<Globe2 size={22} aria-hidden="true" />}
            title={t("editor.app.setup.projectsTitle")}
            detail={t("editor.app.setup.projectsDetail")}
          >
            <div className="app-setup-project-list" role="radiogroup" aria-label={t("editor.app.setup.detectedProjects")}>
              {detection.projects.map((candidate) => (
                <label className="app-setup-project-option" data-selected={candidate.id === selectedProjectId || undefined} key={candidate.id}>
                  <input
                    type="radio"
                    name="app-project"
                    checked={candidate.id === selectedProjectId}
                    onChange={() => setSelectedProjectId(candidate.id)}
                  />
                  <ProjectCard candidate={candidate} />
                </label>
              ))}
            </div>
            <button className="app-setup-primary" type="button" disabled={!selectedProject || busy} onClick={() => startProject(selectedProject)}>
              <Play size={14} aria-hidden="true" />
              {busy ? t("editor.app.setup.starting") : t("editor.app.setup.startSelected")}
            </button>
            <button className="app-setup-link" type="button" data-po-interaction="navigation" disabled={busy} onClick={() => setScreen("methods")}>
              {t("editor.app.setup.anotherMethod")}
            </button>
          </SetupHero>
        ) : screen === "methods" ? (
          <SetupHero
            icon={noDetectedProject
              ? <FolderSearch size={22} aria-hidden="true" />
              : detectionUnavailable
                ? <CircleAlert size={22} aria-hidden="true" />
                : <SlidersHorizontal size={22} aria-hidden="true" />}
            title={settings
              ? t("editor.app.setup.settingsTitle")
              : noDetectedProject
                ? t("editor.app.setup.noProjectTitle")
                : detectionUnavailable
                  ? t("editor.app.setup.detectionUnavailableTitle")
                  : t("editor.app.setup.methodsTitle")}
            detail={settings
              ? t("editor.app.setup.settingsDetail")
              : noDetectedProject
                ? t("editor.app.setup.noProjectDetail")
                : detectionUnavailable
                  ? t("editor.app.setup.detectionUnavailableDetail")
                  : t("editor.app.setup.methodsDetail")}
          >
            {showMethodSuggestions ? (
              <span className="app-setup-suggestions-label">{t("editor.app.setup.suggestionsTitle")}</span>
            ) : null}
            <div className="app-setup-methods">
              <MethodButton
                icon={<FolderOpen size={18} />}
                title={t("editor.app.setup.methodProject")}
                detail={t("editor.app.setup.methodProjectDetail")}
                onClick={() => setScreen(detection.projects.length ? "projects" : "advanced")}
              />
              <MethodButton
                icon={<FileCode2 size={18} />}
                title={t("editor.app.setup.methodHtml")}
                detail={t("editor.app.setup.methodHtmlDetail")}
                onClick={() => setScreen("html")}
              />
              <MethodButton
                icon={<Link2 size={18} />}
                title={t("editor.app.setup.methodUrl")}
                detail={t("editor.app.setup.methodUrlDetail")}
                onClick={() => setScreen("url")}
              />
              <div className="app-setup-method-divider" />
              <MethodButton
                icon={<SlidersHorizontal size={18} />}
                title={t("editor.app.setup.methodAdvanced")}
                detail={t("editor.app.setup.methodAdvancedDetail")}
                onClick={() => setScreen("advanced")}
              />
            </div>
            {settings && onCancel ? (
              <button className="app-setup-link" type="button" onClick={onCancel}>{t("common.action.cancel")}</button>
            ) : null}
          </SetupHero>
        ) : screen === "html" ? (
          <SetupForm title={t("editor.app.setup.htmlTitle")} detail={t("editor.app.setup.htmlDetail")}>
            {detection.htmlFiles.length ? (
              <label className="app-setup-field">
                <span>{t("editor.app.setup.htmlFile")}</span>
                <select value={htmlPath} onChange={(event) => setHtmlPath(event.target.value)}>
                  {detection.htmlFiles.map((file) => <option value={file.path} key={file.path}>{file.label}</option>)}
                </select>
              </label>
            ) : (
              <label className="app-setup-field">
                <span>{t("editor.app.setup.htmlPath")}</span>
                <input value={htmlPath} placeholder={t("editor.app.setup.htmlPlaceholder")} spellCheck={false} onChange={(event) => setHtmlPath(event.target.value)} />
                <small>{t("editor.app.setup.htmlNotDetected")}</small>
              </label>
            )}
            <SetupActions busy={busy} disabled={!htmlPath.trim()} onBack={() => setScreen("methods")} onSubmit={() => {
              void saveAndStart({ kind: "static-file", path: htmlPath.trim() });
            }} />
          </SetupForm>
        ) : screen === "url" ? (
          <SetupForm title={t("editor.app.setup.urlTitle")} detail={t("editor.app.setup.urlDetail")}>
            <label className="app-setup-field">
              <span>{t("editor.app.setup.urlField")}</span>
              <input value={url} inputMode="url" spellCheck={false} placeholder={t("editor.app.setup.urlPlaceholder")} onChange={(event) => setUrl(event.target.value)} />
            </label>
            <SetupActions busy={busy} disabled={!url.trim()} onBack={() => setScreen("methods")} onSubmit={() => {
              void saveAndStart({ kind: "existing-url", url: url.trim() });
            }} />
          </SetupForm>
        ) : (
          <SetupForm title={t("editor.app.setup.advancedTitle")} detail={t("editor.app.setup.advancedDetail")}>
            <label className="app-setup-field">
              <span>{t("editor.app.setup.workingFolder")}</span>
              <input value={cwd} placeholder={t("editor.app.setup.workingFolderPlaceholder")} spellCheck={false} onChange={(event) => setCwd(event.target.value)} />
            </label>
            <label className="app-setup-field">
              <span>{t("editor.app.setup.startCommand")}</span>
              <input value={command} placeholder={t("editor.app.setup.startCommandPlaceholder")} spellCheck={false} onChange={(event) => setCommand(event.target.value)} />
            </label>
            <label className="app-setup-field">
              <span>{t("editor.app.setup.startPath")}</span>
              <input value={startPath} placeholder="/" spellCheck={false} onChange={(event) => setStartPath(event.target.value)} />
            </label>
            <SetupActions busy={busy} disabled={!cwd.trim() || !command.trim()} onBack={() => setScreen("methods")} onSubmit={() => {
              try {
                const normalizedPath = startPath.trim().startsWith("/") ? startPath.trim() : `/${startPath.trim()}`;
                const argv = parseCommandLine(command);
                void saveAndStart({
                  kind: "local-server",
                  cwd: cwd.trim(),
                  command: argv,
                  url: `http://127.0.0.1:${"${port}"}${normalizedPath || "/"}`,
                });
              } catch (reason) {
                setError(toSetupError(reason, t));
              }
            }} />
          </SetupForm>
        )}

        {error ? <div className="app-setup-error" role="alert">{error}</div> : null}
      </div>
    </div>
  );
}

function SetupHero({ icon, title, detail, children }: { icon: React.ReactNode; title: string; detail: string; children: React.ReactNode }) {
  return (
    <div className="app-setup-hero">
      <span className="app-setup-hero-icon">{icon}</span>
      <h2>{title}</h2>
      <p>{detail}</p>
      {children}
    </div>
  );
}

function ProjectCard({ candidate, recommended = false }: { candidate: AppPreviewProjectCandidate; recommended?: boolean }) {
  const { t } = useLocalization();
  return (
    <span className="app-setup-project-card">
      <span className="app-setup-project-heading">
        <strong>{candidate.framework} {candidate.script === "dev" ? "website" : candidate.script}</strong>
        {recommended ? <small>{t("editor.app.setup.recommended")}</small> : null}
      </span>
      <span>{candidate.cwd === "." ? t("editor.app.setup.currentFolder") : candidate.directoryLabel}</span>
      <code>{candidate.commandLabel}</code>
    </span>
  );
}

function MethodButton({ icon, title, detail, onClick }: { icon: React.ReactNode; title: string; detail: string; onClick: () => void }) {
  return (
    <button className="app-setup-method" type="button" data-po-interaction="navigation" onClick={onClick}>
      <span className="app-setup-method-icon">{icon}</span>
      <span><strong>{title}</strong><small>{detail}</small></span>
      <ChevronRight size={16} aria-hidden="true" />
    </button>
  );
}

function SetupForm({ title, detail, children }: { title: string; detail: string; children: React.ReactNode }) {
  return <div className="app-setup-form"><h2>{title}</h2><p>{detail}</p>{children}</div>;
}

function SetupActions({ busy, disabled, onBack, onSubmit }: { busy: boolean; disabled: boolean; onBack: () => void; onSubmit: () => void }) {
  const { t } = useLocalization();
  return (
    <div className="app-setup-actions">
      <button className="app-setup-secondary" type="button" disabled={busy} onClick={onBack}>{t("editor.app.setup.back")}</button>
      <button className="app-setup-primary" type="button" disabled={busy || disabled} onClick={onSubmit}>
        <Play size={14} aria-hidden="true" /> {busy ? t("editor.app.setup.starting") : t("editor.app.setup.saveStart")}
      </button>
    </div>
  );
}

function parseCommandLine(value: string): string[] {
  const input = value.trim();
  if (!input || /[\0\r\n]/.test(input)) throw new Error("Enter a valid start command.");
  const result: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;
  let started = false;
  for (const character of input) {
    if (escaped) { current += character; escaped = false; started = true; continue; }
    if (character === "\\" && quote !== "'") { escaped = true; started = true; continue; }
    if (quote) { if (character === quote) quote = null; else current += character; started = true; continue; }
    if (character === "'" || character === '"') { quote = character; started = true; continue; }
    if (/\s/.test(character)) { if (started) { result.push(current); current = ""; started = false; } continue; }
    current += character; started = true;
  }
  if (quote || escaped) throw new Error("The start command has an unfinished quote or escape.");
  if (started) result.push(current);
  if (!result.length || result.some((part) => !part)) throw new Error("Enter a valid start command.");
  return result;
}

function formatCommand(command: readonly string[]): string {
  return command.map((part) => /^[A-Za-z0-9_./:@${}=+-]+$/.test(part)
    ? part
    : `"${part.replace(/(["\\])/g, "\\$1")}"`).join(" ");
}

function getStartPath(urlTemplate: string): string {
  try {
    const normalized = urlTemplate.replace("${port}", "4317");
    const url = new URL(normalized);
    return `${url.pathname}${url.search}${url.hash}` || "/";
  } catch {
    return "/";
  }
}

function getSettingsScreen(
  launch: ReturnType<typeof parseAppPreviewManifest>["launch"],
  settings: boolean,
): SetupScreen {
  if (!settings) return "detecting";
  if (launch?.kind === "local-server") return "advanced";
  if (launch?.kind === "static-file") return "html";
  if (launch?.kind === "existing-url") return "url";
  return "methods";
}

function toSetupError(reason: unknown, t: ReturnType<typeof useLocalization>["t"]): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  if (/valid HTTP|credential-free/i.test(message)) return t("editor.app.setup.errorUrl");
  if (/changed while setup/i.test(message)) return t("editor.app.setup.errorChanged");
  if (/inside|relative path|working directory/i.test(message)) return t("editor.app.setup.errorWorkspace");
  if (/not found|package\.json/i.test(message)) return t("editor.app.setup.errorPreflight");
  if (/command|quote|escape/i.test(message)) return t("editor.app.setup.errorCommand");
  return t("editor.app.setup.errorGeneric");
}
