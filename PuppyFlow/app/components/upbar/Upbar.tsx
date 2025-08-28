import React, { useEffect, useState } from 'react';
import AddNodeButton from './upbarComponent/AddNodeButton';
import SaveButton from './upbarComponent/SaveButton';
import MoreOptionsButton from './upbarComponent/MoreOptionsButton';
import GroupListButton from './upbarComponent/GroupListButton';
import { Controls } from '@xyflow/react';

function Upbar() {
  // Legacy state passed to MoreOptionsButton; Headless UI handles open/close internally
  const [showMenu, setShowMenu] = useState(-1);

  // Optional: close pseudo-state on outside click to keep parity with old behavior
  useEffect(() => {
    const onMouseClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const containers = document.getElementsByClassName(
        'TopRightButtonWithMenu'
      );
      if (!Array.from(containers).some(c => c.contains(target))) {
        setShowMenu(-1);
      }
    };
    document.addEventListener('click', onMouseClick);
    return () => document.removeEventListener('click', onMouseClick);
  }, []);

  return (
    <div className='w-auto h-[44px] gap-[12px] absolute top-[48px] left-1/2 -translate-x-1/2 z-[10000] flex flex-row justify-center items-center pointer-events-none'>
      <div className='flex flex-row items-center gap-6 pointer-events-auto'>
        <AddNodeButton />

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
        <div className='w-auto h-[36px] border border-[#2A2A2A] rounded-[8px] flex flex-row items-center bg-[#252525]'>
          <MoreOptionsButton showMenu={showMenu} showMenuHandler={setShowMenu} />
        </div>
        <GroupListButton />
      </div>
    </div>
  );
}

export default Upbar;
