'use client';

import React from 'react';
import { Controls } from '@xyflow/react';
import SaveButton from './SaveButton';

export default function ControlsSaveButtons() {
  return (
    <div className='flex items-center gap-2 pointer-events-auto'>
      <Controls
        className='react-flow__controls-custom'
        showZoom={true}
        showFitView={true}
        showInteractive={false}
        orientation='horizontal'
        style={{ position: 'relative' }}
      />
      <SaveButton />
    </div>
  );
}
