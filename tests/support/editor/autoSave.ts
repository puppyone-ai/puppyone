import { act } from "react";
import { AUTO_SAVE_IDLE_MS } from "../../../src/shared-ui/editor/document-session/autoSavePolicy";

/** Auto-save writes once the person stops typing; wait out that pause inside React. */
export async function afterTypingPause(): Promise<void> {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, AUTO_SAVE_IDLE_MS + 20)); });
}
