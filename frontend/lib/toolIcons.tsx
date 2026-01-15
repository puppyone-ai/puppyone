import React from 'react';

export const TOOL_ICONS: Record<string, React.ReactNode> = {
  get_data_schema: (
    <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
      <path
        d='M5.2 3.2c-1.2.6-2 1.8-2 3.8s.8 3.2 2 3.8'
        stroke='currentColor'
        strokeWidth='1.2'
        strokeLinecap='round'
      />
      <path
        d='M8.8 3.2c1.2.6 2 1.8 2 3.8s-.8 3.2-2 3.8'
        stroke='currentColor'
        strokeWidth='1.2'
        strokeLinecap='round'
      />
      <path
        d='M6.2 5.4h1.6M6.2 7h1.6M6.2 8.6h1.6'
        stroke='currentColor'
        strokeWidth='1.2'
        strokeLinecap='round'
      />
    </svg>
  ),
  query_data: (
    <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
      {/* 搜索圆圈 */}
      <circle
        cx='5.5'
        cy='5.5'
        r='3.5'
        stroke='currentColor'
        strokeWidth='1.2'
      />
      {/* 搜索手柄 */}
      <path
        d='M8.5 8.5l3 3'
        stroke='currentColor'
        strokeWidth='1.2'
        strokeLinecap='round'
      />
      {/* 向量点 - 代表语义搜索 */}
      <circle cx='4.5' cy='4.5' r='0.8' fill='currentColor' />
      <circle cx='6.5' cy='5.5' r='0.8' fill='currentColor' />
      <circle cx='5' cy='6.5' r='0.8' fill='currentColor' />
    </svg>
  ),
  get_all_data: (
    <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
      <rect
        x='2'
        y='2'
        width='10'
        height='2'
        rx='0.5'
        stroke='currentColor'
        strokeWidth='1.2'
      />
      <rect
        x='2'
        y='6'
        width='10'
        height='2'
        rx='0.5'
        stroke='currentColor'
        strokeWidth='1.2'
      />
      <rect
        x='2'
        y='10'
        width='10'
        height='2'
        rx='0.5'
        stroke='currentColor'
        strokeWidth='1.2'
      />
    </svg>
  ),
  create: (
    <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
      <path
        d='M7 3v8M3 7h8'
        stroke='currentColor'
        strokeWidth='1.3'
        strokeLinecap='round'
      />
    </svg>
  ),
  update: (
    <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
      <path
        d='M10 2l2 2-7 7H3v-2l7-7z'
        stroke='currentColor'
        strokeWidth='1.2'
        strokeLinejoin='round'
      />
    </svg>
  ),
  delete: (
    <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
      <path
        d='M2 4h10M5 4V2.5A.5.5 0 015.5 2h3a.5.5 0 01.5.5V4M11 4v7.5a1.5 1.5 0 01-1.5 1.5h-5A1.5 1.5 0 013 11.5V4'
        stroke='currentColor'
        strokeWidth='1.2'
        strokeLinecap='round'
      />
    </svg>
  ),
};

// 默认图标（加号）
export const DEFAULT_TOOL_ICON = (
  <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
    <path
      d='M7 3v8M3 7h8'
      stroke='currentColor'
      strokeWidth='1.2'
      strokeLinecap='round'
    />
  </svg>
);
