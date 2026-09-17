import {
  FolderSearch,
  Globe2,
  ListTree,
  TerminalSquare,
  Wrench,
} from "lucide-react";
import type { ReactNode } from "react";
import type { AgentActivityStatus } from "../../domain/agent-projection-types";

type AgentToolGlyphProps = Readonly<{
  tool: string;
  status: AgentActivityStatus;
}>;

type AgentToolGlyphKind =
  | "command"
  | "edit"
  | "fetch"
  | "generic"
  | "list"
  | "read"
  | "search"
  | "write";

const ACTIVE_STATUSES = new Set<AgentActivityStatus>(["running", "in-progress"]);

/**
 * Provider-neutral tool glyphs. Providers normalize activity names before the
 * Renderer reaches this boundary; aliases here only protect historical events.
 */
export function AgentToolGlyph({ tool, status }: AgentToolGlyphProps) {
  const kind = agentToolGlyphKind(tool);
  const active = ACTIVE_STATUSES.has(status);
  const className = `desktop-agent-tool-glyph is-${kind}${active ? " is-active" : ""}`;

  if (kind === "search") return <SearchGlyph className={className} />;
  if (kind === "read") return <ReadGlyph className={className} />;
  if (kind === "edit" || kind === "write") {
    return <WritingGlyph className={className} kind={kind} />;
  }

  const sharedProps = {
    className,
    size: 15,
    strokeWidth: 1.85,
    "aria-hidden": true,
  } as const;
  if (kind === "command") return <TerminalSquare {...sharedProps} />;
  if (kind === "fetch") return <Globe2 {...sharedProps} />;
  if (kind === "list") {
    return tool.trim().toLowerCase() === "list"
      ? <ListTree {...sharedProps} />
      : <FolderSearch {...sharedProps} />;
  }
  return <Wrench {...sharedProps} />;
}

export function agentToolGlyphKind(tool: string): AgentToolGlyphKind {
  const normalized = tool.trim().toLowerCase().replace(/[\s_-]+/gu, "");
  if (["grep", "search", "find", "filesearch"].includes(normalized)) return "search";
  if (["read", "readfile", "view", "openfile"].includes(normalized)) return "read";
  if (["edit", "patch", "applypatch", "replace"].includes(normalized)) return "edit";
  if (["write", "writefile", "create", "createfile"].includes(normalized)) return "write";
  if (["glob", "list", "listfiles", "foldersearch"].includes(normalized)) return "list";
  if (["fetch", "webfetch", "browse"].includes(normalized)) return "fetch";
  if (["bash", "shell", "command", "terminal"].includes(normalized)) return "command";
  return "generic";
}

function GlyphFrame({ className, children }: Readonly<{ className: string; children: ReactNode }>) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 18 18"
      xmlns="http://www.w3.org/2000/svg"
    >
      {children}
    </svg>
  );
}

function SearchGlyph({ className }: Readonly<{ className: string }>) {
  return (
    <GlyphFrame className={className}>
      <g className="desktop-agent-tool-glyph-motion">
        <circle cx="7.25" cy="7.25" r="4.25" />
        <path d="m10.45 10.45 4 4" />
      </g>
    </GlyphFrame>
  );
}

function ReadGlyph({ className }: Readonly<{ className: string }>) {
  return (
    <GlyphFrame className={className}>
      <path d="M4 2.5h6.25L14 6.25V15.5H4z" />
      <path d="M10.25 2.5v3.75H14" />
      <path d="M6.25 9h5.5M6.25 12h4.25" />
      <path className="desktop-agent-tool-glyph-scan" d="M5.75 8h6.5" />
    </GlyphFrame>
  );
}

function WritingGlyph({ className, kind }: Readonly<{ className: string; kind: "edit" | "write" }>) {
  return (
    <GlyphFrame className={className}>
      {kind === "edit" && <path d="M3.25 15h5.2" />}
      {kind === "write" && <path d="M3.25 3h6.5M3.25 6h4.5" />}
      <path className="desktop-agent-tool-glyph-ink" d="M3.5 14.25c1.6-.15 3.15-.55 4.55-1.2" />
      <g className="desktop-agent-tool-glyph-motion">
        <path d="m5.25 12.5.65-2.65 6.7-6.7 2.25 2.25-6.7 6.7z" />
        <path d="m11.45 4.3 2.25 2.25" />
      </g>
    </GlyphFrame>
  );
}
