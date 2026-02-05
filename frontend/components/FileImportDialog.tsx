'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { getETLHealth } from '@/lib/etlApi';

interface FileImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (files: File[], mode: 'ocr_parse' | 'raw') => void;
  /** 预先选中的文件（可选） */
  initialFiles?: File[];
}

type ProcessingMode = 'smart' | 'raw';

/**
 * 统一的文件导入对话框
 * 
 * 将拖放文件和模式选择合并到同一个界面：
 * 1. 用户拖放/选择文件
 * 2. 选择处理模式
 * 3. 点击导入
 */
export function FileImportDialog({
  isOpen,
  onClose,
  onConfirm,
  initialFiles,
}: FileImportDialogProps) {
  const [files, setFiles] = useState<File[]>(initialFiles || []);
  const [mode, setMode] = useState<ProcessingMode>('smart');
  const [workerOnline, setWorkerOnline] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 同步初始文件
  useEffect(() => {
    if (initialFiles && initialFiles.length > 0) {
      setFiles(initialFiles);
    }
  }, [initialFiles]);

  // 分析文件类型
  const fileStats = React.useMemo(() => {
    let textCount = 0;
    let binaryCount = 0;
    const extensions = new Set<string>();

    const textExts = new Set([
      'txt', 'md', 'json', 'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'html', 'css', 'xml', 'yaml', 'yml', 'csv'
    ]);

    files.forEach(f => {
      const ext = f.name.split('.').pop()?.toLowerCase() || '';
      extensions.add(ext);
      if (textExts.has(ext)) {
        textCount++;
      } else {
        binaryCount++;
      }
    });

    return { textCount, binaryCount, extensions: Array.from(extensions) };
  }, [files]);

  // 检查 Worker 状态
  useEffect(() => {
    if (isOpen) {
      setChecking(true);
      getETLHealth()
        .then(health => {
          const isOnline = health.file_worker.worker_count > 0;
          setWorkerOnline(isOnline);
          
          // Worker 离线时自动切换到 Raw 模式
          if (!isOnline && fileStats.binaryCount > 0) {
            setMode('raw');
          }
        })
        .catch(() => {
          setWorkerOnline(false);
          if (fileStats.binaryCount > 0) {
            setMode('raw');
          }
        })
        .finally(() => setChecking(false));
    }
  }, [isOpen, fileStats.binaryCount]);

  // 重置状态
  useEffect(() => {
    if (!isOpen) {
      if (!initialFiles) {
        setFiles([]);
      }
      setMode('smart');
      setIsDragging(false);
    }
  }, [isOpen, initialFiles]);

  // 拖放处理
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // 只有离开整个 dropzone 时才重置
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length > 0) {
      setFiles(prev => [...prev, ...droppedFiles]);
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (selectedFiles && selectedFiles.length > 0) {
      setFiles(prev => [...prev, ...Array.from(selectedFiles)]);
    }
    // 重置 input 以便再次选择相同文件
    e.target.value = '';
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleConfirm = useCallback(() => {
    if (files.length === 0) return;
    // 映射 mode: smart -> ocr_parse
    const backendMode = mode === 'smart' ? 'ocr_parse' : 'raw';
    onConfirm(files, backendMode);
  }, [files, mode, onConfirm]);

  if (!isOpen) return null;

  return createPortal(
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1100,
        backdropFilter: 'blur(4px)',
      }}
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
      onMouseDown={e => e.stopPropagation()}
    >
      <div
        style={{
          width: 520,
          maxHeight: '85vh',
          background: '#18181b',
          border: '1px solid #27272a',
          borderRadius: 12,
          color: '#e5e5e5',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ 
          padding: '20px 24px 16px', 
          borderBottom: '1px solid #27272a',
          flexShrink: 0,
        }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
            Import Files
          </h2>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: '#71717a' }}>
            Drag & drop files, then choose how to process them
          </p>
        </div>

        {/* Content */}
        <div style={{ 
          padding: '16px 24px', 
          overflowY: 'auto',
          flex: 1,
        }}>
          {/* Dropzone */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
          
          <div
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              padding: files.length > 0 ? '16px' : '32px 16px',
              border: `2px dashed ${isDragging ? '#3b82f6' : '#3f3f46'}`,
              borderRadius: 8,
              background: isDragging ? 'rgba(59, 130, 246, 0.08)' : '#09090b',
              cursor: 'pointer',
              transition: 'all 0.2s',
              marginBottom: 16,
            }}
          >
            {files.length === 0 ? (
              <div style={{ textAlign: 'center' }}>
                <svg
                  width="40"
                  height="40"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#52525b"
                  strokeWidth="1.5"
                  style={{ margin: '0 auto 12px' }}
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" strokeLinecap="round" strokeLinejoin="round" />
                  <polyline points="17 8 12 3 7 8" strokeLinecap="round" strokeLinejoin="round" />
                  <line x1="12" y1="3" x2="12" y2="15" strokeLinecap="round" />
                </svg>
                <div style={{ fontSize: 14, color: '#a1a1aa', marginBottom: 4 }}>
                  Drop files here or click to browse
                </div>
                <div style={{ fontSize: 12, color: '#52525b' }}>
                  Supports PDF, images, documents, and text files
                </div>
              </div>
            ) : (
              <>
                {/* File List */}
                <div style={{ marginBottom: 12 }}>
                  {files.slice(0, 5).map((file, index) => (
                    <div
                      key={`${file.name}-${index}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '6px 0',
                        borderBottom: index < Math.min(files.length, 5) - 1 ? '1px solid #27272a' : 'none',
                      }}
                    >
                      <span style={{ 
                        fontSize: 13, 
                        color: '#d4d4d8',
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {file.name}
                      </span>
                      <span style={{ fontSize: 11, color: '#52525b', marginRight: 8 }}>
                        {(file.size / 1024).toFixed(0)} KB
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFile(index);
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#71717a',
                          cursor: 'pointer',
                          padding: 4,
                          display: 'flex',
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
                        </svg>
                      </button>
                    </div>
                  ))}
                  {files.length > 5 && (
                    <div style={{ fontSize: 12, color: '#71717a', paddingTop: 8 }}>
                      + {files.length - 5} more files
                    </div>
                  )}
                </div>
                
                {/* Add more files hint */}
                <div style={{ 
                  textAlign: 'center', 
                  fontSize: 12, 
                  color: '#52525b',
                  paddingTop: 8,
                  borderTop: '1px dashed #27272a',
                }}>
                  Click or drop to add more files
                </div>
              </>
            )}
          </div>

          {/* File Stats */}
          {files.length > 0 && (
            <div style={{ 
              background: '#27272a', 
              padding: '10px 14px', 
              borderRadius: 6, 
              marginBottom: 20,
              fontSize: 13,
              color: '#a1a1aa',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <div>
                <span style={{ color: '#e5e5e5', fontWeight: 500 }}>{files.length}</span> files
                <span style={{ margin: '0 8px', opacity: 0.3 }}>•</span>
                <span style={{ color: '#e5e5e5' }}>{fileStats.textCount}</span> text
                <span style={{ margin: '0 8px', opacity: 0.3 }}>•</span>
                <span style={{ color: fileStats.binaryCount > 0 ? '#fbbf24' : '#e5e5e5' }}>
                  {fileStats.binaryCount}
                </span> docs/images
              </div>
              <div style={{ fontSize: 12, color: '#52525b' }}>
                {fileStats.extensions.slice(0, 4).map(ext => `.${ext}`).join(' ')}
              </div>
            </div>
          )}

          {/* Processing Mode Selection */}
          {files.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <label style={{ 
                display: 'block', 
                fontSize: 13, 
                fontWeight: 500, 
                marginBottom: 10, 
                color: '#d4d4d8' 
              }}>
                Processing Mode
              </label>

              <div style={{ display: 'flex', gap: 10 }}>
                {/* Smart Parse */}
                <div 
                  onClick={(e) => {
                    e.stopPropagation();
                    if (workerOnline !== false) setMode('smart');
                  }}
                  style={{
                    flex: 1,
                    padding: 14,
                    borderRadius: 8,
                    border: `1px solid ${mode === 'smart' ? '#3b82f6' : '#3f3f46'}`,
                    background: mode === 'smart' ? 'rgba(59, 130, 246, 0.1)' : '#18181b',
                    cursor: workerOnline === false ? 'not-allowed' : 'pointer',
                    opacity: workerOnline === false ? 0.5 : 1,
                    transition: 'all 0.15s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
                    <div style={{
                      width: 18, height: 18, borderRadius: '50%',
                      border: `2px solid ${mode === 'smart' ? '#3b82f6' : '#52525b'}`,
                      background: mode === 'smart' ? '#3b82f6' : 'transparent',
                      marginRight: 10,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                      {mode === 'smart' && (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                          <polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>Smart Parse</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#71717a', lineHeight: 1.4, paddingLeft: 28 }}>
                    OCR for PDFs & images
                  </div>
                </div>

                {/* Raw Storage */}
                <div 
                  onClick={(e) => {
                    e.stopPropagation();
                    setMode('raw');
                  }}
                  style={{
                    flex: 1,
                    padding: 14,
                    borderRadius: 8,
                    border: `1px solid ${mode === 'raw' ? '#3b82f6' : '#3f3f46'}`,
                    background: mode === 'raw' ? 'rgba(59, 130, 246, 0.1)' : '#18181b',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
                    <div style={{
                      width: 18, height: 18, borderRadius: '50%',
                      border: `2px solid ${mode === 'raw' ? '#3b82f6' : '#52525b'}`,
                      background: mode === 'raw' ? '#3b82f6' : 'transparent',
                      marginRight: 10,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                      {mode === 'raw' && (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                          <polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>Raw Storage</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#71717a', lineHeight: 1.4, paddingLeft: 28 }}>
                    Store files as-is, faster
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ 
          padding: '16px 24px',
          borderTop: '1px solid #27272a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          {/* Worker Status */}
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            fontSize: 12, 
            color: workerOnline ? '#22c55e' : (workerOnline === false ? '#71717a' : '#71717a'),
          }}>
            <div style={{ 
              width: 6, height: 6, borderRadius: '50%', 
              background: workerOnline ? '#22c55e' : (workerOnline === false ? '#ef4444' : '#52525b'),
              marginRight: 6,
            }} />
            {checking ? 'Checking...' : (
              workerOnline ? 'OCR Ready' : (workerOnline === false ? 'OCR Unavailable' : '')
            )}
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={onClose}
              style={{
                padding: '8px 16px',
                borderRadius: 6,
                border: '1px solid #3f3f46',
                background: 'transparent',
                color: '#a1a1aa',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={files.length === 0 || checking}
              style={{
                padding: '8px 20px',
                borderRadius: 6,
                border: 'none',
                background: files.length > 0 ? '#3b82f6' : '#27272a',
                color: files.length > 0 ? '#fff' : '#52525b',
                cursor: files.length > 0 && !checking ? 'pointer' : 'not-allowed',
                fontSize: 13,
                fontWeight: 600,
                transition: 'all 0.15s',
              }}
            >
              {files.length > 0 ? `Import ${files.length} File${files.length > 1 ? 's' : ''}` : 'Select Files'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default FileImportDialog;

