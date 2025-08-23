'use client';
import React from 'react';

type ListActionMenuProps = {
  value: any[];
  onClear: () => void;
  onTransferToText: () => void;
  onTransferToDict: () => void;
  className?: string;
};

const ListActionMenu: React.FC<ListActionMenuProps> = ({
  value,
  onClear,
  onTransferToText,
  onTransferToDict,
  className = '',
}) => {
  return (
    <div
      className={`bg-[#1f2937] border border-[#374151] rounded-md shadow-xl p-1 w-32 ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        className="w-full text-left px-2 py-1.5 text-sm hover:bg-[#374151] rounded"
        onClick={() => navigator.clipboard.writeText(JSON.stringify(value, null, 2))}
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
        onClick={onTransferToText}
      >
        to text
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

export default ListActionMenu;
