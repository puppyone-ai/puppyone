import React, { useState } from 'react';
import { WizardLayout } from '../components/WizardLayout';
import { useOnboardingStore } from '../store';

export function Step4_Configuration() {
  const { setStep } = useOnboardingStore();
  const [allowWrite, setAllowWrite] = useState(false);

  return (
    <WizardLayout
      title='Configure Agent Access'
      subtitle='Define what Agents can do with this context.'
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
        {/* Permission Scope */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: '#aaa',
              textTransform: 'uppercase',
            }}
          >
            Permissions
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: 16,
                background: '#161616',
                borderRadius: 8,
                cursor: 'not-allowed',
                opacity: 0.7,
              }}
            >
              <input type='checkbox' checked disabled />
              <div>
                <div style={{ fontWeight: 500 }}>Read Access</div>
                <div style={{ fontSize: 12, color: '#666' }}>
                  Allow agents to search and read data. (Required)
                </div>
              </div>
            </label>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: 16,
                background: '#161616',
                borderRadius: 8,
                cursor: 'pointer',
                border: allowWrite ? '1px solid #ef4444' : '1px solid #333',
              }}
            >
              <input
                type='checkbox'
                checked={allowWrite}
                onChange={e => setAllowWrite(e.target.checked)}
              />
              <div>
                <div
                  style={{
                    fontWeight: 500,
                    color: allowWrite ? '#ef4444' : '#fff',
                  }}
                >
                  Write Access
                </div>
                <div style={{ fontSize: 12, color: '#666' }}>
                  Allow agents to add, edit, or delete data.
                </div>
              </div>
            </label>
          </div>
        </div>

        {/* Tools Preview */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: '#aaa',
              textTransform: 'uppercase',
            }}
          >
            Generated Tools
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <div
              style={{
                background: '#252525',
                padding: '6px 12px',
                borderRadius: 4,
                fontSize: 13,
                fontFamily: 'monospace',
                color: '#888',
              }}
            >
              mcp_search_data
            </div>
            <div
              style={{
                background: '#252525',
                padding: '6px 12px',
                borderRadius: 4,
                fontSize: 13,
                fontFamily: 'monospace',
                color: '#888',
              }}
            >
              mcp_get_by_id
            </div>
            {allowWrite && (
              <div
                style={{
                  background: 'rgba(239,68,68,0.1)',
                  border: '1px solid rgba(239,68,68,0.2)',
                  padding: '6px 12px',
                  borderRadius: 4,
                  fontSize: 13,
                  fontFamily: 'monospace',
                  color: '#ef4444',
                }}
              >
                mcp_create_item
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            marginTop: 'auto',
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <button
            onClick={() => setStep('testing')}
            style={{
              background: '#4599DF',
              color: '#fff',
              border: 'none',
              padding: '12px 32px',
              borderRadius: 8,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Save Configuration →
          </button>
        </div>
      </div>
    </WizardLayout>
  );
}
