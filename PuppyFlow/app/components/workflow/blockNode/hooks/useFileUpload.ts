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
  const { addWarn } = useAppSettings();

  const [uploadedFiles, setUploadedFiles] =
    useState<UploadedFile[]>(initialFiles);
  const [isOnUploading, setIsOnUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [manifestEtag, setManifestEtag] = useState<string | null>(null);
  const [resourceKey, setResourceKey] = useState<string | null>(null);

  const versionIdRef = useRef<string | null>(null);
  const manifestEtagRef = useRef<string | null>(null);

  const updateVersionId = (value: string | null) => {
    versionIdRef.current = value;
    setVersionId(value);
  };

  const updateManifestEtag = (value: string | null) => {
    manifestEtagRef.current = value;
    setManifestEtag(value);
  };

  useEffect(() => {
    versionIdRef.current = versionId;
  }, [versionId]);

  useEffect(() => {
    manifestEtagRef.current = manifestEtag;
  }, [manifestEtag]);

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

  // 🔒 安全修复：移除客户端认证处理，所有请求通过服务端代理认证
  // getAuthHeader 已弃用，认证完全由服务端代理处理

  // 处理文件输入变化
  const handleInputChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setIsOnUploading(true);
    console.log('Starting file upload from input...');

    try {
      // 串行处理文件，避免并发更新manifest导致ETag冲突
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        console.log(`Processing file ${i + 1}/${files.length}: ${file.name}`);
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
      // 串行处理文件，避免并发更新manifest导致ETag冲突
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        console.log(`Processing file ${i + 1}/${files.length}: ${file.name}`);
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
      const MULTIPART_THRESHOLD_BYTES = 5 * 1024 * 1024; // 5MB 阈值

      if (file.size <= MULTIPART_THRESHOLD_BYTES) {
        // 1) 小文件直接上传到 PuppyStorage（直传）
        const qs = new URLSearchParams({
          block_id: nodeId,
          file_name: fileName,
          content_type: file.type || 'application/octet-stream',
        });
        if (versionIdRef.current) qs.set('version_id', versionIdRef.current);
        // 🔒 安全修复：Route via same-origin API proxy
        const directUploadUrl = `/api/storage/upload/chunk/direct?${qs.toString()}`;

        const uploadResp = await fetch(directUploadUrl, {
          method: 'POST',
          credentials: 'include', // 🔒 安全修复：通过HttpOnly cookie自动认证
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
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
        if (!versionIdRef.current) {
          updateVersionId(newVersionId);
        }
        const rk = `${userIdVal}/${nodeId}/${newVersionId}`;
        setResourceKey(rk);

        // 2) 增量更新 manifest（带乐观锁）
        const isNewVersion =
          versionIdRef.current === null ||
          versionIdRef.current !== newVersionId;
        if (isNewVersion) {
          // 新版本开始时，重置本地 etag，避免抛 409
          updateManifestEtag(null);
        }

        // 使用存储返回的 key 获取已被服务端清理过的文件名，保证 manifest 的 name 能被后端正确下载
        const sanitizedName = directData.key.split('/').pop() || fileName;

        const baseManifestBody = {
          user_id: userIdVal,
          block_id: nodeId,
          version_id: newVersionId,
          expected_etag: isNewVersion ? null : manifestEtagRef.current,
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
            // 标记该直传 chunk 已可消费
            state: 'done' as const,
          },
          status: isLastInBatch ? 'completed' : 'generating',
        } as const;

        const tryUpdateManifest = async (
          body: typeof baseManifestBody
        ): Promise<Response> => {
          return fetch(`/api/storage/upload/manifest`, {
            method: 'PUT',
            credentials: 'include', // 🔒 安全修复：通过HttpOnly cookie自动认证
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
          });
        };

        let manifestResp = await tryUpdateManifest(baseManifestBody);

        // 改进的冲突重试策略：处理ETag不匹配的情况
        if (manifestResp.status === 409) {
          try {
            const text = await manifestResp.text();
            console.log(
              'Manifest update conflict, retrying with null etag:',
              text
            );

            // 重置本地etag状态并重试
            updateManifestEtag(null);
            const retryBody = {
              ...baseManifestBody,
              expected_etag: null,
            };
            const resp2 = await tryUpdateManifest(retryBody);
            manifestResp = resp2;

            // 如果还是失败，再试一次获取最新的etag
            if (manifestResp.status === 409) {
              console.log('Second retry for manifest update');
              const resp3 = await tryUpdateManifest(retryBody);
              manifestResp = resp3;
            }
          } catch (retryError) {
            console.error('Error during manifest retry:', retryError);
          }
        }

        if (!manifestResp.ok) {
          const errorText = `Failed to update manifest: ${manifestResp.status}`;
          try {
            const errorBody = await manifestResp.text();
            console.error(errorText, errorBody);
          } catch {
            console.error(errorText);
          }
          addWarn(errorText);
          return;
        }

        const manifestData: { success: boolean; etag: string } =
          await manifestResp.json();
        updateManifestEtag(manifestData.etag);

        // 3) 更新本地状态
        const newFile: UploadedFile = {
          fileName,
          task_id: directData.key, // 使用完整key作为唯一标识
          fileType: fileExtension,
          size: directData.size,
          etag: directData.etag,
        };

        setUploadedFiles(prev => {
          const filtered = prev.filter(
            item => item.task_id !== newFile.task_id
          );
          return [...filtered, newFile];
        });

        // 4) 已在最后一次文件更新中将 status 标记为 completed（避免重复添加 chunk）
      } else {
        // 2) 大文件分片上传：init -> get_upload_url -> PUT parts -> complete
        console.log('Uploading large file:', fileName);
        const initResp = await fetch(`/api/storage/upload/init`, {
          method: 'POST',
          credentials: 'include', // 🔒 安全修复：通过HttpOnly cookie自动认证
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            block_id: nodeId,
            file_name: fileName,
            content_type: file.type || 'application/octet-stream',
            file_size: file.size,
          }),
        });
        if (!initResp.ok) {
          const msg = await initResp.text();
          addWarn(`Init multipart failed: ${initResp.status} ${msg}`);
          return;
        }
        const initData: {
          upload_id: string;
          key: string;
          version_id: string;
          expires_at: number;
          max_parts: number;
          min_part_size: number;
        } = await initResp.json();

        const newVersionId = initData.version_id;
        if (!versionIdRef.current) {
          updateVersionId(newVersionId);
        }
        const rk = `${userIdVal}/${nodeId}/${newVersionId}`;
        setResourceKey(rk);

        const partSize = Math.max(
          initData.min_part_size || 5 * 1024 * 1024,
          5 * 1024 * 1024
        );
        const parts: { ETag: string; PartNumber: number }[] = [];
        let offset = 0;
        let partNumber = 1;
        while (offset < file.size) {
          const end = Math.min(offset + partSize, file.size);
          const blobPart = file.slice(offset, end);

          const urlReq = await fetch(`/api/storage/upload/get_upload_url`, {
            method: 'POST',
            credentials: 'include', // 🔒 安全修复：通过HttpOnly cookie自动认证
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              key: initData.key,
              upload_id: initData.upload_id,
              part_number: partNumber,
              expires_in: 300,
            }),
          });
          if (!urlReq.ok) {
            const msg = await urlReq.text();
            addWarn(
              `Get upload URL failed (part ${partNumber}): ${urlReq.status} ${msg}`
            );
            return;
          }
          const { upload_url } = (await urlReq.json()) as {
            upload_url: string;
          };

          const putResp = await fetch(upload_url, {
            method: 'PUT',
            body: blobPart,
          });
          if (!putResp.ok) {
            let msg = '';
            try {
              msg = await putResp.text();
            } catch {}
            addWarn(
              `Upload part ${partNumber} failed: ${putResp.status} ${msg}`
            );
            return;
          }

          // 读取 ETag（S3 在 Header；本地端点也在 Header 并返回 JSON）
          let etag = putResp.headers.get('ETag');
          if (!etag) {
            try {
              const j = await putResp.json();
              etag = (j as any)?.etag;
            } catch {}
          }
          if (!etag) {
            addWarn(`Missing ETag for part ${partNumber}`);
            return;
          }
          etag = etag.replace(/\"/g, '').replace(/"/g, '');
          parts.push({ ETag: etag, PartNumber: partNumber });

          offset = end;
          partNumber += 1;
        }

        const completeResp = await fetch(`/api/storage/upload/complete`, {
          method: 'POST',
          credentials: 'include', // 🔒 安全修复：通过HttpOnly cookie自动认证
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            key: initData.key,
            upload_id: initData.upload_id,
            parts,
          }),
        });
        if (!completeResp.ok) {
          const msg = await completeResp.text();
          addWarn(`Complete multipart failed: ${completeResp.status} ${msg}`);
          return;
        }
        const completeData: {
          success: boolean;
          key: string;
          size: number;
          etag: string;
        } = await completeResp.json();

        // 分片完成后更新 manifest
        const isNewVersion =
          versionIdRef.current === null ||
          versionIdRef.current !== newVersionId;
        if (isNewVersion) {
          updateManifestEtag(null);
        }
        const sanitizedName = completeData.key.split('/').pop() || fileName;
        const body = {
          user_id: userIdVal,
          block_id: nodeId,
          version_id: newVersionId,
          expected_etag: isNewVersion ? null : manifestEtagRef.current,
          new_chunk: {
            name: sanitizedName,
            file_name: fileName,
            mime_type: file.type || 'application/octet-stream',
            size: completeData.size,
            etag: completeData.etag,
            file_type: fileExtension,
            state: 'done' as const,
          },
          status: isLastInBatch ? 'completed' : 'generating',
        } as const;

        let manifestResp = await fetch(`/api/storage/upload/manifest`, {
          method: 'PUT',
          credentials: 'include', // 🔒 安全修复：通过HttpOnly cookie自动认证
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });

        // 处理大文件上传的manifest更新冲突
        if (manifestResp.status === 409) {
          try {
            const text = await manifestResp.text();
            console.log('Large file manifest update conflict, retrying:', text);

            // 重置本地etag状态并重试
            updateManifestEtag(null);
            const retryBody = {
              ...body,
              expected_etag: null,
            };
            manifestResp = await fetch(`/api/storage/upload/manifest`, {
              method: 'PUT',
              credentials: 'include',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(retryBody),
            });
          } catch (retryError) {
            console.error(
              'Error during large file manifest retry:',
              retryError
            );
          }
        }

        if (!manifestResp.ok) {
          try {
            const msg = await manifestResp.text();
            addWarn(`Failed to update manifest: ${manifestResp.status} ${msg}`);
          } catch {
            addWarn(`Failed to update manifest: ${manifestResp.status}`);
          }
          return;
        }
        const j = (await manifestResp.json()) as {
          success: boolean;
          etag: string;
        };
        updateManifestEtag(j.etag);

        const newFile: UploadedFile = {
          fileName,
          task_id: completeData.key,
          fileType: fileExtension,
          size: completeData.size,
          etag: completeData.etag,
        };
        setUploadedFiles(prev => {
          const filtered = prev.filter(
            item => item.task_id !== newFile.task_id
          );
          return [...filtered, newFile];
        });
      }
    } catch (error) {
      console.error(`Error processing file ${file.name}:`, error);
      addWarn(`Error processing file: ${file.name}`);
    }
  };

  // 处理文件删除
  const handleDelete = async (file: UploadedFile, index: number) => {
    try {
      const userIdVal = await getUserId();
      const fullKey = file.task_id.includes('/')
        ? file.task_id
        : `${userIdVal}/${nodeId}/${versionId ?? ''}/${file.fileName}`;

      // 删除存储中的文件
      const response = await fetch(`/api/storage/files/delete`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userIdVal,
          resource_key: fullKey,
        }),
      });

      if (!response.ok) {
        addWarn(`Failed to delete file: ${file.fileName}`);
        return;
      }

      // 更新manifest.json，移除对应的chunk记录
      if (versionIdRef.current) {
        try {
          const manifestResp = await fetch(
            `/api/storage/upload/manifest/remove`,
            {
              method: 'PUT',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                user_id: userIdVal,
                block_id: nodeId,
                version_id: versionIdRef.current,
                expected_etag: manifestEtagRef.current,
                chunk_to_remove: {
                  name: fullKey.split('/').pop() || file.fileName,
                  file_name: file.fileName,
                },
              }),
            }
          );

          if (manifestResp.ok) {
            const manifestData = await manifestResp.json();
            updateManifestEtag(manifestData.etag);
          }
        } catch (manifestError) {
          // 忽略manifest更新错误，不阻止删除操作
        }
      }

      // 更新本地状态
      setUploadedFiles(files => files.filter((_, i) => i !== index));
    } catch (error) {
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
