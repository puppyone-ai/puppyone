import type { ReactNode } from "react";
import type { AuxiliaryWorkbenchItemSnapshot } from "../../../../lib/workbench/types";
export type AuxiliaryWorkbenchHeaderItem = Readonly<{
  id: string;
  headerKey?: string;
  kind: string;
  snapshot: AuxiliaryWorkbenchItemSnapshot;
  statusIcon?: ReactNode;
}>;
