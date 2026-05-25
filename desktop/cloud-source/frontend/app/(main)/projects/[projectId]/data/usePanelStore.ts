import { create } from 'zustand';

export type PanelType =
  | 'none'
  | 'version_history'
  | 'sync_config'
  | 'sync_create'
  | 'access_list'
  | 'agent_chat'
  | 'mcp_config'
  | 'sandbox_config';

export interface PanelState {
  type: PanelType;
  nodeId?: string;
  accessEndpointId?: string;
  agentId?: string;
  mcpEndpointId?: string;
  sandboxEndpointId?: string;
  /** When opening sync_create from a scope's "AI Agent" default, set
   *  this to 'chat' so the create panel skips the type-picker and lands
   *  directly on the chat-agent form. */
  agentTypePreselect?: 'chat';
  /** Drill-down state for the access_list panel: when set, the panel
   *  renders the detail view of *this specific scope* rather than the
   *  one matched against the current file-tree folder. Set by the
   *  Overview's row-click handler and by the file-tree row's chain
   *  icon; cleared by file-tree navigation or by the back button. */
  selectedScopeId?: string;
  /** Explicit access_list view selection.
   *  - `'overview'`  — render the all-scopes list, regardless of
   *                    whether the current folder happens to be a
   *                    scope. Set by the back button so the user has
   *                    a stable "management home" to return to.
   *  - `'detail'`    — render scope detail (paired with selectedScopeId
   *                    when drilling in from a non-scope folder).
   *  - `'settings'`  — render the selected scope's dedicated settings
   *                    page. This is a sibling of detail, not an inline
   *                    expansion inside it.
   *  - `'create'`    — render the dedicated "Create access point"
   *                    sub-page (Pp.2b in the 3-page hierarchy). The
   *                    target path is read from `nodeId` so callers
   *                    can pre-fill the form with whichever folder
   *                    triggered the action (sidebar chain icon on a
   *                    non-scope folder, or the Overview's CTA).
   *  - `undefined`   — auto: detail when current folder is a scope,
   *                    overview otherwise.
   *
   *  File-tree navigation only resets implicit/drilled `'detail'` (so
   *  it can re-pick a matching folder scope) — `'overview'`, `'settings'`,
   *  and `'create'` are explicit user choices and stay sticky until the
   *  user explicitly navigates away (back button / close). */
  view?: 'overview' | 'detail' | 'settings' | 'create';
}

interface PanelStore {
  panel: PanelState;
  openPanel: (panel: PanelState) => void;
  closePanel: () => void;
  togglePanel: (panel: PanelState) => void;
}

const NONE: PanelState = { type: 'none' };

export const usePanelStore = create<PanelStore>((set, get) => ({
  panel: NONE,

  openPanel: (panel) => set({ panel }),

  closePanel: () => set({ panel: NONE }),

  togglePanel: (panel) => {
    const cur = get().panel;
    // For access_list, treat any same-type click as a toggle-close —
    // the panel auto-syncs to the current folder, so reopening with a
    // different nodeId is the same surface conceptually. Without this,
    // navigating the file tree would leave the chip's "click again to
    // close" behaviour broken because cur.nodeId and panel.nodeId
    // mismatch.
    if (panel.type === 'access_list') {
      set({ panel: cur.type === 'access_list' ? NONE : panel });
      return;
    }
    const isSame =
      cur.type === panel.type &&
      cur.nodeId === panel.nodeId &&
      cur.accessEndpointId === panel.accessEndpointId &&
      cur.agentId === panel.agentId &&
      cur.mcpEndpointId === panel.mcpEndpointId &&
      cur.sandboxEndpointId === panel.sandboxEndpointId &&
      cur.selectedScopeId === panel.selectedScopeId &&
      cur.view === panel.view;
    set({ panel: isSame ? NONE : panel });
  },
}));
