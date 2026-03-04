import { create } from 'zustand';

export type PanelType =
  | 'none'
  | 'version_history'
  | 'sync_config'
  | 'sync_create'
  | 'agent_chat'
  | 'mcp_config'
  | 'sandbox_config';

export interface PanelState {
  type: PanelType;
  nodeId?: string;
  agentId?: string;
  mcpEndpointId?: string;
  sandboxEndpointId?: string;
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
      cur.agentId === panel.agentId &&
      cur.mcpEndpointId === panel.mcpEndpointId &&
      cur.sandboxEndpointId === panel.sandboxEndpointId;
    set({ panel: isSame ? NONE : panel });
  },
}));
