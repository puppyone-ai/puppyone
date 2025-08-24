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
      className={`rjft-action-menu relative z-[2000000] bg-[#252525] p-[8px] border-[1px] border-[#404040] rounded-[8px] gap-[4px] flex flex-col w-[128px] ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        className="px-[0px] rounded-[4px] bg-inherit hover:bg-[#3E3E41] w-full h-[26px] flex justify-start items-center text-[#E5E7EB] font-plus-jakarta-sans text-[12px] font-[400] tracking-[0.5px] cursor-pointer whitespace-nowrap gap-[8px]"
        onClick={() => { navigator.clipboard.writeText(value || ''); window.dispatchEvent(new CustomEvent('rjft:close-all-menus')); }}
      >
        <IconCopy />
        <span>Copy</span>
      </button>
      <button
        className="px-[0px] rounded-[4px] bg-inherit hover:bg-[#3E3E41] w-full h-[26px] flex justify-start items-center text-[#E5E7EB] font-plus-jakarta-sans text-[12px] font-[400] tracking-[0.5px] cursor-pointer whitespace-nowrap gap-[8px]"
        onClick={onClear}
      >
        <IconTrash />
        <span>Clear</span>
      </button>
      <div className="h-px bg-[#3A3D45] my-1"></div>
      <div className="px-[4px] pb-[2px] text-[10px] tracking-[0.5px] uppercase text-[#9CA3AF]">Transfer</div>
      <button
        className="px-[0px] rounded-[4px] bg-inherit hover:bg-[#3E3E41] w-full h-[26px] flex justify-start items-center text-[#E5E7EB] font-plus-jakarta-sans text-[12px] font-[400] tracking-[0.5px] cursor-pointer whitespace-nowrap gap-[8px]"
        onClick={onTransferToList}
      >
        <IconList />
        <span>To list</span>
      </button>
      <button
        className="px-[0px] rounded-[4px] bg-inherit hover:bg-[#3E3E41] w-full h-[26px] flex justify-start items-center text-[#E5E7EB] font-plus-jakarta-sans text-[12px] font-[400] tracking-[0.5px] cursor-pointer whitespace-nowrap gap-[8px]"
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
