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
    const isSame =
      cur.type === panel.type &&
      cur.nodeId === panel.nodeId &&
      cur.accessEndpointId === panel.accessEndpointId &&
      cur.agentId === panel.agentId &&
      cur.mcpEndpointId === panel.mcpEndpointId &&
      cur.sandboxEndpointId === panel.sandboxEndpointId;
    set({ panel: isSame ? NONE : panel });
  },
}));
