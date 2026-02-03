'use client';

import { useState, useEffect, useCallback } from 'react';
// URL parsing功能已移至 TableManageDialog
// import {
//   parseUrl,
//   importData,
//   type ParseUrlResponse,
//   type CrawlOptions,
// } from '../lib/connectApi';
// import CrawlOptionsPanel from './CrawlOptionsPanel';
import {
  getGithubStatus,
  disconnectGithub,
  type GithubStatusResponse,
  getGoogleSheetsStatus,
  disconnectGoogleSheets,
  type GoogleSheetsStatusResponse,
  getGmailStatus,
  disconnectGmail,
  getGoogleCalendarStatus,
  getGoogleDriveStatus,
  getGoogleDocsStatus,
  disconnectGoogleDocs,
  openOAuthPopup,
  type SaasType,
} from '../lib/oauthApi';
import { useProjects } from '../lib/hooks/useData';

type ConnectContentViewProps = {
  onBack: () => void;
};

type PlatformId = 'github' | 'google-sheets' | 'google-docs' | 'gmail' | 'google-calendar' | 'google-drive';

type PlatformStatusType = 'disconnected' | 'connected' | 'error';

type PlatformState = {
  status: PlatformStatusType;
  label: string;
  isLoading: boolean;
};

type PlatformConfig = {
  id: PlatformId;
  name: string;
  description: string;
  isEnabled: boolean;
  icon: JSX.Element;
};

const platformConfigs: PlatformConfig[] = [
  {
    id: 'github',
    name: 'GitHub',
    description: 'Issues, projects, repos',
    isEnabled: true,
    icon: (
      <svg width='20' height='20' viewBox='0 0 24 24' fill='currentColor'>
        <path d='M12 2C6.477 2 2 6.59 2 12.253c0 4.51 2.865 8.332 6.839 9.69.5.1.683-.223.683-.495 0-.244-.01-1.051-.015-1.905-2.782.615-3.369-1.215-3.369-1.215-.455-1.185-1.11-1.5-1.11-1.5-.908-.636.069-.623.069-.623 1.002.072 1.53 1.058 1.53 1.058.893 1.567 2.343 1.115 2.914.853.091-.663.35-1.115.636-1.372-2.221-.259-4.555-1.136-4.555-5.056 0-1.117.387-2.03 1.024-2.746-.103-.26-.444-1.303.098-2.716 0 0 .837-.272 2.744 1.048a9.205 9.205 0 0 1 2.5-.346c.848.004 1.705.118 2.505.346 1.905-1.32 2.741-1.048 2.741-1.048.544 1.413.203 2.456.1 2.716.64.716 1.023 1.629 1.023 2.746 0 3.931-2.338 4.794-4.566 5.047.36.318.68.94.68 1.896 0 1.368-.013 2.471-.013 2.809 0 .274.18.598.688.495C19.138 20.582 22 16.761 22 12.253 22 6.59 17.523 2 12 2z' />
      </svg>
    ),
  },
  {
    id: 'google-sheets',
    name: 'Google Sheets',
    description: 'Spreadsheets, worksheets',
    isEnabled: true,
    icon: (
      <img src="/icons/google_sheet.svg" alt="Google Sheets" width={20} height={20} style={{ display: 'block' }} />
    ),
  },
  {
    id: 'google-docs',
    name: 'Google Docs',
    description: 'Documents, notes',
    isEnabled: true,
    icon: (
      <img src="/icons/google_doc.svg" alt="Google Docs" width={20} height={20} style={{ display: 'block' }} />
    ),
  },
  {
    id: 'gmail',
    name: 'Gmail',
    description: 'Emails, contacts',
    isEnabled: true,
    icon: (
      <img src="/icons/gmail.svg" alt="Gmail" width={20} height={20} style={{ display: 'block' }} />
    ),
  },
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    description: 'Events, schedules',
    isEnabled: true,
    icon: (
      <img src="/icons/google_calendar.svg" alt="Google Calendar" width={20} height={20} style={{ display: 'block' }} />
    ),
  },
  // Google Drive temporarily hidden - not yet implemented
  // {
  //   id: 'google-drive',
  //   name: 'Google Drive',
  //   description: 'Files, folders',
  //   isEnabled: true,
  //   icon: (
  //     <svg width='20' height='20' viewBox='0 0 24 24' fill='currentColor'>
  //       <path d='M7.71 3.5L1.15 15l2.29 4.01L10 7.5 7.71 3.5zm6.58 0l-6.58 11h6.58l6.58-11h-6.58zm2.56 11.5L22.85 15l-2.14 3.75-3.36-3.75h-.5z' />
  //     </svg>
  //   ),
  // },
];

const getDefaultPlatformStates = (): Record<PlatformId, PlatformState> =>
  platformConfigs.reduce(
    (acc, platform) => {
      acc[platform.id] = {
        status: 'disconnected',
        label: platform.isEnabled ? 'Not connected' : 'Coming soon',
        isLoading: false,
      };
      return acc;
    },
    {} as Record<PlatformId, PlatformState>
  );

const statusColors: Record<PlatformStatusType, string> = {
  connected: '#22c55e',
  disconnected: '#595959',
  error: '#ef4444',
};

export function ConnectContentView({ onBack }: ConnectContentViewProps) {
  const { projects } = useProjects();

  // URL parsing功能已移至 TableManageDialog
  // const [url, setUrl] = useState('');
  // const [isLoading, setIsLoading] = useState(false);
  // const [error, setError] = useState<string | null>(null);
  // const [parseResult, setParseResult] = useState<ParseUrlResponse | null>(null);

  // OAuth states
  const [githubStatus, setGithubStatus] = useState<GithubStatusResponse>({
    connected: false,
  });
  const [googleSheetsStatus, setGoogleSheetsStatus] =
    useState<GoogleSheetsStatusResponse>({
      connected: false,
    });
  const [gmailStatus, setGmailStatus] = useState<{ connected: boolean; email?: string }>({
    connected: false,
  });
  const [googleCalendarStatus, setGoogleCalendarStatus] = useState<{ connected: boolean; email?: string }>({
    connected: false,
  });
  const [googleDriveStatus, setGoogleDriveStatus] = useState<{ connected: boolean; email?: string }>({
    connected: false,
  });
  const [googleDocsStatus, setGoogleDocsStatus] = useState<{ connected: boolean; email?: string }>({
    connected: false,
  });
  const [platformStates, setPlatformStates] = useState<
    Record<PlatformId, PlatformState>
  >(() => getDefaultPlatformStates());
  const [disconnectConfirmation, setDisconnectConfirmation] = useState<{
    visible: boolean;
    platformId: PlatformId | null;
  }>({
    visible: false,
    platformId: null,
  });
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const getPlatformName = useCallback((platformId: PlatformId) => {
    return (
      platformConfigs.find(platform => platform.id === platformId)?.name ??
      platformId
    );
  }, []);

  // URL parsing和导入功能已移至 TableManageDialog
  // // Import settings
  // const [selectedProjectId, setSelectedProjectId] = useState<number | null>(
  //   null
  // );
  // const [targetTableId, setTargetTableId] = useState<number | null>(null);
  // const [newTableName, setNewTableName] = useState('');
  // const [isImporting, setIsImporting] = useState(false);
  // const [importSuccess, setImportSuccess] = useState(false);

  // // Crawl options for web scraping
  // const [crawlOptions, setCrawlOptions] = useState<CrawlOptions>({
  //   limit: 50,  // Reduced to avoid timeout
  //   maxDepth: 3,
  //   crawlEntireDomain: true,
  //   sitemap: 'include',
  // });

  const updatePlatformState = useCallback(
    (platformId: PlatformId, updates: Partial<PlatformState>) => {
      setPlatformStates(prev => ({
        ...prev,
        [platformId]: {
          ...prev[platformId],
          ...updates,
        },
      }));
    },
    []
  );

  const checkGithubStatus = useCallback(async () => {
    updatePlatformState('github', { isLoading: true });
    try {
      const status = await getGithubStatus();
      setGithubStatus(status);
      updatePlatformState('github', {
        status: status.connected ? 'connected' : 'disconnected',
        label: status.connected
          ? status.username
            ? `Connected to ${status.username}`
            : 'Connected'
          : 'Not connected',
        isLoading: false,
      });
    } catch (err) {
      console.error('Failed to check GitHub status:', err);
      updatePlatformState('github', {
        status: 'error',
        label: 'Authorization error',
        isLoading: false,
      });
    }
  }, [updatePlatformState]);

  const checkGoogleSheetsStatus = useCallback(async () => {
    updatePlatformState('google-sheets', { isLoading: true });
    try {
      const status = await getGoogleSheetsStatus();
      setGoogleSheetsStatus(status);
      updatePlatformState('google-sheets', {
        status: status.connected ? 'connected' : 'disconnected',
        label: status.connected
          ? status.workspace_name
            ? `Connected to ${status.workspace_name}`
            : 'Connected'
          : 'Not connected',
        isLoading: false,
      });
    } catch (err) {
      console.error('Failed to check Google Sheets status:', err);
      updatePlatformState('google-sheets', {
        status: 'error',
        label: 'Authorization error',
        isLoading: false,
      });
    }
  }, [updatePlatformState]);

  const checkGmailStatus = useCallback(async () => {
    updatePlatformState('gmail', { isLoading: true });
    try {
      const status = await getGmailStatus();
      setGmailStatus(status);
      updatePlatformState('gmail', {
        status: status.connected ? 'connected' : 'disconnected',
        label: status.connected
          ? status.email
            ? `Connected to ${status.email}`
            : 'Connected'
          : 'Not connected',
        isLoading: false,
      });
    } catch (err) {
      console.error('Failed to check Gmail status:', err);
      updatePlatformState('gmail', {
        status: 'error',
        label: 'Authorization error',
        isLoading: false,
      });
    }
  }, [updatePlatformState]);

  const checkGoogleCalendarStatus = useCallback(async () => {
    updatePlatformState('google-calendar', { isLoading: true });
    try {
      const status = await getGoogleCalendarStatus();
      setGoogleCalendarStatus(status);
      updatePlatformState('google-calendar', {
        status: status.connected ? 'connected' : 'disconnected',
        label: status.connected
          ? status.email
            ? `Connected to ${status.email}`
            : 'Connected'
          : 'Not connected',
        isLoading: false,
      });
    } catch (err) {
      console.error('Failed to check Google Calendar status:', err);
      updatePlatformState('google-calendar', {
        status: 'error',
        label: 'Authorization error',
        isLoading: false,
      });
    }
  }, [updatePlatformState]);

  const checkGoogleDriveStatus = useCallback(async () => {
    updatePlatformState('google-drive', { isLoading: true });
    try {
      const status = await getGoogleDriveStatus();
      setGoogleDriveStatus(status);
      updatePlatformState('google-drive', {
        status: status.connected ? 'connected' : 'disconnected',
        label: status.connected
          ? status.email
            ? `Connected to ${status.email}`
            : 'Connected'
          : 'Not connected',
        isLoading: false,
      });
    } catch (err) {
      console.error('Failed to check Google Drive status:', err);
      updatePlatformState('google-drive', {
        status: 'error',
        label: 'Authorization error',
        isLoading: false,
      });
    }
  }, [updatePlatformState]);

  const checkGoogleDocsStatus = useCallback(async () => {
    updatePlatformState('google-docs', { isLoading: true });
    try {
      const status = await getGoogleDocsStatus();
      setGoogleDocsStatus(status);
      updatePlatformState('google-docs', {
        status: status.connected ? 'connected' : 'disconnected',
        label: status.connected
          ? status.email
            ? `Connected to ${status.email}`
            : 'Connected'
          : 'Not connected',
        isLoading: false,
      });
    } catch (err) {
      console.error('Failed to check Google Docs status:', err);
      updatePlatformState('google-docs', {
        status: 'error',
        label: 'Authorization error',
        isLoading: false,
      });
    }
  }, [updatePlatformState]);

  // Map platform ID to SaasType
  const platformToSaasType: Record<PlatformId, SaasType> = {
    'github': 'github',
    'google-sheets': 'sheets',
    'google-docs': 'docs',
    'gmail': 'gmail',
    'google-calendar': 'calendar',
    'google-drive': 'drive',
  };

  // Map platform ID to status check function
  const platformStatusCheckers: Record<PlatformId, () => Promise<void>> = {
    'github': checkGithubStatus,
    'google-sheets': checkGoogleSheetsStatus,
    'google-docs': checkGoogleDocsStatus,
    'gmail': checkGmailStatus,
    'google-calendar': checkGoogleCalendarStatus,
    'google-drive': checkGoogleDriveStatus,
  };

  const startOAuthConnect = async (platformId: PlatformId) => {
    const saasType = platformToSaasType[platformId];
    const platformName = getPlatformName(platformId);
    
    updatePlatformState(platformId, {
      isLoading: true,
      label: `Connecting to ${platformName}…`,
    });
    
    try {
      const completed = await openOAuthPopup(saasType);
      
      if (completed) {
        // Popup closed, refresh the status
        await platformStatusCheckers[platformId]();
      } else {
        // Timeout or cancelled
        updatePlatformState(platformId, {
          isLoading: false,
          label: 'Authorization cancelled',
        });
        // Reset after a moment
        setTimeout(() => {
          platformStatusCheckers[platformId]();
        }, 2000);
      }
    } catch (err) {
      console.error(`Failed to connect to ${platformName}:`, err);
      updatePlatformState(platformId, {
        status: 'error',
        label: 'Authorization error',
        isLoading: false,
      });
    }
  };

  const handleDisconnectConfirm = async () => {
    const platformId = disconnectConfirmation.platformId;
    if (
      !platformId ||
      !['github', 'google-sheets', 'google-docs', 'gmail', 'google-calendar', 'google-drive'].includes(
        platformId
      )
    ) {
      closeDisconnectModal();
      return;
    }

    updatePlatformState(platformId, {
      isLoading: true,
      label: 'Disconnecting…',
    });
    try {
      if (platformId === 'github') {
        await disconnectGithub();
        setGithubStatus({ connected: false });
      } else if (platformId === 'google-sheets') {
        await disconnectGoogleSheets();
        setGoogleSheetsStatus({ connected: false });
      } else if (platformId === 'google-docs') {
        await disconnectGoogleDocs();
        setGoogleDocsStatus({ connected: false });
      } else if (platformId === 'gmail') {
        await disconnectGmail();
        setGmailStatus({ connected: false });
      } else if (platformId === 'google-calendar') {
        // Google Calendar disconnect not implemented yet
        setGoogleCalendarStatus({ connected: false });
      } else if (platformId === 'google-drive') {
        // Google Drive disconnect not implemented yet
        setGoogleDriveStatus({ connected: false });
      }

      updatePlatformState(platformId, {
        status: 'disconnected',
        label: 'Not connected',
        isLoading: false,
      });
    } catch (err) {
      console.error(
        `Failed to disconnect from ${getPlatformName(platformId)}:`,
        err
      );
      updatePlatformState(platformId, {
        status: 'error',
        label: 'Authorization error',
        isLoading: false,
      });
    } finally {
      closeDisconnectModal();
    }
  };

  const handlePlatformToggle = (
    platformId: PlatformId,
    nextChecked: boolean
  ) => {
    const state = platformStates[platformId];
    const platformConfig = platformConfigs.find(
      platform => platform.id === platformId
    );
    if (!platformConfig?.isEnabled || !state || state.isLoading) {
      return;
    }

    if (nextChecked) {
      if (state.status === 'connected') {
        return;
      }

      void startOAuthConnect(platformId);
    } else {
      setDisconnectConfirmation({ visible: true, platformId });
    }
  };

  const handlePlatformRowClick = (platformId: PlatformId) => {
    const state = platformStates[platformId];
    if (state?.status === 'error') {
      window.alert('Re-authorize to fix connection');
    }
  };

  const closeDisconnectModal = () => {
    setDisconnectConfirmation({ visible: false, platformId: null });
  };

  useEffect(() => {
    const checkAllPlatformStatus = async () => {
      setIsInitialLoading(true);
      await Promise.allSettled([
        checkGithubStatus(),
        checkGoogleSheetsStatus(),
        checkGoogleDocsStatus(),
        checkGmailStatus(),
        checkGoogleCalendarStatus(),
        checkGoogleDriveStatus(),
      ]);
      setIsInitialLoading(false);
    };

    void checkAllPlatformStatus();
  }, [
    checkGithubStatus,
    checkGoogleSheetsStatus,
    checkGoogleDocsStatus,
    checkGmailStatus,
    checkGoogleCalendarStatus,
    checkGoogleDriveStatus,
  ]);

  // URL parsing和导入功能已移至 TableManageDialog
  // const handleParse = async () => {
  //   if (!url.trim()) {
  //     setError('Please enter a URL');
  //     return;
  //   }

  //   // Check if Notion/GitHub/Google Sheets/Linear/Airtable URL and not authenticated
  //   if (isNotionUrl(url) && !notionStatus?.connected) {
  //     setError('Please connect Notion before importing this page');
  //     return;
  //   }
  //   if (isGithubUrl(url) && !githubStatus?.connected) {
  //     setError('Please connect GitHub before importing this page');
  //     return;
  //   }
  //   if (isGoogleSheetsUrl(url) && !googleSheetsStatus?.connected) {
  //     setError(
  //       'Please connect Google Sheets before importing this spreadsheet'
  //     );
  //     return;
  //   }
  //   if (isLinearUrl(url) && !linearStatus?.connected) {
  //     setError('Please connect Linear before importing this page');
  //     return;
  //   }
  //   if (isAirtableUrl(url) && !airtableStatus?.connected) {
  //     setError('Please connect Airtable before importing this base');
  //     return;
  //   }

  //   setIsLoading(true);
  //   setError(null);
  //   setParseResult(null);
  //   setImportSuccess(false);

  //   try {
  //     const result = await parseUrl(url, crawlOptions);
  //     setParseResult(result);

  //     // Auto-select first project if available
  //     if (projects.length > 0 && !selectedProjectId) {
  //       setSelectedProjectId(Number(projects[0].id));
  //     }
  //   } catch (err) {
  //     setError(err instanceof Error ? err.message : 'Failed to parse URL');

  //     // Mark status as error when auth fails
  //     if (err instanceof Error && err.message.toLowerCase().includes('auth')) {
  //       if (isNotionUrl(url)) {
  //         updatePlatformState('notion', {
  //           status: 'error',
  //           label: 'Authorization error',
  //         });
  //       }
  //       if (isGithubUrl(url)) {
  //         updatePlatformState('github', {
  //           status: 'error',
  //           label: 'Authorization error',
  //         });
  //       }
  //       if (isGoogleSheetsUrl(url)) {
  //         updatePlatformState('google-sheets', {
  //           status: 'error',
  //           label: 'Authorization error',
  //         });
  //       }
  //       if (isLinearUrl(url)) {
  //         updatePlatformState('linear', {
  //           status: 'error',
  //           label: 'Authorization error',
  //         });
  //       }
  //       if (isAirtableUrl(url)) {
  //         updatePlatformState('airtable', {
  //           status: 'error',
  //           label: 'Authorization error',
  //         });
  //       }
  //     }
  //   } finally {
  //     setIsLoading(false);
  //   }
  // };

  // const handleImport = async () => {
  //   if (!parseResult || !selectedProjectId) {
  //     setError('Please select a target project');
  //     return;
  //   }

  //   // If no table selected and no new table name, use parsed title or default
  //   const tableName = targetTableId
  //     ? undefined
  //     : newTableName || parseResult.title || 'Imported Data';

  //   setIsImporting(true);
  //   setError(null);

  //   try {
  //     await importData({
  //       url: parseResult.url,
  //       project_id: selectedProjectId,
  //       table_id: targetTableId || undefined,
  //       table_name: tableName,
  //       table_description: `Imported from ${parseResult.source_type}`,
  //     });

  //     setImportSuccess(true);

  //     // Reset after 2 seconds
  //     setTimeout(() => {
  //       setUrl('');
  //       setParseResult(null);
  //       setTargetTableId(null);
  //       setNewTableName('');
  //       setImportSuccess(false);
  //     }, 2000);
  //   } catch (err) {
  //     setError(err instanceof Error ? err.message : 'Failed to import data');
  //   } finally {
  //     setIsImporting(false);
  //   }
  // };

  const disconnectPlatformName = disconnectConfirmation.platformId
    ? getPlatformName(disconnectConfirmation.platformId)
    : '';
  const disconnectPlatformLabel = disconnectPlatformName || 'this integration';

  return (
    <>
      {/* Dark scrollbar styles for preview area */}
      <style>{`
        /* For Chrome, Safari, Edge */
        .connect-preview-scrollbar::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        .connect-preview-scrollbar::-webkit-scrollbar-track {
          background: #0a0a0a;
          border-radius: 4px;
        }
        .connect-preview-scrollbar::-webkit-scrollbar-thumb {
          background: #404040;
          border-radius: 4px;
        }
        .connect-preview-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #555;
        }
        /* For Firefox */
        .connect-preview-scrollbar {
          scrollbar-color: #404040 #0a0a0a;
          scrollbar-width: thin;
        }
      `}</style>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
        }}
      >
        {/* Header */}
        <div
          style={{
            height: 44,
            display: 'flex',
            alignItems: 'center',
            padding: '0 20px',
            borderBottom: '1px solid #262626',
            gap: 12,
          }}
        >
          <button
            onClick={onBack}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 32,
              background: 'transparent',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              color: '#6D7177',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = '#2C2C2C';
              e.currentTarget.style.color = '#CDCDCD';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = '#6D7177';
            }}
          >
            <svg width='16' height='16' viewBox='0 0 16 16' fill='none'>
              <path
                d='M10 4L6 8L10 12'
                stroke='currentColor'
                strokeWidth='1.5'
                strokeLinecap='round'
                strokeLinejoin='round'
              />
            </svg>
          </button>
          <span style={{ fontSize: 16, color: '#CDCDCD', fontWeight: 500 }}>
            Integrations
          </span>
        </div>

        {/* Content */}
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: 20,
          }}
        >
          <div
            style={{
              maxWidth: 760,
              margin: '0 auto',
            }}
          >
            {/* SaaS Platforms */}
            <div
              style={{
                marginBottom: 16,
              }}
            >
              <div
                style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
              >
                {platformConfigs.map(platform => {
                  const state = platformStates[platform.id];
                  const isConnected = state?.status === 'connected';
                  const lampColor =
                    statusColors[state?.status ?? 'disconnected'];
                  const isToggleDisabled =
                    !platform.isEnabled || state?.isLoading || isInitialLoading;

                  return (
                    <div
                      key={platform.id}
                      onClick={() => handlePlatformRowClick(platform.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        background: '#1a1a1a',
                        border: '1px solid #2a2a2a',
                        borderRadius: 8,
                        padding: '12px 16px',
                        gap: 16,
                        cursor:
                          state?.status === 'error' ? 'pointer' : 'default',
                        opacity: platform.isEnabled ? 1 : 0.6,
                      }}
                    >
                      <div
                        style={{
                          color: '#CDCDCD',
                          display: 'flex',
                          alignItems: 'center',
                        }}
                      >
                        {platform.icon}
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 16,
                            fontWeight: 500,
                            color: '#CDCDCD',
                          }}
                        >
                          {platform.name}
                        </div>
                        {platform.description && (
                          <div
                            style={{
                              fontSize: 12,
                              color: '#8B8B8B',
                            }}
                          >
                            {platform.description}
                          </div>
                        )}
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          minWidth: 140,
                          justifyContent: 'flex-end',
                        }}
                      >
                        <span
                          style={{
                            width: 12,
                            height: 12,
                            borderRadius: '50%',
                            background: lampColor,
                            boxShadow:
                              state?.status === 'connected'
                                ? '0 0 8px rgba(34, 197, 94, 0.6)'
                                : 'none',
                          }}
                        />
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 500,
                            color: lampColor,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {isInitialLoading ? 'Checking...' : state?.label}
                        </span>
                      </div>

                      <button
                        type='button'
                        aria-pressed={isConnected}
                        aria-label={`Toggle ${platform.name}`}
                        onClick={e => {
                          e.stopPropagation();
                          if (isToggleDisabled) {
                            return;
                          }
                          handlePlatformToggle(platform.id, !isConnected);
                        }}
                        disabled={isToggleDisabled}
                        style={{
                          width: 48,
                          height: 26,
                          borderRadius: 999,
                          border: `1px solid ${isConnected ? '#15803d' : '#3a3a3a'}`,
                          background: isConnected ? '#22c55e' : '#2a2a2a',
                          position: 'relative',
                          padding: 0,
                          cursor: isToggleDisabled ? 'not-allowed' : 'pointer',
                          opacity: isToggleDisabled ? 0.4 : 1,
                          transition:
                            'background 0.2s ease, border-color 0.2s ease, opacity 0.2s ease',
                        }}
                      >
                        <span
                          style={{
                            position: 'absolute',
                            top: '50%',
                            transform: 'translateY(-50%)',
                            left: isConnected ? 26 : 4,
                            width: 18,
                            height: 18,
                            borderRadius: '50%',
                            background: '#ffffff',
                            transition: 'left 0.2s ease',
                            boxShadow: '0 2px 4px rgba(0, 0, 0, 0.4)',
                          }}
                        />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Connector URL Input Panel */}
            {/* URL parsing功能已移至 TableManageDialog */}
            {/* <div
              style={{
                background: '#111111',
                border: '1px solid #2a2a2a',
                borderRadius: 8,
                padding: 20,
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#8B8B8B',
                  marginBottom: 12,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                Connector URL
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type='url'
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !isLoading) {
                      handleParse();
                    }
                  }}
                  placeholder='https://www.notion.so/...'
                  disabled={isLoading || isImporting}
                  style={{
                    flex: 1,
                    background: '#0a0a0a',
                    border: '1px solid #2a2a2a',
                    borderRadius: 6,
                    padding: '8px 12px',
                    fontSize: 16,
                    color: '#CDCDCD',
                    outline: 'none',
                    transition: 'border-color 0.15s',
                  }}
                  onFocus={e => (e.currentTarget.style.borderColor = '#404040')}
                  onBlur={e => (e.currentTarget.style.borderColor = '#2a2a2a')}
                />

                <button
                  onClick={handleParse}
                  disabled={isLoading || isImporting || !url.trim()}
                  style={{
                    background:
                      isLoading || isImporting || !url.trim()
                        ? '#1a1a1a'
                        : '#2a2a2a',
                    border: 'none',
                    borderRadius: 6,
                    padding: '8px 16px',
                    fontSize: 12,
                    fontWeight: 500,
                    color:
                      isLoading || isImporting || !url.trim()
                        ? '#505050'
                        : '#CDCDCD',
                    cursor:
                      isLoading || isImporting || !url.trim()
                        ? 'not-allowed'
                        : 'pointer',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => {
                    if (!isLoading && !isImporting && url.trim()) {
                      e.currentTarget.style.background = '#353535';
                    }
                  }}
                  onMouseLeave={e => {
                    if (!isLoading && !isImporting && url.trim()) {
                      e.currentTarget.style.background = '#2a2a2a';
                    }
                  }}
                >
                  {isLoading ? 'Parsing...' : 'Parse'}
                </button>
              </div>

              <div
                style={{
                  fontSize: 11,
                  color: '#5D6065',
                  marginTop: 10,
                }}
              >
                Paste a supported SaaS page URL to import its content
              </div>
            </div> */}

            {/* Crawl Options Panel */}
            {/* <CrawlOptionsPanel
              url={url}
              options={crawlOptions}
              onChange={setCrawlOptions}
            /> */}

            {disconnectConfirmation.visible && (
              <div
                style={{
                  position: 'fixed',
                  inset: 0,
                  background: 'rgba(0, 0, 0, 0.65)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 1100,
                }}
              >
                <div
                  style={{
                    background: '#1a1a1a',
                    border: '1px solid #3a3a3a',
                    borderRadius: 10,
                    padding: 24,
                    width: 360,
                    maxWidth: '90%',
                    boxShadow: '0 10px 40px rgba(0, 0, 0, 0.5)',
                  }}
                >
                  <h3
                    style={{
                      fontSize: 16,
                      fontWeight: 600,
                      color: '#CDCDCD',
                      marginBottom: 8,
                    }}
                  >
                    Disconnect {disconnectPlatformLabel}?
                  </h3>
                  <p
                    style={{
                      fontSize: 16,
                      color: '#8B8B8B',
                      marginBottom: 16,
                      lineHeight: 1.5,
                    }}
                  >
                    You will lose access to private {disconnectPlatformLabel}{' '}
                    content until you reconnect.
                  </p>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button
                      onClick={closeDisconnectModal}
                      style={{
                        flex: 1,
                        padding: '8px 16px',
                        borderRadius: 6,
                        border: '1px solid #3a3a3a',
                        background: '#2a2a2a',
                        color: '#CDCDCD',
                        cursor: 'pointer',
                        fontSize: 16,
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleDisconnectConfirm}
                      style={{
                        flex: 1,
                        padding: '8px 16px',
                        borderRadius: 6,
                        border: '1px solid #b91c1c',
                        background: '#7f1d1d',
                        color: '#f87171',
                        cursor: 'pointer',
                        fontSize: 16,
                      }}
                    >
                      Disconnect
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* URL parsing, preview, import, and error handling功能已移至 TableManageDialog */}
          </div>
        </div>
      </div>
    </>
  );
}
