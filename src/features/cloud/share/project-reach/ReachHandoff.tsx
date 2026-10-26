import { useLocalization } from "@puppyone/localization/react";
import { Check, Copy, ExternalLink, Eye, EyeOff } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Tooltip } from "@puppyone/shared-ui";
import { copyText } from "../../utils";
import { maskApiKey, type ShareHandoff } from "../shareHandoff";
import { shareTargetHandoffStepKey, type ShareTarget } from "../shareTargets";

/**
 * What the user has to carry to the other side, after the reach already
 * exists. It is the consequence of the one action, not a step of it: the
 * screen has already done everything it can do on the user's behalf.
 */
export function ReachHandoff({
  target,
  targetLabel,
  handoff,
  reused,
}: {
  target: ShareTarget;
  targetLabel: string;
  handoff: ShareHandoff;
  /** The destination already had this reach, so its key cannot be shown again. */
  reused: boolean;
}) {
  const { t } = useLocalization();
  const [keyVisible, setKeyVisible] = useState(false);
  const steps = Array.from({ length: target.handoffSteps }, (_, index) => (
    t(shareTargetHandoffStepKey(target.id, index + 1))
  ));

  return (
    <section
      className="desktop-reach-handoff"
      aria-label={t("cloud.share.handoff.title", { target: targetLabel })}
    >
      <h3>{target.brand
        ? t("cloud.share.handoff.title", { target: targetLabel })
        : t("cloud.share.handoff.titleGeneric")}</h3>
      <ol>
        {steps.map((step) => <li key={step}>{step}</li>)}
      </ol>
      {target.docsUrl && (
        <a
          className="desktop-share-handoff-docs"
          href={target.docsUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink size={12} aria-hidden="true" />
          <span>{t("cloud.share.handoff.docs", { target: targetLabel })}</span>
        </a>
      )}
      <div className="desktop-share-handoff-fields">
        {handoff.channel === "mcp" ? (
          <>
            <ReachCopyRow
              label={t("cloud.share.handoff.serverUrl")}
              value={handoff.serverUrl}
              display={handoff.serverUrl || t("cloud.access.connectionPreparing")}
            />
            <ReachCopyRow
              label={t("cloud.share.handoff.apiKey")}
              value={handoff.apiKey ?? ""}
              display={keyVisible && handoff.apiKey
                ? handoff.apiKey
                : maskApiKey(handoff.apiKey, handoff.apiKeyHint)}
              trailing={handoff.apiKey ? (
                <Tooltip content={t(keyVisible ? "cloud.share.action.hideKey" : "cloud.share.action.showKey")}><button
                  type="button"
                  className="desktop-share-copy-toggle"
                  aria-pressed={keyVisible}
                  aria-label={t(keyVisible ? "cloud.share.action.hideKey" : "cloud.share.action.showKey")}
                  onClick={() => setKeyVisible((visible) => !visible)}
                >
                  {keyVisible ? <EyeOff size={13} /> : <Eye size={13} />}
                </button></Tooltip>
              ) : null}
            />
            {reused && !handoff.apiKey && (
              <p className="desktop-share-handoff-note">{t("cloud.share.handoff.apiKeyReused")}</p>
            )}
          </>
        ) : (
          <>
            <ReachCopyRow
              label={t("cloud.share.handoff.link")}
              value={handoff.url}
              display={handoff.url}
            />
            <p className="desktop-share-handoff-note">{t("cloud.share.handoff.linkNote")}</p>
          </>
        )}
      </div>
    </section>
  );
}

function ReachCopyRow({
  label,
  value,
  display,
  trailing = null,
}: {
  label: string;
  value: string;
  display: string;
  trailing?: ReactNode;
}) {
  const { t } = useLocalization();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <div className="desktop-share-copy-field">
      <span className="desktop-share-copy-label">{label}</span>
      <code className="desktop-share-copy-value" dir="ltr">{display}</code>
      <span className="desktop-share-copy-actions">
        {trailing}
        <button
          type="button"
          className={`desktop-share-copy-button${copied ? " is-copied" : ""}`}
          disabled={!value}
          aria-label={t("cloud.share.action.copyLabel", { label })}
          onClick={() => {
            void copyText(value).then(() => setCopied(true)).catch(() => {});
          }}
        >
          {copied ? <Check size={13} strokeWidth={2.2} /> : <Copy size={13} />}
          <span>{t(copied ? "cloud.share.action.copied" : "cloud.share.action.copy")}</span>
        </button>
      </span>
    </div>
  );
}
