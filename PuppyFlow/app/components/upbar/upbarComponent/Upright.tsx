'use client';

import React from 'react';
import { Controls } from '@xyflow/react';
import SaveButton from './SaveButton';

export default function Upright() {
  return (
    <div className='flex items-center gap-1 pointer-events-auto'>
      <SaveButton />
      <Controls
        className='react-flow__controls-custom'
        showZoom={true}
        showFitView={true}
        showInteractive={false}
        orientation='horizontal'
        style={{ position: 'relative' }}
      />
    </div>
  );
}


