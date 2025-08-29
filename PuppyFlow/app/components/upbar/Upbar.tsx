import React from 'react';
import AddNodeButton from './upbarComponent/AddNodeButton';
import AddGroupButton from './upbarComponent/AddGroupButton';
import ControlsSaveButtons from './upbarComponent/ControlsSaveButtons';

function Upbar() {
  return (
    <div className='w-auto h-[52px] gap-[12px] absolute top-[48px] left-1/2 -translate-x-1/2 z-[10000] flex flex-row justify-center items-center pointer-events-none'>
      <div
        className='pointer-events-auto will-change-auto bg-gradient-to-b from-[#1E1F22]/95 to-[#131416]/95 rounded-[14px] border border-[#3e3e41] ring-1 ring-black/30 shadow-2xl shadow-black/50 backdrop-blur-md flex flex-row items-center gap-4 px-3 py-2'
      >
        <AddNodeButton />
        <AddGroupButton />
        <ControlsSaveButtons />
      </div>
    </div>
  );
}

export default Upbar;
