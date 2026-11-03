import { useEffect, useRef, useState, type RefObject } from "react";
import { Check, FileText } from "lucide-react";
import { FolderIcon } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization/react";
import { DesktopTitlebarMenuLayer } from "../../../components/DesktopTitlebarMenuLayer";
import { getDesktopCloudWebUrl } from "../../../lib/cloudApi";
import { writeClipboardText } from "../../../lib/clipboard";
import { workspaceResourceUrl } from "../files/workspaceResourceUrl";
import type { ProjectCloudContext } from "../project/context";
import "./workspace-share.css";
import type { CloudWorkspaceShareResource } from "./cloudWorkspaceShareResource";

const COPY_LABEL = {
  idle: "cloud.share.people.copy",
  copying: "cloud.common.copying",
  copied: "cloud.share.action.copied",
  failed: "cloud.share.people.copy",
} as const;

type ResolvedContext = Extract<ProjectCloudContext, { status: "resolved" }>;
type ShareTarget = Readonly<{
  id: "resource" | "project";
  name: string;
  caption: "cloud.share.people.thisFile" | "cloud.share.people.thisFolder" | "cloud.share.people.wholeProject";
  directory: boolean;
  url: string;
}>;

/**
 * Share with people, as a card under the button that opens it: a link to what
 * is open and one to the whole project. Each row names what it opens, so a file
 * called anything still reads as a file. Agents are invited from their own card.
 */
export function CloudWorkspaceShareDialog({ anchor, context, resource, onClose }: {
  anchor: RefObject<HTMLElement | null>;
  context: ResolvedContext;
  resource?: CloudWorkspaceShareResource | null;
  onClose: () => void;
}) {
  const { t } = useLocalization();
  const [status, setStatus] = useState<Readonly<{ target: ShareTarget["id"]; state: "copying" | "copied" | "failed" }> | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const targets = shareTargets(context, resource);
  const copy = async ({ id, url }: ShareTarget) => {
    setStatus({ target: id, state: "copying" });
    try { await writeClipboardText(url); if (mounted.current) setStatus({ target: id, state: "copied" }); }
    catch { if (mounted.current) setStatus({ target: id, state: "failed" }); }
  };
  const failed = status?.state === "failed" ? targets.find(target => target.id === status.target) : undefined;
  return <DesktopTitlebarMenuLayer anchorRef={anchor} open onDismiss={onClose} dismissOnFocusExit={false}
    className="desktop-cloud-workspace-share" gap={6} preferredWidth={380} preferredMaxHeight={560}
    widthMode="fixed" alignment="end" role="dialog" ariaLabel={t("cloud.share.thisProject")}>
    <section className="desktop-cloud-share-people">
      <div className="desktop-cloud-share-heading">
        <h3>{t("cloud.share.people.title")}</h3>
        {/* The address grants nothing, so a failed copy takes this line rather than adding one. */}
        {failed
          ? <p role="alert">{t("cloud.share.copyFailed")}</p>
          : <p>{t("cloud.share.people.note")}</p>}
      </div>
      {targets.length > 0 ? <ul className="desktop-cloud-share-targets">
        {targets.map(target => {
          const state = status?.target === target.id ? status.state : "idle";
          const Icon = target.directory ? FolderIcon : FileText;
          const copied = state === "copied";
          return <li key={target.id} data-share-target={target.id} data-share-url={target.url}>
            <Icon size={15} strokeWidth={1.75} aria-hidden="true" />
            <span className="desktop-cloud-share-target-text">
              <span className="desktop-cloud-share-target-name" dir="auto">{target.name}</span>
              <span className="desktop-cloud-share-target-caption">{t(target.caption)}</span>
            </span>
            <button type="button" className="desktop-dialog-button desktop-cloud-share-copy"
              disabled={state === "copying"} aria-label={`${t("cloud.share.people.copy")} ${target.name}`}
              onClick={() => void copy(target)}>
              {copied && <Check size={14} aria-hidden="true" />}
              {t(COPY_LABEL[state])}
            </button>
          </li>;
        })}
      </ul> : <p role="alert">{t("cloud.share.publish.unavailable")}</p>}
      <span className="desktop-cloud-share-status" role="status">{status?.state === "copied" ? t("cloud.share.action.copied") : ""}</span>
      {/* The address is noise until the clipboard fails; then it is the way out. */}
      {failed && <input className="desktop-cloud-share-address" aria-label={t("cloud.share.handoff.link")}
        readOnly value={failed.url} dir="ltr" onFocus={event => event.currentTarget.select()} />}
    </section>
  </DesktopTitlebarMenuLayer>;
}

/**
 * What is open first, when it is not simply the whole of what can be shared. A
 * resource that cannot be linked offers nothing: the wider link would not be
 * what the person was looking at.
 */
function shareTargets(context: ResolvedContext, resource?: CloudWorkspaceShareResource | null): readonly ShareTarget[] {
  if (resource === null) return [];
  const root = context.scopePath ?? "";
  const rootName = lastName(root) || context.projectName || context.projectId;
  const rootUrl = shareUrl(context);
  const inner = resource && resource.path !== root ? resource : null;
  const innerUrl = inner && shareUrl(context, inner);
  if (!rootUrl || (inner && !innerUrl)) return [];
  return [
    ...(inner && innerUrl ? [{ id: "resource", name: lastName(inner.path) || rootName, directory: inner.directory, url: innerUrl,
      caption: inner.directory ? "cloud.share.people.thisFolder" : "cloud.share.people.thisFile" } as const] : []),
    { id: "project", name: rootName, directory: true, url: rootUrl,
      caption: context.target.kind === "scope" ? "cloud.share.people.thisFolder" : "cloud.share.people.wholeProject" },
  ];
}

function lastName(path: string) {
  return path.split("/").filter(Boolean).at(-1) ?? "";
}

function shareUrl(context: ResolvedContext, resource?: CloudWorkspaceShareResource) {
  if (context.target.kind === "scope" && !context.scopePath) return null;
  const path = resource?.path ?? context.scopePath ?? "";
  if (context.scopePath && path !== context.scopePath && !path.startsWith(`${context.scopePath}/`)) return null;
  try { return workspaceResourceUrl(getDesktopCloudWebUrl("/"), context.projectId, path, resource?.directory ?? true); }
  catch { return null; }
}
