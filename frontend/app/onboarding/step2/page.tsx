'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  useOnboardingStore,
  TrackedFile,
  ETLTaskState,
} from '../../../components/onboarding/store';
import { RouterWizardLayout } from '../../../components/onboarding/components/RouterWizardLayout';
import { createProject, createTable } from '../../../lib/projectsApi';
import { uploadAndSubmit, batchGetETLTaskStatus } from '../../../lib/etlApi';
import { getApiAccessToken } from '../../../lib/apiClient';

// --- Icons & Assets ---
const IconImg = ({
  src,
  alt,
  size = 16,
}: {
  src: string;
  alt: string;
  size?: number;
}) => (
  <img
    src={src}
    alt={alt}
    style={{ width: size, height: size, objectFit: 'contain', opacity: 0.8 }}
  />
);

const SOURCE_INFO: Record<string, { label: string; icon: React.ReactNode }> = {
  notion: {
    label: 'Notion',
    icon: <IconImg src='/icons/notion.png' alt='Notion' />,
  },
  gdocs: {
    label: 'Google Docs',
    icon: <IconImg src='/icons/Google_Docs_logo.png' alt='Google Docs' />,
  },
};

// Upload Icon
const UploadIcon = () => (
  <svg
    width='16'
    height='16'
    viewBox='0 0 24 24'
    fill='none'
    stroke='currentColor'
    strokeWidth='2'
    strokeLinecap='round'
    strokeLinejoin='round'
  >
    <path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' />
    <polyline points='17 8 12 3 7 8' />
    <line x1='12' y1='3' x2='12' y2='15' />
  </svg>
);

// Spinner Icon
const Spinner = ({ size = 14 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    stroke='currentColor'
    strokeWidth='2'
  >
    <circle cx='12' cy='12' r='10' strokeOpacity='0.25' />
    <path
      d='M12 2a10 10 0 0 1 10 10'
      style={{
        animation: 'spin 1s linear infinite',
        transformOrigin: 'center',
      }}
    />
    <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
  </svg>
);

// Check Icon
const CheckIcon = ({ size = 14 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    stroke='#4ADE80'
    strokeWidth='2.5'
  >
    <polyline points='20 6 9 17 4 12' />
  </svg>
);

// File status helpers
function getStatusLabel(state: ETLTaskState): string {
  switch (state) {
    case 'uploading':
      return 'Uploading...';
    case 'pending':
      return 'Queued';
    case 'parsing':
      return 'Parsing...';
    case 'completed':
      return 'Ready';
    case 'failed':
      return 'Failed';
    default:
      return '';
  }
}

function getStatusColor(state: ETLTaskState): string {
  switch (state) {
    case 'completed':
      return '#4ADE80';
    case 'failed':
      return '#EF4444';
    default:
      return '#888';
  }
}

export default function Step2Page() {
  const router = useRouter();
  const {
    projectId,
    setProjectId,
    tableId,
    setTableId,
    projectName,
    trackedFiles,
    setTrackedFiles,
    updateTrackedFile,
    connectedApps,
    setConnectedApps,
    enteredUrls,
    setEnteredUrls,
  } = useOnboardingStore();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [urlInput, setUrlInput] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  // Poll ETL task status
  const pollTaskStatus = useCallback(async () => {
    const token = await getApiAccessToken();
    if (!token) return;

    const pendingFiles = trackedFiles.filter(
      f => f.taskId && (f.state === 'pending' || f.state === 'parsing')
    );

    if (pendingFiles.length === 0) {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      setIsProcessing(false);
      return;
    }

    const taskIds = pendingFiles.map(f => f.taskId!);
    try {
      const result = await batchGetETLTaskStatus(taskIds, token);

      result.tasks.forEach(task => {
        const fileIndex = trackedFiles.findIndex(
          f => f.taskId === task.task_id
        );
        if (fileIndex === -1) return;

        let newState: ETLTaskState;
        if (task.status === 'completed') {
          newState = 'completed';
        } else if (task.status === 'failed' || task.status === 'cancelled') {
          newState = 'failed';
        } else if (
          task.status === 'mineru_parsing' ||
          task.status === 'llm_processing'
        ) {
          newState = 'parsing';
        } else {
          newState = 'pending';
        }

        updateTrackedFile(fileIndex, {
          state: newState,
          progress: task.progress,
          error: task.error,
          result: task.result,
        });
      });
    } catch (error) {
      console.error('Failed to poll task status:', error);
    }
  }, [trackedFiles, updateTrackedFile]);

  // Start polling when there are pending tasks
  useEffect(() => {
    const hasPendingTasks = trackedFiles.some(
      f =>
        f.state === 'pending' ||
        f.state === 'parsing' ||
        f.state === 'uploading'
    );

    if (hasPendingTasks && !pollingRef.current) {
      pollingRef.current = setInterval(pollTaskStatus, 2000);
    } else if (!hasPendingTasks && pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, [trackedFiles, pollTaskStatus]);

  // Handle file upload
  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    setIsProcessing(true);
    const newFiles = Array.from(files);

    const startIndex = trackedFiles.length;

    const newTrackedFiles: TrackedFile[] = newFiles.map(file => ({
      file,
      state: 'uploading' as ETLTaskState,
    }));
    const updatedTrackedFiles = [...trackedFiles, ...newTrackedFiles];
    setTrackedFiles(updatedTrackedFiles);

    try {
      const token = await getApiAccessToken();
      if (!token) {
        throw new Error('Not authenticated. Please log in first.');
      }

      // Create project if needed
      let currentProjectId = projectId;
      if (!currentProjectId) {
        const name = projectName || `onboarding_${Date.now()}`;
        const project = await createProject(name);
        currentProjectId = String(project.id);
        setProjectId(currentProjectId);
      }

      // Create table if needed
      let currentTableId = tableId;
      if (!currentTableId) {
        const table = await createTable(currentProjectId, 'context');
        currentTableId = String(table.id);
        setTableId(currentTableId);
      }

      // Upload and submit ETL
      const response = await uploadAndSubmit(
        {
          projectId: Number(currentProjectId),
          files: newFiles,
          nodeId: currentTableId,  // 使用 nodeId (UUID 字符串)
        },
        token
      );

      // Update tracked files with task IDs
      response.items.forEach((item, i) => {
        const globalIndex = startIndex + i;
        if (item.error) {
          updateTrackedFile(globalIndex, {
            state: 'failed',
            error: item.error,
          });
        } else {
          updateTrackedFile(globalIndex, {
            state: 'pending',
            taskId: String(item.task_id),
          });
        }
      });
    } catch (error) {
      console.error('Upload failed:', error);
      newFiles.forEach((_, i) => {
        updateTrackedFile(startIndex + i, {
          state: 'failed',
          error: error instanceof Error ? error.message : 'Upload failed',
        });
      });
      setIsProcessing(false);
    }
  };

  const removeFile = (index: number) => {
    setTrackedFiles(trackedFiles.filter((_, i) => i !== index));
  };

  const toggleApp = (appId: string) => {
    if (connectedApps.includes(appId)) {
      setConnectedApps(connectedApps.filter(id => id !== appId));
    } else {
      setConnectedApps([...connectedApps, appId]);
    }
  };

  const addUrl = () => {
    if (urlInput.trim()) {
      setEnteredUrls([...enteredUrls, urlInput.trim()]);
      setUrlInput('');
    }
  };

  const removeUrl = (index: number) => {
    setEnteredUrls(enteredUrls.filter((_, i) => i !== index));
  };

  // Check if we have any completed data or demo data
  const completedFiles = trackedFiles.filter(f => f.state === 'completed');
  const hasCompletedData =
    completedFiles.length > 0 ||
    enteredUrls.length > 0 ||
    connectedApps.length > 0;
  const allFilesProcessed =
    trackedFiles.length > 0 &&
    trackedFiles.every(f => f.state === 'completed' || f.state === 'failed');

  return (
    <RouterWizardLayout
      title="Let's teach your agent."
      subtitle='Upload your files and watch them transform into knowledge.'
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 32,
          maxWidth: 640,
          margin: '0 auto',
          width: '100%',
          paddingBottom: 100,
        }}
      >
        {/* Upload Box Area */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          style={{
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          {/* Drop Zone */}
          <div
            onDrop={e => {
              e.preventDefault();
              setIsDragging(false);
              handleFiles(e.dataTransfer.files);
            }}
            onDragOver={e => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${isDragging ? '#4599DF' : '#555'}`,
              borderRadius: 12,
              padding: trackedFiles.length > 0 ? '20px' : '40px',
              background: isDragging
                ? 'rgba(69, 153, 223, 0.05)'
                : 'rgba(255,255,255,0.02)',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            <input
              ref={fileInputRef}
              type='file'
              multiple
              accept='.pdf,.md,.txt,.csv'
              onChange={e => handleFiles(e.target.files)}
              style={{ display: 'none' }}
            />

            {trackedFiles.length === 0 ? (
              <div
                style={{
                  color: '#E0E0E0',
                  fontSize: 14,
                  fontWeight: 500,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 12,
                }}
              >
                <UploadIcon />
                <div>Click to upload or drag files</div>
                <div style={{ fontSize: 12, color: '#666', fontWeight: 400 }}>
                  PDF, Markdown, CSV, Text
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {trackedFiles.map((tracked, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      padding: '8px 12px',
                      background: '#111',
                      borderRadius: 8,
                      fontSize: 13,
                      border: `1px solid ${tracked.state === 'completed' ? 'rgba(74, 222, 128, 0.3)' : tracked.state === 'failed' ? 'rgba(239, 68, 68, 0.3)' : '#222'}`,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        flex: 1,
                        minWidth: 0,
                      }}
                    >
                      {tracked.state === 'completed' ? (
                        <CheckIcon />
                      ) : tracked.state === 'failed' ? (
                        <span style={{ color: '#EF4444', fontSize: 14 }}>
                          ✕
                        </span>
                      ) : (
                        <Spinner />
                      )}

                      <span
                        style={{
                          color: '#E0E0E0',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          flex: 1,
                        }}
                      >
                        {tracked.file.name}
                      </span>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        flexShrink: 0,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 11,
                          color: getStatusColor(tracked.state),
                        }}
                      >
                        {getStatusLabel(tracked.state)}
                      </span>
                      {(tracked.state === 'completed' ||
                        tracked.state === 'failed') && (
                        <div
                          onClick={e => {
                            e.stopPropagation();
                            removeFile(i);
                          }}
                          style={{
                            cursor: 'pointer',
                            color: '#555',
                            padding: '0 2px',
                          }}
                        >
                          ×
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                <div
                  style={{
                    textAlign: 'center',
                    padding: '8px',
                    color: '#555',
                    fontSize: 12,
                  }}
                >
                  + Drop more files
                </div>
              </div>
            )}
          </div>

          {/* Secondary: Connect Apps/URL */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              alignItems: 'center',
            }}
          >
            <span style={{ fontSize: 13, color: '#666' }}>Or connect:</span>

            {['notion', 'gdocs'].map(sourceId => {
              const info = SOURCE_INFO[sourceId];
              const isConnected = connectedApps.includes(sourceId);
              return (
                <div
                  key={sourceId}
                  onClick={() => toggleApp(sourceId)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 10px',
                    background: isConnected
                      ? 'rgba(74, 222, 128, 0.1)'
                      : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${isConnected ? 'rgba(74, 222, 128, 0.4)' : '#333'}`,
                    borderRadius: 16,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  {info.icon}
                  <span
                    style={{
                      fontSize: 12,
                      color: isConnected ? '#4ADE80' : '#ccc',
                    }}
                  >
                    {info.label}
                  </span>
                  {isConnected && <CheckIcon size={10} />}
                </div>
              );
            })}

            <div
              onClick={() => setShowUrlInput(!showUrlInput)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '6px 10px',
                background:
                  showUrlInput || enteredUrls.length > 0
                    ? 'rgba(69, 153, 223, 0.1)'
                    : 'rgba(255,255,255,0.03)',
                border: `1px solid ${showUrlInput || enteredUrls.length > 0 ? 'rgba(69, 153, 223, 0.4)' : '#333'}`,
                borderRadius: 16,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  color:
                    showUrlInput || enteredUrls.length > 0 ? '#4599DF' : '#ccc',
                }}
              >
                {enteredUrls.length > 0
                  ? `URL (${enteredUrls.length})`
                  : '+ URL'}
              </span>
            </div>
          </div>

          {/* Expandable URL Input */}
          <AnimatePresence>
            {showUrlInput && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                style={{ overflow: 'hidden' }}
              >
                <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
                  <input
                    type='url'
                    placeholder='Paste URL here...'
                    value={urlInput}
                    onChange={e => setUrlInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addUrl()}
                    autoFocus
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      background: 'rgba(255,255,255,0.02)',
                      border: '1px solid #333',
                      borderRadius: 8,
                      color: '#ccc',
                      fontSize: 13,
                      outline: 'none',
                    }}
                  />
                  <button
                    onClick={addUrl}
                    disabled={!urlInput.trim()}
                    style={{
                      padding: '0 12px',
                      background: urlInput.trim() ? '#222' : 'transparent',
                      border: '1px solid #333',
                      borderRadius: 8,
                      color: urlInput.trim() ? '#fff' : '#444',
                      cursor: urlInput.trim() ? 'pointer' : 'default',
                      fontSize: 12,
                    }}
                  >
                    Add
                  </button>
                </div>

                {/* Added URLs List */}
                {enteredUrls.length > 0 && (
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 6,
                      marginTop: 8,
                    }}
                  >
                    {enteredUrls.map((url, i) => (
                      <div
                        key={i}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '4px 10px',
                          background: 'rgba(69, 153, 223, 0.1)',
                          borderRadius: 6,
                          fontSize: 11,
                          color: '#4599DF',
                        }}
                      >
                        <span
                          style={{
                            maxWidth: 180,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {new URL(url).hostname}
                        </span>
                        <div
                          onClick={() => removeUrl(i)}
                          style={{
                            cursor: 'pointer',
                            color: 'rgba(255,255,255,0.4)',
                            paddingLeft: 4,
                          }}
                        >
                          ×
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Continue Button - Bottom */}
        <div
          style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}
        >
          <div
            onClick={() => hasCompletedData && router.push('/onboarding/step3')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '10px 28px',
              background: hasCompletedData
                ? '#EDEDED'
                : 'rgba(255,255,255,0.05)',
              color: hasCompletedData ? '#000' : '#444',
              fontSize: 14,
              fontWeight: 600,
              cursor: hasCompletedData ? 'pointer' : 'not-allowed',
              borderRadius: 24,
              transition: 'all 0.2s',
              border: hasCompletedData ? 'none' : '1px solid #333',
            }}
          >
            Continue →
          </div>
        </div>

        {/* Processing Indicator */}
        {isProcessing && !allFilesProcessed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              color: '#666',
              fontSize: 13,
            }}
          >
            <Spinner size={14} />
            Processing files...
          </motion.div>
        )}
      </div>
    </RouterWizardLayout>
  );
}
