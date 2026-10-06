import { lazy, Suspense } from "react";
import { PageLoading } from "../../../components/loading";
import type { CloudAgentController, CloudAgentState } from "./CloudAgentController";

const Sidebar = lazy(() => import("./CloudAgentSidebar").then(module => ({ default: module.CloudAgentSidebar })));
export function CloudAgentSidebarHost(props: {
  controller: CloudAgentController | null; state: CloudAgentState; active: boolean; title: string;
}) {
  if (!props.controller || !props.state.open) return null;
  return <Suspense fallback={<PageLoading variant="fill" />}><Sidebar {...props} controller={props.controller} /></Suspense>;
}
