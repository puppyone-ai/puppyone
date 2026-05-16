'use client';

import { useState } from 'react';
import { SettingsSidebar } from './SettingsSidebar';
import { ConnectContentView } from '../../../components/ConnectContentView';

type SettingsManagerProps = {
  onBack: () => void;
};

type SettingsView = 'import';

export function SettingsManager({ onBack }: SettingsManagerProps) {
  const [currentView, setCurrentView] = useState<SettingsView>('import');

  return (
    <div style={{ display: 'flex', height: '100%', background: 'var(--po-canvas)' }}>
      {/* Sub-Sidebar */}
      <SettingsSidebar
        currentView={currentView}
        onChangeView={setCurrentView}
      />

      {/* Main Content */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {currentView === 'import' && <ConnectContentView onBack={onBack} />}
      </div>
    </div>
  );
}
