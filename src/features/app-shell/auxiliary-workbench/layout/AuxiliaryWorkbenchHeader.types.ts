import type { ReactNode } from "react";
import type { AuxiliaryWorkbenchItemSnapshot } from "../types";
export type AuxiliaryWorkbenchHeaderItem = Readonly<{
  id: string;
  kind: string;
  snapshot: AuxiliaryWorkbenchItemSnapshot;
  statusIcon?: ReactNode;
}>;
