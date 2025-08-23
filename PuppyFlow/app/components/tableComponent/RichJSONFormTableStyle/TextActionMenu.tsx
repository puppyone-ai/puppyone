'use client';
import React from 'react';

type TextActionMenuProps = {
  value: string;
  onClear: () => void;
  onTransferToList: () => void;
  onTransferToDict: () => void;
  className?: string;
};

const TextActionMenu: React.FC<TextActionMenuProps> = ({
  value,
  onClear,
  onTransferToList,
  onTransferToDict,
  className = '',
}) => {
  return (
    <div
      className={`bg-[#1f2937] border border-[#374151] rounded-md shadow-xl p-1 w-28 ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        className="w-full text-left px-2 py-1.5 text-sm hover:bg-[#374151] rounded"
        onClick={() => navigator.clipboard.writeText(value || '')}
      >
        copy
      </button>
      <button
        className="w-full text-left px-2 py-1.5 text-sm hover:bg-[#374151] rounded"
        onClick={onClear}
      >
        clear
      </button>
      <div className="h-px bg-[#374151] my-1"></div>
      <div className="px-2 py-1 text-xs text-[#9CA3AF]">transfer</div>
      <button
        className="w-full text-left px-2 py-1.5 text-sm hover:bg-[#374151] rounded"
        onClick={onTransferToList}
      >
        to list
      </button>
      <button
        className="w-full text-left px-2 py-1.5 text-sm hover:bg-[#374151] rounded"
        onClick={onTransferToDict}
      >
        to dict
      </button>
    </div>
  );
};

export default TextActionMenu;
