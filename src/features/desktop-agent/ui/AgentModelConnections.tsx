import { useEffect, useRef, useState } from "react";
import { useLocalization } from "@puppyone/localization";
import { ModelConnectionsSettings, useModelConnections } from "../../model-connections";

/** The setup surface belongs to Model Connections; Chat owns only its opening intent. */
export function AgentModelConnections({ onClose, disabled }: { onClose: () => void; disabled: boolean }) {
  const { t } = useLocalization();
  const [open, setOpen] = useState(false);
  const { state } = useModelConnections();
  const lastRevision = useRef<number | null>(null);
  const onCatalogChange = useRef(onClose);
  onCatalogChange.current = onClose;
  useEffect(() => {
    const revision = state.snapshot?.revision;
    if (disabled || revision == null || revision === lastRevision.current) return;
    lastRevision.current = revision;
    onCatalogChange.current();
  }, [disabled, state.snapshot?.revision]);
  return <div className="desktop-agent-model-connections">
    <button type="button" disabled={disabled} aria-expanded={open} onClick={() => {
      setOpen(!open);
      if (open) onClose();
    }}>{t(open ? "settings.modelConnections.closeSetup" : "settings.modelConnections.manage")}</button>
    {open && <ModelConnectionsSettings embedded />}
  </div>;
}
