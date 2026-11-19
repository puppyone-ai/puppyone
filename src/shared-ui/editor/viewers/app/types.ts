import type { AppPreviewResult } from "../../../core/types";

export type AppPreviewMode = "preview" | "source" | "logs" | "settings";

export type AppPreviewViewState = {
  status: "idle" | "starting" | "running" | "stopped" | "error";
  runtime: AppPreviewResult | null;
  error: { code: "unavailable" | "start-failed"; detail: string | null } | null;
};
