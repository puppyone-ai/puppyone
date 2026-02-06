'use client';

import { FolderItem, FolderItemProps } from './FolderItem';
import { JsonItem, JsonItemProps } from './JsonItem';
import { MarkdownItem, MarkdownItemProps } from './MarkdownItem';
import { ImageItem, ImageItemProps } from './ImageItem';
import { CreateButton, CreateButtonProps } from './CreateButton';

// Re-export individual items for direct use
export { FolderItem } from './FolderItem';
export { JsonItem } from './JsonItem';
export { MarkdownItem } from './MarkdownItem';
export { ImageItem } from './ImageItem';
export { CreateButton } from './CreateButton';

// Re-export types
export type { FolderItemProps } from './FolderItem';
export type { JsonItemProps } from './JsonItem';
export type { MarkdownItemProps } from './MarkdownItem';
export type { ImageItemProps } from './ImageItem';
export type { CreateButtonProps } from './CreateButton';

// === Content Type Definitions ===

export type ContentType = 'folder' | 'json' | 'markdown' | 'image' | 'pdf' | 'video' | 'file';
export type ViewType = 'grid' | 'list' | 'column';

// === Unified Content Item ===

export interface ContentItemProps {
  type: ContentType;
  viewType: ViewType;
  id: string;
  name: string;
  description?: string;
  onClick: (e: React.MouseEvent) => void;
  // Type-specific props
  rowCount?: number;      // for json
  thumbnailUrl?: string;  // for image
}

/**
 * 统一的内容项组件
 * 根据 type 和 viewType 自动选择正确的渲染方式
 */
export function ContentItem({
  type,
  viewType,
  name,
  description,
  onClick,
  rowCount,
  thumbnailUrl,
}: ContentItemProps) {
  switch (type) {
    case 'folder':
      return (
        <FolderItem
          viewType={viewType}
          name={name}
          description={description}
          onClick={onClick}
        />
      );

    case 'json':
      return (
        <JsonItem
          viewType={viewType}
          name={name}
          description={description}
          rowCount={rowCount}
          onClick={onClick}
        />
      );

    case 'markdown':
      return (
        <MarkdownItem
          viewType={viewType}
          name={name}
          description={description}
          onClick={onClick}
        />
      );

    case 'image':
      return (
        <ImageItem
          viewType={viewType}
          name={name}
          description={description}
          thumbnailUrl={thumbnailUrl}
          onClick={onClick}
        />
      );

    // Fallback for types not yet implemented (pdf, video, file)
    // Use a generic file representation
    default:
      return (
        <JsonItem
          viewType={viewType}
          name={name}
          description={description || type}
          onClick={onClick}
        />
      );
  }
}

// === Helper: Map backend type to ContentType ===

export function mapNodeTypeToContentType(nodeType: string): ContentType {
  switch (nodeType) {
    case 'folder':
      return 'folder';
    case 'json':
      return 'json';
    case 'markdown':
      return 'markdown';
    case 'image':
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
      return 'image';
    case 'pdf':
      return 'pdf';
    case 'video':
    case 'mp4':
    case 'webm':
      return 'video';
    default:
      return 'file';
  }
}





