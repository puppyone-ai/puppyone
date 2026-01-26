'use client';

export interface CreateMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  onCreateFolder: () => void;
  onCreateContext: () => void;
}

export function CreateMenu({
  x,
  y,
  onClose,
  onCreateFolder,
  onCreateContext,
}: CreateMenuProps) {
  return (
    <div
      style={{
        position: 'fixed',
        top: y,
        left: x,
        zIndex: 1000,
        background: 'rgba(28, 28, 30, 0.98)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 10,
        padding: '6px 0',
        minWidth: 180,
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      }}
    >
      <div
        onClick={() => {
          onCreateFolder();
          onClose();
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          cursor: 'pointer',
          color: '#e4e4e7',
          fontSize: 14,
          transition: 'background 0.1s',
        }}
        onMouseEnter={e =>
          (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')
        }
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M4 20H20C21.1046 20 22 19.1046 22 18V8C22 6.89543 21.1046 6 20 6H13.8284C13.298 6 12.7893 5.78929 12.4142 5.41421L10.5858 3.58579C10.2107 3.21071 9.70201 3 9.17157 3H4C2.89543 3 2 3.89543 2 5V18C2 19.1046 2.89543 20 4 20Z"
            fill="#a1a1aa"
            fillOpacity="0.2"
            stroke="#a1a1aa"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span>New Folder</span>
      </div>

      <div
        style={{
          height: 1,
          background: 'rgba(255,255,255,0.08)',
          margin: '4px 8px',
        }}
      />

      <div
        onClick={() => {
          onCreateContext();
          onClose();
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          cursor: 'pointer',
          color: '#e4e4e7',
          fontSize: 14,
          transition: 'background 0.1s',
        }}
        onMouseEnter={e =>
          (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')
        }
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M19 3H5C3.89543 3 3 3.89543 3 5V19C3 20.1046 3.89543 21 5 21H19C20.1046 21 21 20.1046 21 19V5C21 3.89543 20.1046 3 19 3Z"
            stroke="#34d399"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="#34d399"
            fillOpacity="0.1"
          />
          <path
            d="M3 9H21"
            stroke="#34d399"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M3 15H21"
            stroke="#34d399"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M9 3V21"
            stroke="#34d399"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span>New Context</span>
      </div>
    </div>
  );
}

