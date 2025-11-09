'use client'

type TableItem = { id: string; name: string; rows?: number };

export function ProjectSidebar({
  tables,
  activeId,
  onSelect,
}: {
  tables: TableItem[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <aside
      style={{
        width: 240,
        borderRight: '1px solid #1f1f1f',
        background: '#0b0b0b',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: 8,
      }}
    >
      <div style={{ fontSize: 12, color: '#888', padding: '4px 6px' }}>Tables</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {tables.map((t) => {
          const active = t.id === activeId;
          return (
            <button
              key={t.id}
              onClick={() => onSelect(t.id)}
              style={{
                textAlign: 'left',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                height: 30,
                fontSize: 12,
                padding: '0 12px',
                width: '100%',
                border: '1px solid ' + (active ? '#334' : '#1f1f1f'),
                background: active ? '#151a24' : '#111',
                color: active ? '#dfe5ff' : '#ddd',
                borderRadius: 8,
                cursor: 'pointer',
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 3,
                  border: '1px solid ' + (active ? '#4E5AF7' : '#2a2a2a'),
                  background:
                    'linear-gradient(#2a2a2a 1px, transparent 1px) 0 0/6px 6px, linear-gradient(90deg,#2a2a2a 1px, transparent 1px) 0 0/6px 6px',
                  backgroundColor: active ? '#171a25' : '#101010',
                  display: 'inline-block',
                }}
              />
              <span style={{ fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                {t.name}
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}


