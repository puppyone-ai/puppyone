import { lazy, Suspense } from "react";
import { PageLoading } from "../../../components/loading";
import type { CloudAgentWorkbench } from "./CloudAgentWorkbench";

const Sidebar = lazy(() => import("./CloudAgentSidebar").then(module => ({ default: module.CloudAgentSidebar })));
export function CloudAgentSidebarHost(props: {
  workbench: CloudAgentWorkbench | null; active: boolean; open: boolean;
}) {
  if (!props.workbench || !props.open) return null;
  return <Suspense fallback={<PageLoading variant="fill" />}><Sidebar {...props} workbench={props.workbench} /></Suspense>;
}
