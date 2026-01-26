import React from 'react';

// 文件类型颜色方案
export const FILE_TYPE_COLORS = {
  folder: '#3b82f6', // blue-500
  table: '#34d399', // emerald-400
  markdown: '#9333ea', // purple-600
  pdf: '#ef4444', // red-500
  doc: '#2563eb', // blue-600
  image: '#f59e0b', // amber-500
  code: '#06b6d4', // cyan-500
  default: '#6b7280', // gray-500
} as const;

// 根据文件扩展名获取颜色
export function getFileColor(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'md':
    case 'mdx':
    case 'markdown':
      return FILE_TYPE_COLORS.markdown;
    case 'pdf':
      return FILE_TYPE_COLORS.pdf;
    case 'doc':
    case 'docx':
      return FILE_TYPE_COLORS.doc;
    case 'jpg':
    case 'jpeg':
    case 'png':
    case 'gif':
    case 'svg':
    case 'webp':
      return FILE_TYPE_COLORS.image;
    case 'js':
    case 'ts':
    case 'tsx':
    case 'jsx':
    case 'py':
    case 'json':
      return FILE_TYPE_COLORS.code;
    default:
      return FILE_TYPE_COLORS.default;
  }
}

// 文件夹图标
export const FolderIcon = ({
  size = 48,
  color = FILE_TYPE_COLORS.folder,
}: {
  size?: number;
  color?: string;
}) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
  >
    <path
      d='M2 6C2 4.89543 2.89543 4 4 4H9.17157C9.70201 4 10.2107 4.21071 10.5858 4.58579L12.4142 6.41421C12.7893 6.78929 13.298 7 13.8284 7H20C21.1046 7 22 7.89543 22 9V18C22 19.1046 21.1046 20 20 20H4C2.89543 20 2 19.1046 2 18V6Z'
      fill={color}
    />
  </svg>
);

// 表格/数据图标
export const TableIcon = ({
  size = 48,
  color = FILE_TYPE_COLORS.table,
}: {
  size?: number;
  color?: string;
}) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
  >
    <rect
      x='3'
      y='3'
      width='18'
      height='18'
      rx='2'
      stroke={color}
      strokeWidth='2'
    />
    <path d='M3 9H21' stroke={color} strokeWidth='2' />
    <path d='M9 21V9' stroke={color} strokeWidth='2' />
  </svg>
);

// Markdown 文件图标
export const MarkdownIcon = ({
  size = 48,
  color = FILE_TYPE_COLORS.markdown,
}: {
  size?: number;
  color?: string;
}) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
  >
    {/* 文件外框 - 带折角 */}
    <path
      d='M6 2C4.89543 2 4 2.89543 4 4V20C4 21.1046 4.89543 22 6 22H18C19.1046 22 20 21.1046 20 20V8L14 2H6Z'
      fill={color}
      fillOpacity='0.15'
      stroke={color}
      strokeWidth='1.5'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
    {/* 折角 */}
    <path
      d='M14 2V6C14 7.10457 14.8954 8 16 8H20'
      stroke={color}
      strokeWidth='1.5'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
    {/* M 字母 */}
    <path
      d='M7.5 17V11L9.5 14L11.5 11V17'
      stroke={color}
      strokeWidth='1.5'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
    {/* 向下箭头 (Markdown 标志性符号) */}
    <path
      d='M15 12V17M15 17L13 15M15 17L17 15'
      stroke={color}
      strokeWidth='1.5'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  </svg>
);

// PDF 文件图标
export const PdfIcon = ({
  size = 48,
  color = FILE_TYPE_COLORS.pdf,
}: {
  size?: number;
  color?: string;
}) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
  >
    {/* 文件外框 - 带折角 */}
    <path
      d='M6 2C4.89543 2 4 2.89543 4 4V20C4 21.1046 4.89543 22 6 22H18C19.1046 22 20 21.1046 20 20V8L14 2H6Z'
      fill={color}
      fillOpacity='0.15'
      stroke={color}
      strokeWidth='1.5'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
    {/* 折角 */}
    <path
      d='M14 2V6C14 7.10457 14.8954 8 16 8H20'
      stroke={color}
      strokeWidth='1.5'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
    {/* PDF 文字 */}
    <text
      x='12'
      y='16'
      fontSize='6'
      fontWeight='bold'
      fill={color}
      textAnchor='middle'
      fontFamily='system-ui, sans-serif'
    >
      PDF
    </text>
  </svg>
);

// 通用文件图标
export const FileIcon = ({
  size = 48,
  color = FILE_TYPE_COLORS.default,
}: {
  size?: number;
  color?: string;
}) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
  >
    {/* 文件外框 - 带折角 */}
    <path
      d='M6 2C4.89543 2 4 2.89543 4 4V20C4 21.1046 4.89543 22 6 22H18C19.1046 22 20 21.1046 20 20V8L14 2H6Z'
      fill={color}
      fillOpacity='0.15'
      stroke={color}
      strokeWidth='1.5'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
    {/* 折角 */}
    <path
      d='M14 2V6C14 7.10457 14.8954 8 16 8H20'
      stroke={color}
      strokeWidth='1.5'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
    {/* 内容线条 */}
    <path d='M8 13H16' stroke={color} strokeWidth='1.5' strokeLinecap='round' />
    <path d='M8 17H13' stroke={color} strokeWidth='1.5' strokeLinecap='round' />
  </svg>
);

// 图片文件图标
export const ImageIcon = ({
  size = 48,
  color = FILE_TYPE_COLORS.image,
}: {
  size?: number;
  color?: string;
}) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
  >
    {/* 文件外框 */}
    <rect
      x='4'
      y='4'
      width='16'
      height='16'
      rx='2'
      fill={color}
      fillOpacity='0.15'
      stroke={color}
      strokeWidth='1.5'
    />
    {/* 山峰 */}
    <path
      d='M4 16L8 12L11 15L14 11L20 17'
      stroke={color}
      strokeWidth='1.5'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
    {/* 太阳 */}
    <circle cx='16' cy='8' r='2' fill={color} />
  </svg>
);

// 代码文件图标
export const CodeIcon = ({
  size = 48,
  color = FILE_TYPE_COLORS.code,
}: {
  size?: number;
  color?: string;
}) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
  >
    {/* 文件外框 - 带折角 */}
    <path
      d='M6 2C4.89543 2 4 2.89543 4 4V20C4 21.1046 4.89543 22 6 22H18C19.1046 22 20 21.1046 20 20V8L14 2H6Z'
      fill={color}
      fillOpacity='0.15'
      stroke={color}
      strokeWidth='1.5'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
    {/* 折角 */}
    <path
      d='M14 2V6C14 7.10457 14.8954 8 16 8H20'
      stroke={color}
      strokeWidth='1.5'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
    {/* 代码括号 */}
    <path
      d='M9 12L7 14L9 16'
      stroke={color}
      strokeWidth='1.5'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
    <path
      d='M15 12L17 14L15 16'
      stroke={color}
      strokeWidth='1.5'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
    <path
      d='M12 11L11 17'
      stroke={color}
      strokeWidth='1.5'
      strokeLinecap='round'
    />
  </svg>
);

// 根据文件名获取对应的图标组件
export function getFileIcon(filename: string, size = 48): React.ReactNode {
  const ext = filename.split('.').pop()?.toLowerCase();

  switch (ext) {
    case 'md':
    case 'mdx':
    case 'markdown':
      return <MarkdownIcon size={size} />;
    case 'pdf':
      return <PdfIcon size={size} />;
    case 'doc':
    case 'docx':
      return <FileIcon size={size} color={FILE_TYPE_COLORS.doc} />;
    case 'jpg':
    case 'jpeg':
    case 'png':
    case 'gif':
    case 'svg':
    case 'webp':
      return <ImageIcon size={size} />;
    case 'js':
    case 'ts':
    case 'tsx':
    case 'jsx':
    case 'py':
    case 'json':
      return <CodeIcon size={size} />;
    default:
      return <FileIcon size={size} />;
  }
}

// 文件类型图标集合 (用于 14px 小图标场景，如面包屑)
export const FILE_TYPE_ICONS = {
  folder: (
    <svg
      width='14'
      height='14'
      viewBox='0 0 24 24'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      style={{ color: FILE_TYPE_COLORS.folder }}
    >
      <path
        d='M2 6C2 4.89543 2.89543 4 4 4H9.17157C9.70201 4 10.2107 4.21071 10.5858 4.58579L12.4142 6.41421C12.7893 6.78929 13.298 7 13.8284 7H20C21.1046 7 22 7.89543 22 9V18C22 19.1046 21.1046 20 20 20H4C2.89543 20 2 19.1046 2 18V6Z'
        fill='currentColor'
      />
    </svg>
  ),
  table: (
    <svg
      width='14'
      height='14'
      viewBox='0 0 24 24'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      style={{ color: FILE_TYPE_COLORS.table }}
    >
      <rect
        x='3'
        y='3'
        width='18'
        height='18'
        rx='2'
        stroke='currentColor'
        strokeWidth='2'
      />
      <path d='M3 9H21' stroke='currentColor' strokeWidth='2' />
      <path d='M9 21V9' stroke='currentColor' strokeWidth='2' />
    </svg>
  ),
  markdown: (
    <svg
      width='14'
      height='14'
      viewBox='0 0 24 24'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      style={{ color: FILE_TYPE_COLORS.markdown }}
    >
      <path
        d='M6 2C4.89543 2 4 2.89543 4 4V20C4 21.1046 4.89543 22 6 22H18C19.1046 22 20 21.1046 20 20V8L14 2H6Z'
        fill='currentColor'
        fillOpacity='0.15'
        stroke='currentColor'
        strokeWidth='1.5'
      />
      <path
        d='M14 2V6C14 7.10457 14.8954 8 16 8H20'
        stroke='currentColor'
        strokeWidth='1.5'
      />
      <path
        d='M7 16V12L9 14L11 12V16'
        stroke='currentColor'
        strokeWidth='1.2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M14 13V16M14 16L13 15M14 16L15 15'
        stroke='currentColor'
        strokeWidth='1.2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  ),
};
