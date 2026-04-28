'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { mkdir, writeFile, treeList } from '@/lib/contentTreeApi';
import { refreshAllContentNodes } from '@/lib/hooks/useData';
import type { AccessResource } from '@/contexts/AgentContext';
import { ensureExpanded } from '../components/explorer';

export interface CreateMenuPosition {
  x: number;
  y: number;
  anchorLeft: number;
}

export interface DataCreateMenuActions {
  onClose: () => void;
  onCreateFolder: () => Promise<void>;
  onCreateBlankJson: () => Promise<void>;
  onCreateBlankMarkdown: () => Promise<void>;
  onImportFromFiles: () => void;
  onImportFromUrl: () => void;
  onImportFromSaas: () => void;
  onImportNotion: () => void;
  onImportGitHub: () => void;
  onImportGmail: () => void;
  onImportDocs: () => void;
  onImportCalendar: () => void;
  onImportSheets: () => void;
  onConnectSupabase: () => void;
  onImportSearchConsole: () => void;
  onImportLocalFolder: () => void;
  onCreateAgent: () => void;
  onCreateMcp: () => void;
  onCreateSandbox: () => void;
}

interface UseDataCreateFlowOptions {
  projectId: string;
  currentFolderId: string | null;
  navigateTo: (nextPath: string[], typeHint?: string) => void;
  openSyncCreatePanel: () => void;
  openSyncSetting: (provider: string, target?: AccessResource) => void;
}

function getCreateMenuOpenId(
  targetFolderId: string | null | undefined,
  currentFolderId: string | null,
) {
  if (targetFolderId === null) return '__root__';
  if (targetFolderId === undefined) return currentFolderId ?? '__root__';
  return targetFolderId;
}

export function useDataCreateFlow({
  projectId,
  currentFolderId,
  navigateTo,
  openSyncCreatePanel,
  openSyncSetting,
}: UseDataCreateFlowOptions) {
  const [createTableOpen, setCreateTableOpen] = useState(false);
  const [defaultStartOption, setDefaultStartOption] = useState<'documents' | 'url'>('documents');
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [createMenuPosition, setCreateMenuPosition] = useState<CreateMenuPosition | null>(null);
  const [createInFolderId, setCreateInFolderId] = useState<string | null | undefined>(undefined);
  // Two pieces of state for the per-folder plug-button flow.  When
  // a user clicks the plug, we open the same CreateMenu instance
  // but flip it into accessOnly mode (only renders the New Access
  // submenu content, flat) and stash the folder path that should
  // be pre-filled as the target on whichever provider the user
  // picks from the menu.  Reusing the existing create-menu state
  // machine — same position / outside-click-to-close /
  // reposition-on-scroll behaviour — instead of standing up a
  // second menu instance.
  const [createMenuAccessOnly, setCreateMenuAccessOnly] = useState(false);
  const [accessTargetPath, setAccessTargetPath] = useState<string | null>(null);
  const [highlightNodeId, setHighlightNodeId] = useState<string | null>(null);
  const createMenuRef = useRef<HTMLDivElement>(null);
  const createMenuTriggerRef = useRef<HTMLElement | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const createMenuOpenForId = createMenuOpen
    ? getCreateMenuOpenId(createInFolderId, currentFolderId)
    : undefined;

  const highlightCreatedNode = useCallback((nodeId: string) => {
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    setHighlightNodeId(nodeId);
    highlightTimerRef.current = setTimeout(() => setHighlightNodeId(null), 2500);
  }, []);

  const updateCreateMenuPosition = useCallback((triggerEl: HTMLElement) => {
    const triggerRect = triggerEl.getBoundingClientRect();
    const hostRect =
      triggerEl.closest('[data-menu-host="true"]')?.getBoundingClientRect() ?? triggerRect;

    setCreateMenuPosition({
      x: triggerRect.left,
      y: hostRect.bottom - 1,
      anchorLeft: triggerRect.left,
    });
  }, []);

  const closeCreateMenu = useCallback(() => {
    setCreateMenuOpen(false);
    setCreateMenuAccessOnly(false);
    setAccessTargetPath(null);
    createMenuTriggerRef.current = null;
  }, []);

  const openCreateMenu = useCallback(
    (event: ReactMouseEvent<Element>, parentId: string | null | undefined) => {
      event.preventDefault();
      event.stopPropagation();

      const triggerEl = event.currentTarget as HTMLElement;
      const nextOpenId = getCreateMenuOpenId(parentId, currentFolderId);
      const sameTrigger =
        createMenuOpen &&
        createMenuTriggerRef.current === triggerEl &&
        createMenuOpenForId === nextOpenId;

      if (sameTrigger) {
        closeCreateMenu();
        return;
      }

      createMenuTriggerRef.current = triggerEl;
      updateCreateMenuPosition(triggerEl);
      setCreateInFolderId(parentId);
      setCreateMenuOpen(true);
    },
    [
      closeCreateMenu,
      createMenuOpen,
      createMenuOpenForId,
      currentFolderId,
      updateCreateMenuPosition,
    ],
  );

  const handleCreateClick = useCallback(
    (event: ReactMouseEvent<Element>) => {
      openCreateMenu(event, undefined);
    },
    [openCreateMenu],
  );

  const handleMillerCreateClick = useCallback(
    (event: ReactMouseEvent<Element>, parentId: string | null) => {
      setCreateMenuAccessOnly(false);
      setAccessTargetPath(null);
      openCreateMenu(event, parentId);
    },
    [openCreateMenu],
  );

  // Per-folder plug-button entry point.  Same menu, but accessOnly
  // mode → flat list of providers/agents/endpoints, no Create-Blank
  // / Upload sections.  Stashes `folderPath` so the picker callbacks
  // below can pre-bind it as the target resource on whichever
  // provider the user picks.  The folder path is normalised the
  // same way as in page.tsx's openSyncCreatePanelForFolder ('' for
  // project root, raw path otherwise) so AgentContext's
  // `setDraftResources` keys line up with `accessByPath`.
  const handleAccessMenuClick = useCallback(
    (event: ReactMouseEvent<Element>, folderPath: string) => {
      setCreateMenuAccessOnly(true);
      setAccessTargetPath(folderPath);
      openCreateMenu(event, folderPath || null);
    },
    [openCreateMenu],
  );

  useEffect(() => {
    if (!createMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (createMenuRef.current?.contains(target)) return;
      if (createMenuTriggerRef.current?.contains(target)) return;
      closeCreateMenu();
    };

    const handleReposition = () => {
      const triggerEl = createMenuTriggerRef.current;
      if (!triggerEl) {
        closeCreateMenu();
        return;
      }
      updateCreateMenuPosition(triggerEl);
    };

    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
  }, [closeCreateMenu, createMenuOpen, updateCreateMenuPosition]);

  useEffect(
    () => () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    },
    [],
  );

  const PROVIDER_NODE_TYPE: Record<string, 'json' | 'markdown' | 'folder'> = {
    gmail: 'json',
    calendar: 'json',
    sheets: 'json',
    linear: 'json',
    supabase: 'json',
    docs: 'markdown',
    github: 'folder',
    notion: 'folder',
  };

  const PROVIDER_DEFAULT_NAMES: Record<string, string> = {
    gmail: 'Gmail Inbox',
    calendar: 'Calendar Events',
    sheets: 'Sheet Data',
    linear: 'Linear Issues',
    docs: 'Document',
    github: 'GitHub Repo',
    notion: 'Notion Pages',
    supabase: 'Supabase Data',
  };

  const handleCreateAndSync = useCallback(
    async (saasProvider: string) => {
      const nodeType = PROVIDER_NODE_TYPE[saasProvider];
      if (!nodeType) {
        openSyncSetting(saasProvider);
        openSyncCreatePanel();
        return;
      }

      const name = PROVIDER_DEFAULT_NAMES[saasProvider] || 'Untitled';
      const parentPath = currentFolderId ?? '';

      try {
        const fullPath = parentPath ? `${parentPath}/${name}` : name;

        if (nodeType === 'json') {
          await writeFile(projectId, fullPath, null, 'json');
        } else if (nodeType === 'markdown') {
          await writeFile(projectId, fullPath, '', 'markdown');
        } else {
          await mkdir(projectId, fullPath);
        }

        await refreshAllContentNodes(projectId);
        const resourceNodeType: 'folder' | 'json' | 'file' =
          nodeType === 'markdown' ? 'file' : nodeType;

        openSyncSetting(saasProvider, {
          path: fullPath,
          nodeName: name,
          nodeType: resourceNodeType,
          readonly: true,
        });
        openSyncCreatePanel();
      } catch {
        openSyncSetting(saasProvider);
        openSyncCreatePanel();
      }
    },
    [currentFolderId, openSyncCreatePanel, openSyncSetting, projectId],
  );

  // Provider-pick handler that branches on which menu launched it:
  //
  //   - plug menu (accessTargetPath !== null) → the user already
  //     picked a target by clicking the folder's plug, so skip the
  //     "create a node + bind it" dance.  Build the AccessResource
  //     directly from the prefilled folder path and seed it via
  //     `openSyncSetting`'s `preBindResource` argument.  The panel
  //     auto-jumps to the provider's config view (because
  //     pendingSyncProvider is set) with the target chip already
  //     populated (because draftResources[0] is set).
  //
  //   - + menu (accessTargetPath === null) → the user is starting
  //     from "create something new under this folder", so go through
  //     the existing handleCreateAndSync, which mints a new node
  //     (Notion / Gmail / etc. parent folder) and binds it as the
  //     target.
  //
  // Same provider id strings flow into both branches, so the panel's
  // pendingSyncProvider effect lights up the right config view either
  // way.
  const handleAccessSelect = useCallback(
    (provider: string) => {
      if (accessTargetPath !== null) {
        const segs = accessTargetPath.split('/').filter(Boolean);
        const nodeName = segs.length > 0 ? segs[segs.length - 1] : 'Root';
        openSyncSetting(provider, {
          path: accessTargetPath,
          nodeName,
          nodeType: 'folder',
          readonly: false,
        });
        openSyncCreatePanel();
      } else {
        void handleCreateAndSync(provider);
      }
    },
    [accessTargetPath, handleCreateAndSync, openSyncCreatePanel, openSyncSetting],
  );

  const createMenuActions = useMemo<DataCreateMenuActions>(() => {
    const getTargetFolderPath = () =>
      createInFolderId === undefined ? currentFolderId : createInFolderId;

    // Pick a name that doesn't collide with an existing entry at the
    // target folder.  We need this because creating a folder /
    // Untitled file with a literal hardcoded name would silently
    // no-op on the backend the second time around: mkdir writes
    // `<path>/.keep` (empty bytes) and writeFile writes the same
    // empty content, so MUT computes an identical commit hash and
    // skips it as a no-op.  The UI then refreshes the tree, sees
    // exactly the same nodes as before, and the user thinks the
    // click "did nothing" or "overwrote" the previous one.
    //
    // Convention: `Base`, `Base (2)`, `Base (3)`, … — same pattern
    // every native file manager uses, so users don't have to learn
    // anything new.  We probe up to 999 to keep the loop bounded;
    // in practice nobody creates 999 New Folders in one directory.
    //
    // For files we keep the extension contract intact: `Untitled`
    // (extension-less, JSON adds it server-side via writeFile's
    // `kind` parameter) and `Untitled Note` (markdown) get the
    // suffix appended *before* any extension, so collisions still
    // dedupe against bare names.
    const pickAvailableName = async (
      targetFolderPath: string | null,
      baseName: string,
    ): Promise<string> => {
      let siblings: Awaited<ReturnType<typeof treeList>>;
      try {
        siblings = await treeList(projectId, targetFolderPath ?? '', 1);
      } catch (err) {
        // If we can't reach the tree endpoint, fall back to the
        // base name and let the create call surface its own error.
        // Worse than the dedup-aware path but no worse than the
        // pre-fix behaviour.
        console.warn('treeList lookup failed, skipping dedup:', err);
        return baseName;
      }
      const existing = new Set(siblings.map((e) => e.name));
      if (!existing.has(baseName)) return baseName;
      for (let n = 2; n < 1000; n++) {
        const candidate = `${baseName} (${n})`;
        if (!existing.has(candidate)) return candidate;
      }
      // Outrageously unlikely fallback — append a timestamp so the
      // user gets a unique name rather than an infinite hang.
      return `${baseName} (${Date.now()})`;
    };

    return {
      onClose: closeCreateMenu,
      onCreateFolder: async () => {
        const targetFolderPath = getTargetFolderPath();

        try {
          const folderName = await pickAvailableName(
            targetFolderPath,
            'New Folder',
          );
          const folderPath = targetFolderPath
            ? `${targetFolderPath}/${folderName}`
            : folderName;
          await mkdir(projectId, folderPath);
          if (targetFolderPath) ensureExpanded(targetFolderPath);
          await refreshAllContentNodes(projectId);
          ensureExpanded(folderPath);
          highlightCreatedNode(folderPath);
        } catch (err) {
          console.error('Failed to create folder:', err);
        }
      },
      onCreateBlankJson: async () => {
        const targetFolderPath = getTargetFolderPath();

        try {
          const fileName = await pickAvailableName(
            targetFolderPath,
            'Untitled',
          );
          const filePath = targetFolderPath
            ? `${targetFolderPath}/${fileName}`
            : fileName;
          await writeFile(projectId, filePath, {}, 'json');
          if (targetFolderPath) ensureExpanded(targetFolderPath);
          await refreshAllContentNodes(projectId);
          highlightCreatedNode(filePath);
          navigateTo(filePath.split('/').filter(Boolean));
        } catch (err) {
          console.error('Failed to create JSON:', err);
        }
      },
      onCreateBlankMarkdown: async () => {
        const targetFolderPath = getTargetFolderPath();

        try {
          const fileName = await pickAvailableName(
            targetFolderPath,
            'Untitled Note',
          );
          const filePath = targetFolderPath
            ? `${targetFolderPath}/${fileName}`
            : fileName;
          await writeFile(projectId, filePath, '', 'markdown');
          if (targetFolderPath) ensureExpanded(targetFolderPath);
          await refreshAllContentNodes(projectId);
          highlightCreatedNode(filePath);
          navigateTo(filePath.split('/').filter(Boolean));
        } catch (err) {
          console.error('Failed to create markdown:', err);
        }
      },
      onImportFromFiles: () => {
        setDefaultStartOption('documents');
        setCreateTableOpen(true);
      },
      // From `+` menu (Upload → URL): open the createTable dialog
      // for inline URL import.
      // From plug menu (New Access → Web Page): same provider id
      // ("url" on the backend), but go through handleAccessSelect
      // so the panel lands on the URL connector's config view with
      // the user's plug-clicked folder pre-bound as target.  Branch
      // on accessTargetPath to pick which flow to run.
      onImportFromUrl: () => {
        if (accessTargetPath !== null) {
          handleAccessSelect('url');
        } else {
          setDefaultStartOption('url');
          setCreateTableOpen(true);
        }
      },
      // From `+` menu (New Access → More Sources…): generic
      // exploration entry, opens the panel on the picker view.
      // From plug menu: this entry is suppressed at the menu level
      // (see CreateMenu's accessOnly branch) — there's no
      // sensible "I don't know what kind of access I want" path
      // when the user already committed by clicking a specific
      // folder's plug.  Keep the callback defined for the `+` menu
      // path; the no-op-on-prefilled-target branch is just safety.
      onImportFromSaas: () => {
        if (accessTargetPath !== null) {
          return;
        }
        openSyncSetting('_generic');
        openSyncCreatePanel();
      },
      // All concrete-provider entries route through handleAccessSelect,
      // which decides — based on whether the menu was opened by the
      // plug button or by `+` — whether to prefill the user's target
      // folder or to mint a new sync node first.
      onImportNotion: () => handleAccessSelect('notion'),
      onImportGitHub: () => handleAccessSelect('github'),
      onImportGmail: () => handleAccessSelect('gmail'),
      onImportDocs: () => handleAccessSelect('docs'),
      onImportCalendar: () => handleAccessSelect('calendar'),
      onImportSheets: () => handleAccessSelect('sheets'),
      onConnectSupabase: () => handleAccessSelect('supabase'),
      onImportSearchConsole: () => handleAccessSelect('google_search_console'),
      onImportLocalFolder: () => handleAccessSelect('filesystem'),
      onCreateAgent: () => handleAccessSelect('chat'),
      onCreateMcp: () => handleAccessSelect('mcp'),
      onCreateSandbox: () => handleAccessSelect('sandbox'),
    };
  }, [
    accessTargetPath,
    closeCreateMenu,
    createInFolderId,
    currentFolderId,
    handleAccessSelect,
    highlightCreatedNode,
    navigateTo,
    openSyncCreatePanel,
    openSyncSetting,
    projectId,
  ]);

  const closeCreateTable = useCallback(() => {
    setCreateTableOpen(false);
    setDefaultStartOption('documents');
  }, []);

  return {
    createTableOpen,
    defaultStartOption,
    createMenuOpen,
    createMenuOpenForId,
    createMenuPosition,
    createMenuAccessOnly,
    createMenuRef,
    createMenuActions,
    highlightNodeId,
    handleCreateClick,
    handleMillerCreateClick,
    handleAccessMenuClick,
    closeCreateTable,
  };
}
