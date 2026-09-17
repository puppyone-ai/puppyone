import { useMemo, useState } from "react";
import { BUILTIN_SUB_THEMES } from "../../themes/builtinSubThemes";
import { SubThemeStyleHost } from "../../themes/SubThemeStyleHost";
import { DEFAULT_MARKDOWN_PRESENTATION_SETTINGS } from "../../markdown/markdownPresentation";
import { AGENT_BRAND_CATALOG, resolveRendererPublicAssetUrl } from "@puppyone/shared-ui";
import { bidiIsolate } from "@puppyone/localization/core";
import { useLocalization } from "@puppyone/localization/react";
import { DesktopOverlayPortal } from "../../app-shell/DesktopOverlayPortal";
import { AgentComposer } from "./AgentComposer";
import { AgentApprovalDock } from "./AgentApprovalDock";
import { AgentPanelLayout } from "./AgentPanelLayout";
import { AgentRuntimePicker } from "./AgentRuntimePicker";
import { AgentSurfaceHeader } from "./AgentSurfaceHeader";
import { AgentTranscript } from "./AgentTranscript";
import { createEmptyAgentDisplay as createAgentProjection } from "../../../../shared/agent-contract/display-state.mjs";
import type {
  AgentDraftReference,
  AgentModel,
  AgentPromptReferenceMention,
  AgentReferenceInputCapabilities,
  AgentRuntimeCatalogEntry,
} from "../domain/agent-contract";
import type { AgentSessionControl } from "../domain/agent-session-controls";
import type { AgentApproval } from "../domain/agent-projection-types";
import "./desktop-agent.css";

const agentRuntimes: AgentRuntimeCatalogEntry[] = [
  runtimeEntry("codex", "Codex", "codex"),
  runtimeEntry("claude", "Claude Agent", "claude"),
  runtimeEntry("opencode-native", "OpenCode", "opencode"),
  runtimeEntry("cursor", "Cursor Agent", "cursor"),
  runtimeEntry("workbuddy", "WorkBuddy", "workbuddy"),
  runtimeEntry("hermes", "Hermes Agent", "hermes"),
];

const modelsByRuntime: Record<string, AgentModel[]> = {
  codex: [model("gpt-5.4", "GPT-5.4", true), model("gpt-5.4-mini", "GPT-5.4 Mini")],
  claude: [model("claude-sonnet-4.5", "Claude Sonnet 4.5", true), model("claude-opus-4.1", "Claude Opus 4.1")],
  "opencode-native": [model("google/gemini-3-pro", "Gemini 3 Pro", true), model("openai/gpt-5.4", "GPT-5.4")],
  cursor: [model("auto", "Auto", true), model("composer-1", "Composer 1")],
  workbuddy: [model("auto", "Auto", true)],
  hermes: [model("openrouter:auto", "Auto", true)],
};

const referenceCapabilities: AgentReferenceInputCapabilities = {
  schemaVersion: 1,
  workspace: { files: true, directories: true },
  attachments: {
    image: { accepted: true, mimeTypes: ["image/png", "image/jpeg", "image/gif", "image/webp"] },
    text: { accepted: false },
    audio: { accepted: false },
    video: { accepted: false },
    binary: { accepted: false },
  },
  limits: {
    maxCount: 32,
    maxBytesPerReference: 25 * 1024 * 1024,
    maxTotalBytes: 25 * 1024 * 1024,
  },
  steer: false,
  attachmentOnly: false,
};

const smokeReferences: AgentDraftReference[] = [
  {
    id: "workspace-security",
    kind: "workspace-entry",
    entryType: "file",
    relativePath: "SECURITY.md",
    displayName: "SECURITY.md",
    mime: "text/markdown",
    size: 2_048,
    status: "ready",
  },
  {
    id: "attachment-capture",
    kind: "staged-attachment",
    token: "visual-smoke-token",
    displayName: "capture.png",
    mime: "image/png",
    size: 12_345,
    status: "ready",
  },
  {
    id: "attachment-unsupported",
    kind: "staged-attachment",
    displayName: "requirements.pdf",
    mime: "application/pdf",
    size: 42_000,
    status: "error",
    error: { code: "file-unsupported", message: "This Agent does not accept this file type." },
  },
];

const smokeApproval: AgentApproval = {
  requestId: "visual-smoke-approval",
  turnId: "turn-approval",
  itemId: "tool-web-search",
  kind: "command",
  title: "Web search: Notion 1.0 2016 launch Product Hunt original version screenshots Ivan Zhao Kyoto rewrite",
  command: null,
  cwd: null,
  commandActions: [],
  networkApprovalContext: null,
  grantRoot: null,
  policyChangeRequested: false,
  reason: "Web search: Notion 1.0 2016 launch Product Hunt original version screenshots Ivan Zhao Kyoto rewrite",
  availableDecisions: ["accept", "acceptForSession", "decline", "cancel"],
  sequence: 13,
};

export function AgentVisualSmokeHarness() {
  const { t } = useLocalization();
  const [draft, setDraft] = useState("");
  const [draftMentions, setDraftMentions] = useState<AgentPromptReferenceMention[]>([]);
  const [runtimeId, setRuntimeId] = useState(agentRuntimes[0].descriptor.id);
  const [selectedModel, setSelectedModel] = useState(modelsByRuntime[runtimeId][0].model);
  const [selectedEffort, setSelectedEffort] = useState("medium");
  const [references, setReferences] = useState(smokeReferences);
  const smokeState = new URLSearchParams(window.location.search).get("state");
  const theme = new URLSearchParams(window.location.search).get("theme") === "light" ? "light" : "dark";
  const startupLoading = smokeState === "loading";
  const streamingTableSmoke = smokeState === "streaming-table";
  const toolMotionSmoke = smokeState === "tool-motion";
  const approvalSmoke = smokeState === "approval";
  const selectedRuntime = agentRuntimes.find((entry) => entry.descriptor.id === runtimeId) ?? agentRuntimes[0];
  const models = modelsByRuntime[runtimeId];
  const sessionControls: AgentSessionControl[] = [
    {
      id: "model",
      value: selectedModel,
      options: models.map((entry) => ({
        value: entry.model,
        label: entry.displayName,
        description: entry.description || undefined,
      })),
    },
    {
      id: "effort",
      value: selectedEffort,
      options: (models.find((entry) => entry.model === selectedModel)?.variants ?? [])
        .map((effort) => ({ value: effort, label: effort })),
    },
  ].filter((control) => control.options.length > 0) as AgentSessionControl[];
  const startupProjection = useMemo(() => createAgentProjection(), []);
  const projection = useMemo(() => {
    const value = createAgentProjection();
    value.sessionState = "active";
    value.messages = [
      {
        id: "user:1",
        role: "user",
        turnId: "turn-1",
        itemId: null,
        text: "好，可是现在的这个 terminal 的颜色也没有按照主题风格来。terminal 的颜色也要按照这个整体的一致的颜色去做",
        streaming: false,
        terminalState: null,
        sequence: 1,
      },
      {
        id: "assistant:1",
        role: "assistant",
        turnId: "turn-1",
        itemId: "message-1",
        text: [
          "补充两点：",
          "",
          "- [x] 终端与正文之间保留一条柔和的视觉分隔，与 sidebar 的处理方式一致。",
          "- [ ] 终端前景色和 ANSI 色板继续由主题定义，底色则使用统一的正文画布色。",
          "",
          "| Layer | Owner | Contract |",
          "| :--- | :--- | :--- |",
          "| Markdown | Agent UI | CommonMark + GFM |",
          "| Diagram | Rich-block registry | Safe Mermaid mount |",
          "",
          "```mermaid",
          "flowchart LR",
          "  Harness --> Events --> Projection --> Markdown",
          "```",
        ].join("\n"),
        streaming: false,
        terminalState: "completed",
        sequence: 2,
      },
      {
        id: "user:2",
        role: "user",
        turnId: "turn-2",
        itemId: null,
        text: "好，现在我需要你这个 md editor 的上下 padding 要和左右的 padding 相同",
        references: [
          { id: "workspace-src", kind: "workspace-directory", displayName: "src", relativePath: "src" },
          { id: "attachment-capture", kind: "attachment", displayName: "capture.png", mime: "image/png", size: 12_345 },
        ],
        streaming: false,
        terminalState: null,
        sequence: 3,
      },
      {
        id: "assistant:2",
        role: "assistant",
        turnId: "turn-2",
        itemId: "message-2",
        text: "分支已切到 `codex-cloud`。先找到 MD 编辑器内容区上下与左右 padding 的定义处。",
        streaming: false,
        terminalState: "completed",
        sequence: 6,
      },
    ];
    if (streamingTableSmoke) {
      value.messages.push({
        id: "assistant:streaming-table",
        role: "assistant",
        turnId: "turn-streaming-table",
        itemId: "message-streaming-table",
        text: [
          "| Tool | State |",
          "| --- | --- |",
          "| Read | complete |",
          "| Bash | run",
        ].join("\n"),
        streaming: true,
        terminalState: null,
        sequence: 12,
      });
    }
    value.activities = [
      {
        id: "activity:duration",
        turnId: "turn-2",
        itemId: "reasoning-1",
        kind: "reasoning",
        label: "Thought briefly",
        status: "completed",
        detail: { delta: "Located the theme boundary and compared terminal token ownership." },
        output: "",
        sequence: 4,
      },
      {
        id: "activity:compaction",
        turnId: "turn-2",
        itemId: "compact-1",
        kind: "tool",
        label: "Compacted context",
        status: "completed",
        detail: { tool: "compaction" },
        output: "",
        sequence: 5,
      },
      {
        id: "activity:explored",
        turnId: "turn-2",
        itemId: "tool-1",
        kind: "tool",
        label: "Explored markdown-editor.css, 2 searches",
        status: toolMotionSmoke ? "running" : "completed",
        detail: { tool: "grep", input: { pattern: "padding", path: "src" } },
        output: "src/markdown-editor.css:42:padding: 24px;\nsrc/editor-shell.css:18:padding-inline: 24px;",
        sequence: 7,
      },
      {
        id: "activity:command",
        turnId: "turn-2",
        itemId: "tool-command",
        kind: "command",
        label: "Search owners",
        status: "completed",
        detail: { tool: "bash", input: { command: "/bin/zsh -lc \"rg -n -i liangyu dev\\ issues\"" }, metadata: { exitCode: 0, duration: 2080 } },
        output: "dev issues/ISSUE-001.md:5:Owner | liangyu*\ndev issues/ISSUE-016.md:5:Owner | liangyu*",
        sequence: 8,
      },
      {
        id: "activity:read",
        turnId: "turn-2",
        itemId: "tool-read",
        kind: "tool",
        label: "Read markdown editor styles",
        status: toolMotionSmoke ? "running" : "completed",
        detail: { tool: "read", input: { file_path: "src/markdown-editor.css" } },
        output: ".markdown-editor {\n  padding: 24px;\n}",
        sequence: 9,
      },
      {
        id: "activity:file-change",
        turnId: "turn-2",
        itemId: "tool-edit",
        kind: "file-change",
        label: "Updated markdown-editor.css",
        status: toolMotionSmoke ? "running" : "completed",
        detail: {
          tool: "edit",
          path: "src/markdown-editor.css",
          changes: [{ path: "src/markdown-editor.css", additions: 2704, deletions: 585 }],
          input: { patch: "@@ -10,2 +10,2 @@\n-padding: 12px 24px;\n+padding: 24px;" },
        },
        output: "",
        sequence: 10,
      },
    ];
    value.parts = [{
      id: "fixture:hidden-file-change-summary",
      turnId: "turn-2",
      itemId: "tool-2",
      kind: "file-change",
      label: "Updated files",
      status: "completed",
      detail: { changes: [{ path: "src/markdown-editor.css", additions: 2704, deletions: 585 }] },
      output: "",
      sequence: 10,
    }];
    value.turns = [
      {
        id: "turn-1",
        status: "completed",
        startedAtSequence: 1,
        startedAtMs: 0,
        completedAtSequence: 2,
        durationMs: 2_400,
        partIds: ["user:1", "assistant:1"],
      },
      {
        id: "turn-2",
        status: "completed",
        startedAtSequence: 3,
        startedAtMs: 3_000,
        completedAtSequence: 11,
        durationMs: 31_000,
        partIds: ["user:2", "assistant:2"],
      },
    ];
    value.lastSequence = streamingTableSmoke ? 12 : 10;
    value.terminalState = "completed";
    return value;
  }, [streamingTableSmoke, toolMotionSmoke]);
  const visibleProjection = startupLoading ? startupProjection : projection;

  return (
    <>
      <SubThemeStyleHost subTheme={BUILTIN_SUB_THEMES.find(entry => entry.id === "default.neutral")!} colorMode={theme} markdownPresentation={DEFAULT_MARKDOWN_PRESENTATION_SETTINGS} />
      <main className={`desktop-agent-visual-smoke${theme === "dark" ? " dark" : ""}`} data-smoke-theme={theme}
        data-po-appearance-root="true" data-root-theme-id="default" data-sub-theme-id="default.neutral">
        <AgentPanelLayout
          ariaLabel={t("agent.panel.chat", { agent: bidiIsolate(selectedRuntime.descriptor.displayName) })}
          header={<AgentSurfaceHeader
            title={t("agent.visual.title")}
            runtimeIconKey={selectedRuntime.descriptor.iconKey}
            runtimeLabel={selectedRuntime.descriptor.displayName}
            statusCode="ready"
            statusLabel={t("agent.header.status.ready")}
            loading={startupLoading}
            newSessionDisabled={false}
            onNewSession={() => {}}
            agentSelector={<AgentRuntimePicker
              agentRuntimes={agentRuntimes}
              selectedRuntimeId={runtimeId}
              onSelectRuntime={(nextRuntimeId) => {
                setRuntimeId(nextRuntimeId);
                setSelectedModel(modelsByRuntime[nextRuntimeId][0].model);
                setSelectedEffort("medium");
              }}
            />}
          />}
          conversation={<AgentTranscript projection={visibleProjection} loading={startupLoading} runtimeLabel={selectedRuntime.descriptor.displayName} />}
          dock={startupLoading ? null : <>
            {approvalSmoke && <AgentApprovalDock
              approval={smokeApproval}
              queueLength={1}
              resolving={false}
              runtimeLabel={selectedRuntime.descriptor.displayName}
              onResolve={() => {}}
            />}
            <AgentComposer
              draft={draft}
              draftMentions={draftMentions}
              onDraftChange={setDraft}
              onDraftDocumentChange={(nextDraft, nextMentions) => {
                setDraft(nextDraft);
                setDraftMentions(nextMentions);
              }}
              disabled={startupLoading || approvalSmoke}
              running={approvalSmoke}
              stopping={false}
              submitting={false}
              configurationDisabled={startupLoading}
              placeholder={t("agent.composer.placeholder.followUp")}
              runtimeLabel={selectedRuntime.descriptor.displayName}
              sessionControls={sessionControls}
              onSelectSessionControl={(id, value) => {
                if (id === "model") setSelectedModel(value);
                if (id === "effort") setSelectedEffort(value);
              }}
              commands={[]}
              references={references}
              getReferencePreviewUrl={(id) => id === "attachment-capture"
                ? resolveRendererPublicAssetUrl(AGENT_BRAND_CATALOG.codex.assets.light)
                : null}
              referenceCapabilities={referenceCapabilities}
              onRemoveReference={(id) => setReferences((current) => current.filter((reference) => reference.id !== id))}
              onRetryReference={() => {}}
              onAddExternalFiles={() => {}}
              onPickWorkspaceReferences={() => {}}
              onSubmit={async () => {
                setDraft("");
                setDraftMentions([]);
                return true;
              }}
              onStop={() => {}}
            />
          </>}
        />
      </main>
      <DesktopOverlayPortal theme={theme}><></></DesktopOverlayPortal>
    </>
  );
}

function runtimeEntry(id: string, displayName: string, iconKey: string): AgentRuntimeCatalogEntry {
  return {
    descriptor: { id, displayName, iconKey, distribution: "user-installed" },
    readiness: { runtimeId: id, provider: id, status: "ready", code: "READY", version: "1.0.0", minimumVersion: null, message: "Ready", selectable: true },
  };
}

function model(id: string, displayName: string, isDefault = false): AgentModel {
  return {
    id,
    model: id,
    displayName,
    description: "Native coding Agent model",
    isDefault,
    variants: ["low", "medium", "high"],
    defaultVariant: "medium",
  };
}
