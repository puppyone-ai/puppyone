'use client';
import React from 'react';

type TextActionMenuProps = {
  value: string;
  onClear: () => void;
  onTransferToList: () => void;
  onTransferToDict: () => void;
  className?: string;
};

const IconCopy = () => (
  <svg className="w-3.5 h-3.5 text-[#D1D5DB]" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
    <rect x="7" y="7" width="9" height="9" rx="1.8"/>
    <rect x="4" y="4" width="9" height="9" rx="1.8"/>
  </svg>
);

const IconTrash = () => (
  <svg className="w-3.5 h-3.5 text-[#D1D5DB]" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="M6 6h8m-7 2.5V15a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V8.5M8 6V4.8A1.8 1.8 0 0 1 9.8 3h0.4A1.8 1.8 0 0 1 12 4.8V6" strokeLinecap="round"/>
  </svg>
);

const IconList = () => (
  <svg className="w-3.5 h-3.5 text-[#D1D5DB]" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="M4 6h10M4 10h10M4 14h10M3 6h0.01M3 10h0.01M3 14h0.01" strokeLinecap="round"/>
  </svg>
);

const IconDict = () => (
  <svg className="w-3.5 h-3.5 text-[#D1D5DB]" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="M5 4v12M15 4v12M8 7h4M8 10h4M8 13h4" strokeLinecap="round"/>
  </svg>
);

const TextActionMenu: React.FC<TextActionMenuProps> = ({
  value,
  onClear,
  onTransferToList,
  onTransferToDict,
  className = '',
}) => {
  return (
    <div
      className={`rjft-action-menu relative z-50 bg-[#252525] border border-[#3A3D45] rounded-md shadow-[0_6px_20px_rgba(0,0,0,0.4)] py-1 w-40 ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-[#E5E7EB] hover:bg-[#2e2e2e] rounded"
        onClick={() => { navigator.clipboard.writeText(value || ''); window.dispatchEvent(new CustomEvent('rjft:close-all-menus')); }}
      >
        <IconCopy />
        <span>Copy</span>
      </button>
      <button
        className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-[#E5E7EB] hover:bg-[#2e2e2e] rounded"
        onClick={onClear}
      >
        <IconTrash />
        <span>Clear</span>
      </button>
      <div className="h-px bg-[#3A3D45] my-1"></div>
      <div className="px-2 pb-1 text-[10px] tracking-wide uppercase text-[#9CA3AF]">Transfer</div>
      <button
        className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-[#E5E7EB] hover:bg-[#2e2e2e] rounded"
        onClick={onTransferToList}
      >
        <IconList />
        <span>To list</span>
      </button>
      <button
        className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-[#E5E7EB] hover:bg-[#2e2e2e] rounded"
        onClick={onTransferToDict}
      >
        <IconDict />
        <span>To dict</span>
      </button>
      {/* arrow removed */}
    </div>
  );
};

export default TextActionMenu;
