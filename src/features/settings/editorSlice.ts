import { parseCreateNewMenuSettings, parseFilesVisibilitySettings } from "../../preferences";
import { DEFAULT_MARKDOWN_PRESENTATION_SETTINGS } from "../markdown";
import { applyPreferenceUpdate, type PreferenceSlice } from "./preferenceActions";
import type { EditorSlice } from "./preferenceTypes";

export const createEditorSlice: PreferenceSlice<EditorSlice> = (set) => ({
  aiEditAssistEnabled: false,
  setAiEditAssistEnabled: (update) => set((state) => ({ aiEditAssistEnabled: applyPreferenceUpdate(update, state.aiEditAssistEnabled) })),
  filesVisibilitySettings: parseFilesVisibilitySettings(null),
  setFilesVisibilitySettings: (update) => set((state) => ({ filesVisibilitySettings: applyPreferenceUpdate(update, state.filesVisibilitySettings) })),
  createNewMenuSettings: parseCreateNewMenuSettings(null),
  setCreateNewMenuSettings: (update) => set((state) => ({ createNewMenuSettings: applyPreferenceUpdate(update, state.createNewMenuSettings) })),
  markdownPresentation: DEFAULT_MARKDOWN_PRESENTATION_SETTINGS,
  setMarkdownPresentation: (update) => set((state) => ({ markdownPresentation: applyPreferenceUpdate(update, state.markdownPresentation) })),
});
