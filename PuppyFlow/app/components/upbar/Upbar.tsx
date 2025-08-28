import React from 'react';
import AddNodeButton from './upbarComponent/AddNodeButton';
import SaveButton from './upbarComponent/SaveButton';
import AddGroupButton from './upbarComponent/AddGroupButton';
import { Controls } from '@xyflow/react';

function Upbar() {
  return (
    <div className='w-auto h-[44px] gap-[12px] absolute top-[48px] left-1/2 -translate-x-1/2 z-[10000] flex flex-row justify-center items-center pointer-events-none'>
      <div className='flex flex-row items-center gap-6 pointer-events-auto'>
        {/* Left actions: + Add Block and Group */}
        <div className='flex flex-row items-center gap-2'>
          <AddNodeButton />
          <AddGroupButton />
        </div>

        <div className='flex items-center'>
          <Controls
            className='react-flow__controls-custom'
            showZoom={true}
            showFitView={true}
            showInteractive={false}
            orientation='horizontal'
            style={{ position: 'relative' }}
          />
        </div>

        <SaveButton />
      </div>
    </div>
  );
}

export default Upbar;
