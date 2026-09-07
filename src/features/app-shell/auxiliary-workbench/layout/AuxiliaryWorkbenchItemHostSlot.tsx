import { useLayoutEffect, useRef } from "react";

/** Reparents one stable Item host into its selected Group before paint. */
export function AuxiliaryWorkbenchItemHostSlot({
  focused,
  host,
  labelledBy,
  panelId,
  itemId,
}: Readonly<{
  focused: boolean;
  host: HTMLDivElement;
  labelledBy: string;
  panelId: string;
  itemId: string;
}>) {
  const slotRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const slot = slotRef.current;
    if (!slot) return undefined;
    slot.append(host);
    return () => {
      if (host.parentElement === slot) host.remove();
    };
  }, [host]);

  return (
    <div
      ref={slotRef}
      id={panelId}
      className="desktop-terminal-session-pane"
      data-terminal-session-pane-id={itemId}
      data-terminal-workbench-item-pane-id={itemId}
      data-focused={focused ? "true" : undefined}
      role="tabpanel"
      aria-labelledby={labelledBy}
    />
  );
}
