import React from 'react';
import AddNodeButton from './topLeftToolBar/AddNodeButton';
import TopRightToolBar from './topRightToolBar/TopRightToolBar';

function Upbar() {
  return (
    <div className='w-auto h-[44px] gap-[12px] absolute top-[48px] left-1/2 -translate-x-1/2 z-[10000] flex flex-row justify-center items-center pointer-events-none'>
      <div className='flex flex-row items-center gap-6 pointer-events-auto'>
        <AddNodeButton />
        <TopRightToolBar />
      </div>
    </div>
  );
}

export default Upbar;
