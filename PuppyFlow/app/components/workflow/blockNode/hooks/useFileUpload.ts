'use client';
import { useRef, useState, useEffect } from 'react';
import { useWorkspaces } from '../../../states/UserWorkspacesContext';
import { useWorkspaceManagement } from '../../../hooks/useWorkspaceManagement';
import { useAppSettings } from '../../../states/AppSettingsContext';
import { SYSTEM_URLS } from '@/config/urls';

export interface FileUploadProps {
  nodeId: string;
  initialFiles?: UploadedFile[];
  onFilesChange?: (files: UploadedFile[]) => void;
}

export type UploadedFile = {
  fileName: string | undefined;
  fileType: string;
  task_id: string;
  download_url?: string;
  content_type_header?: string;
  expires_at?: string;
  size?: number;
  etag?: string;
};

export function useFileUpload({
  nodeId,
  initialFiles = [],
  onFilesChange,
}: FileUploadProps) {
  const { userId } = useWorkspaces();
  const { fetchUserId } = useWorkspaceManagement();
  const { addWarn, getAuthHeaders } = useAppSettings();

  const [uploadedFiles, setUploadedFiles] =
    useState<UploadedFile[]>(initialFiles);
  const [isOnUploading, setIsOnUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [manifestEtag, setManifestEtag] = useState<string | null>(null);
  const [resourceKey, setResourceKey] = useState<string | null>(null);

  // 每当文件列表更新时通知父组件
  useEffect(() => {
    if (onFilesChange) {
      onFilesChange(uploadedFiles);
    }
  }, [uploadedFiles, onFilesChange]);

  // 获取用户ID
  const getUserId = async (): Promise<string> => {
    if (userId && userId.trim() !== '') {
      return userId;
    }
    const res = (await fetchUserId()) as string;
    return res;
  };

  // 获取 Authorization headers，若缺失则在本地开发下提供兜底
  const getAuthHeader = (): HeadersInit => {
    const headers = getAuthHeaders() || {};
    if (!('Authorization' in headers)) {
      // PuppyStorage 的 /upload/chunk/direct 在本地也需要存在 Authorization 头
      return { Authorization: 'Bearer local-dev' };
    }
    return headers;
  };

  // 处理文件输入变化
  const handleInputChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setIsOnUploading(true);
    console.log('Starting file upload from input...');

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        await processFile(file, i === files.length - 1);
      }
    } catch (error) {
      console.error('Error during upload process', error);
      addWarn(`Upload error: ${error}`);
    } finally {
      setIsOnUploading(false);
      if (inputRef.current) {
        inputRef.current.value = ''; // 重置输入框，允许重复上传相同文件
      }
      console.log('File upload complete');
    }
  };

  // 处理拖放文件
  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('bg-gray-800/20', 'border-blue-400');

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      console.log('Files dropped, processing...', files.length);
      handleDrop(Array.from(files));
    }
  };

  // 处理拖放的文件集合
  const handleDrop = async (files: File[]) => {
    if (!files || files.length === 0) return;

    setIsOnUploading(true);
    console.log('Starting file upload from drop...');

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        await processFile(file, i === files.length - 1);
      }
    } catch (error) {
      console.error('Error in file processing:', error);
      addWarn(`File processing error: ${error}`);
    } finally {
      setIsOnUploading(false);
      console.log('File upload complete');
    }
  };

  // 处理单个文件的上传
  const processFile = async (file: File, isLastInBatch: boolean) => {
    try {
      console.log('Processing file:', file.name);

      const fileName = file.name;
      let fileExtension = fileName
        .substring(fileName.lastIndexOf('.') + 1)
        .toLowerCase();

      const supportedFileExtensions = [
        'json',
        'txt',
        'html',
        'css',
        'js',
        'png',
        'jpg',
        'gif',
        'svg',
        'mp3',
        'wav',
        'mp4',
        'webm',
        'pdf',
        'zip',
        'md',
        'markdown',
        'application',
        'csv',
        'xlsx',
        'xls',
        'xlsm',
        'xlsb',
        'ods',
        'doc',
        'docx',
      ];

      if (!supportedFileExtensions.includes(fileExtension)) {
        fileExtension = 'application';
      }
      if (fileExtension === 'txt') {
        fileExtension = 'text';
      }
      if (fileExtension === 'md') {
        fileExtension = 'markdown';
      }

      const userIdVal = await getUserId();
      console.log('User ID:', userIdVal);

      // 1) 直接上传文件到 PuppyStorage（小文件直传）
      const qs = new URLSearchParams({
        block_id: nodeId,
        file_name: fileName,
        content_type: file.type || 'application/octet-stream',
      });
      if (versionId) qs.set('version_id', versionId);
      const directUploadUrl = `/api/storage/upload/chunk/direct?${qs.toString()}`;

      const uploadResp = await fetch(directUploadUrl, {
        method: 'POST',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          ...getAuthHeader(),
        },
        body: file,
      });

      if (!uploadResp.ok) {
        const errorText = `Failed to upload file: ${fileName} (${uploadResp.status})`;
        console.error(errorText, await uploadResp.text());
        addWarn(errorText);
        return;
      }

      const directData: {
        success: boolean;
        key: string;
        version_id: string;
        etag: string;
        size: number;
        uploaded_at: number;
      } = await uploadResp.json();

      // 设置 versionId 与 resourceKey（仅首次或保持一致）
      const newVersionId = directData.version_id;
      if (!versionId) {
        setVersionId(newVersionId);
      }
      const rk = `${userIdVal}/${nodeId}/${newVersionId}`;
      setResourceKey(rk);

      // 2) 增量更新 manifest（带乐观锁）
      const isNewVersion = versionId === null || versionId !== newVersionId;
      if (isNewVersion) {
        // 新版本开始时，重置本地 etag，避免抛 409
        setManifestEtag(null);
      }

      // 使用存储返回的 key 获取已被服务端清理过的文件名，保证 manifest 的 name 能被后端正确下载
      const sanitizedName = directData.key.split('/').pop() || fileName;

      const baseManifestBody = {
        user_id: userIdVal,
        block_id: nodeId,
        version_id: newVersionId,
        expected_etag: isNewVersion ? null : manifestEtag,
        new_chunk: {
          // name 必须与对象存储中的实际对象名一致
          name: sanitizedName,
          // file_name 保留原始文件名用于展示
          file_name: fileName,
          mime_type: file.type || 'application/octet-stream',
          size: directData.size,
          etag: directData.etag,
          // 可选: file_type 让后端解析时优先
          file_type: fileExtension,
        },
        status: isLastInBatch ? 'completed' : 'generating',
      } as const;

      const tryUpdateManifest = async (
        body: typeof baseManifestBody
      ): Promise<Response> => {
        return fetch(`/api/storage/upload/manifest`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeader(),
          },
          body: JSON.stringify(body),
        });
      };

      let manifestResp = await tryUpdateManifest(baseManifestBody);

      // 简单的冲突重试策略：若409且提示 current=None，降级 expected_etag 为 null 再试一次
      if (manifestResp.status === 409) {
        try {
          const text = await manifestResp.text();
          if (text.includes('Current: None')) {
            const resp2 = await tryUpdateManifest({
              ...baseManifestBody,
              expected_etag: null,
            });
            manifestResp = resp2;
          }
        } catch {
          // ignore
        }
      }

      if (!manifestResp.ok) {
        const errorText = `Failed to update manifest: ${manifestResp.status}`;
        console.error(errorText, await manifestResp.text());
        addWarn(errorText);
        return;
      }

      const manifestData: { success: boolean; etag: string } =
        await manifestResp.json();
      setManifestEtag(manifestData.etag);

      // 3) 更新本地状态
      const newFile: UploadedFile = {
        fileName,
        task_id: directData.key, // 使用完整key作为唯一标识
        fileType: fileExtension,
        size: directData.size,
        etag: directData.etag,
      };

      setUploadedFiles(prev => {
        const filtered = prev.filter(item => item.task_id !== newFile.task_id);
        return [...filtered, newFile];
      });

      // 4) 已在最后一次文件更新中将 status 标记为 completed（避免重复添加 chunk）
    } catch (error) {
      console.error(`Error processing file ${file.name}:`, error);
      addWarn(`Error processing file: ${file.name}`);
    }
  };

  // 处理文件删除
  const handleDelete = async (file: UploadedFile, index: number) => {
    try {
      console.log('Deleting file:', file);
      const userIdVal = await getUserId();

      // 如果 task_id 存的是完整key，则优先使用
      const fullKey = file.task_id.includes('/')
        ? file.task_id
        : `${userIdVal}/${nodeId}/${versionId ?? ''}/${file.fileName}`;

      const response = await fetch(
        `/api/storage/files/delete`,
        {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeader(),
          },
          body: JSON.stringify({
            user_id: userIdVal,
            resource_key: fullKey,
          }),
        }
      );
      if (response.ok) {
        console.log('File deleted successfully');
        // 更新本地状态
        setUploadedFiles(files => files.filter((_, i) => i !== index));
      } else {
        const errorText = `Failed to delete file: ${file.fileName}`;
        console.error(errorText);
        addWarn(errorText);
      }
    } catch (error) {
      console.error(`Error deleting file:`, error);
      addWarn(`Error deleting file: ${file.fileName}`);
    }
  };

  return {
    uploadedFiles,
    isOnUploading,
    inputRef,
    handleInputChange,
    handleFileDrop,
    handleDelete,
    resourceKey,
    versionId,
  };
}
