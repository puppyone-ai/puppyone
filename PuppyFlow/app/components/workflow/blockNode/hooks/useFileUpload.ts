'use client'
import { useRef, useState, useEffect, useContext } from 'react'
import { useWorkspaces } from "../../../states/UserWorkspaceAndServicesContext"
import { useWorkspaceManagement } from '../../../hooks/useWorkspaceManagement'
import { useAppSettings } from '../../../states/AppSettingsContext'
import { PuppyStorage_IP_address_for_uploadingFile } from '../../../hooks/useJsonConstructUtils'
import { SYSTEM_URLS } from "@/config/urls"

export interface FileUploadProps {
  nodeId: string
  initialFiles?: UploadedFile[]
  onFilesChange?: (files: UploadedFile[]) => void
}

export type UploadedFile = {
  fileName: string | undefined
  fileType: string
  task_id: string
  download_url?: string
  content_type_header?: string
  expires_at?: string
}

export function useFileUpload({
  nodeId,
  initialFiles = [],
  onFilesChange
}: FileUploadProps) {
  const { userId } = useWorkspaces()
  const { fetchUserId } = useWorkspaceManagement()
  const { addWarn } = useAppSettings()
  
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>(initialFiles)
  const [isOnUploading, setIsOnUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // 每当文件列表更新时通知父组件
  useEffect(() => {
    if (onFilesChange) {
      onFilesChange(uploadedFiles);
    }
  }, [uploadedFiles, onFilesChange]);

  // 获取用户ID
  const getUserId = async (): Promise<string> => {
    if (userId && userId.trim() !== "") {
      return userId
    }
    const res = await fetchUserId() as string
    return res
  }

  // 处理文件输入变化
  const handleInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setIsOnUploading(true);
    console.log("Starting file upload from input...");

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        await processFile(file);
      }
    } catch (error) {
      console.error('Error during upload process', error);
      addWarn(`Upload error: ${error}`);
    } finally {
      setIsOnUploading(false);
      if (inputRef.current) {
        inputRef.current.value = '';  // 重置输入框，允许重复上传相同文件
      }
      console.log("File upload complete");
    }
  };

  // 处理拖放文件
  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('bg-gray-800/20', 'border-blue-400');
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      console.log("Files dropped, processing...", files.length);
      handleDrop(Array.from(files));
    }
  };

  // 处理拖放的文件集合
  const handleDrop = async (files: File[]) => {
    if (!files || files.length === 0) return;

    setIsOnUploading(true);
    console.log("Starting file upload from drop...");

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        await processFile(file);
      }
    } catch (error) {
      console.error('Error in file processing:', error);
      addWarn(`File processing error: ${error}`);
    } finally {
      setIsOnUploading(false);
      console.log("File upload complete");
    }
  };

  // 处理单个文件的上传
  const processFile = async (file: File) => {
    try {
      console.log("Processing file:", file.name);
      
      const fileName = file.name;
      let fileExtension = fileName.substring(fileName.lastIndexOf('.') + 1).toLowerCase();
      
      const supportedFileExtensions = ["json", "txt", "html", "css", "js", "png", "jpg", "gif", "svg", "mp3", "wav", "mp4", "webm", "pdf", "zip", "md", "markdown", "application", "csv", "xlsx", "xls", "xlsm", "xlsb", "ods"];

      if (!supportedFileExtensions.includes(fileExtension)) {
        fileExtension = "application";
      }
      if (fileExtension === "txt") {
        fileExtension = "text";
      }
      if (fileExtension === "md") {
        fileExtension = "markdown";
      }

      console.log(`Requesting presigned URL for file type: ${fileExtension}`);
      
      // 获取预签名URL - 使用正确格式的URL
      const uploadEndpoint = `${PuppyStorage_IP_address_for_uploadingFile}/${fileExtension}`;
      console.log("Upload endpoint:", uploadEndpoint);
      
      const userId = await getUserId();
      console.log("User ID:", userId);
      
      const response = await fetch(uploadEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          content_name: fileName
        })
      });

      if (!response.ok) {
        const errorText = `Failed to get upload URL: ${response.status}`;
        console.error(errorText);
        addWarn(errorText);
        return;
      }

      const data = await response.json();
      console.log("Presigned URL response:", data);
      
      const { upload_url, download_url, content_id, content_type_header, expires_at } = data;

      // 上传文件
      console.log("Uploading file to:", upload_url);
      const uploadResponse = await fetch(upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': content_type_header },
        body: file,
      });

      if (uploadResponse.ok) {
        console.log("File uploaded successfully");
        
        const newFile = { 
          fileName, 
          task_id: content_id, 
          fileType: fileExtension, 
          download_url, 
          content_type_header, 
          expires_at 
        };
        
        // 更新本地状态
        setUploadedFiles(prev => {
          const filtered = prev.filter(item => item.task_id !== content_id);
          return [...filtered, newFile];
        });
      } else {
        const errorText = `Failed to upload file: ${fileName}`;
        console.error(errorText, await uploadResponse.text());
        addWarn(errorText);
      }
    } catch (error) {
      console.error(`Error processing file ${file.name}:`, error);
      addWarn(`Error processing file: ${file.name}`);
    }
  };

  // 处理文件删除
  const handleDelete = async (file: UploadedFile, index: number) => {
    try {
      console.log("Deleting file:", file);
      const userId = await getUserId();
      const deleteKey = `${userId}/${file.task_id}/${file.fileName}`;
      console.log("Delete key:", deleteKey);
      
      const response = await fetch(`${SYSTEM_URLS.PUPPY_STORAGE.BASE}/storage/delete/${deleteKey}`, {
        method: 'DELETE'
      });
      if (response.ok) {
        console.log("File deleted successfully");
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
    handleDelete
  };
}