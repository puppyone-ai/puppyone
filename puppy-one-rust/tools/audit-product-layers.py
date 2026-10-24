#!/usr/bin/env python3
"""Record reviewed Web-to-Rust ownership, without treating paths as parity."""
import hashlib
import json
import os
from datetime import datetime
from pathlib import Path
import subprocess

root=Path(__file__).resolve().parents[1]
config=json.loads((root/'product-source.json').read_text())
source=Path(os.environ.get('PUPPYONE_PRODUCT_ROOT',root/config['checkout'])).resolve()
groups=[
 ('Document persistence', ['packages/shared-ui/src/editor/document-session/DocumentEditingSession.ts','packages/shared-ui/src/editor/document-session/autoSavePolicy.ts'], ['src/editor/document_session/document_editing_session.rs','src/editor/document_session/types.rs','src/documents.rs','src/workspace.rs'], 'One save queue, disk epochs, frozen navigation snapshots; full L3 resource registry and multi-pane lifetime remain unported.'),
 ('Settings composition', ['src/features/settings/SettingsDialog.tsx','src/features/settings/SettingsWorkspaceSurface.tsx','src/features/settings/sidebar/SettingsSidebar.tsx','src/components/SettingsControls.tsx'], ['src/shell/tasks.rs','src/features/settings/settings_workspace_surface.rs','src/features/settings/sidebar/settings_sidebar.rs','src/features/settings/sidebar/settings_sidebar_model.rs','src/features/settings/components.rs','src/features/settings/preferences_store.rs','src/platform/preference_storage.rs'], 'Dialog/sidebar/main with one persisted preference owner; platform storage replaces Electron IPC.'),
 ('Settings pages', [f'src/features/settings/main/{p}SettingsView.tsx' for p in ['General','Appearance','Typography','CreateNew','Experimental']], [f'src/features/settings/main/{p}_settings_view.rs' for p in ['general','appearance','typography','create_new','experimental']], 'Implemented native preferences only; complete palette/interface-style/file-icon and experimental services are not ported.'),
 ('Create entry', ['src/features/create-new/createEntryMenuRegistry.ts','src/features/settings/main/CreateNewSettingsView.tsx'], ['src/features/create_new/create_entry_menu_registry.rs','src/features/create_new/create_entry_draft.rs','src/features/create_new/create_entry_dialog.rs','src/features/create_new/native_create_entry.rs','src/shell/create_new.rs'], 'Menu and settings share one registry. Folder/Markdown/text/JSON/CSV/HTML create exclusively; specialised formats remain unavailable.'),
 ('Agent composition', ['src/features/desktop-agent/ui/AgentChatTabPanel.tsx','src/features/desktop-agent/ui/AgentComposer.tsx','src/features/desktop-agent/ui/composer/AgentComposerToolbar.tsx','src/features/desktop-agent/ui/AgentTranscript.tsx','src/features/desktop-agent/ui/AgentSurfaceHeader.tsx','src/features/desktop-agent/ui/AgentConversationHistory.tsx','src/features/desktop-agent/ui/AgentSessionControlPicker.tsx'], ['src/features/desktop_agent/ui/agent_chat_tab_panel.rs','src/features/desktop_agent/ui/agent_composer.rs','src/features/desktop_agent/ui/agent_composer_references.rs','src/features/desktop_agent/ui/agent_transcript.rs','src/features/desktop_agent/ui/agent_surface_header.rs','src/features/desktop_agent/ui/agent_history.rs','src/features/desktop_agent/ui/agent_session_control_picker.rs','src/features/desktop_agent/application/session_draft_store.rs'], 'Views consume the session controller/runtime port; complete display-schema/mentions/feed contracts and visual parity are still pending.'),
 ('Auxiliary launcher', ['src/features/app-shell/auxiliary-workbench/AuxiliaryWorkbenchLauncher.tsx'], ['src/features/workbench/auxiliary_workbench_launcher.rs','src/features/workbench/mod.rs','src/features/workbench/layout.rs'], 'Shared workbench topology, separate chat/terminal owners; launcher visibility does not own process lifetime.'),
]
def hashes(base,paths):
 return {str(p):hashlib.sha256((base/p).read_bytes()).hexdigest() for p in paths}
receipt={'capturedAt':datetime.now().astimezone().isoformat(),'observedSourceCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=source,text=True).strip(),'scope':'Reviewed product boundaries; mappings do not prove full behavior or pixel parity. Input hashes identify dirty source independently of HEAD.','groups':[{'owner':name,'sourceHashes':hashes(source,src),'rustHashes':hashes(root,dst),'contract':contract} for name,src,dst,contract in groups]}
out=root/'artifacts/product-layer-audit.json';out.parent.mkdir(exist_ok=True);out.write_text(json.dumps(receipt,indent=2)+'\n');print(f'Checked {len(groups)} product ownership mappings; {out.relative_to(root)}')
