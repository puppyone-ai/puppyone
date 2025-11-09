type Props = {
  tableName: string;
  rows?: number;
};

export function TableHeader({ tableName, rows }: Props) {
  return (
    <div
      style={{
        height: 48,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        borderBottom: '1px solid #1d2027',
        background: '#0f1115',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 8, height: 28, borderRadius: 4, background: '#4E5AF7' }}></div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#f5f6f9' }}>{tableName}</div>
          <div style={{ fontSize: 11, color: '#a0a6b5' }}>{rows ?? 0} rows</div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button style={toolbarBtnStyle}>Filters</button>
        <button style={toolbarBtnStyle}>Sort</button>
        <button style={{ ...toolbarBtnStyle, borderColor: '#3f4aff', color: '#bcc6ff' }}>Insert</button>
      </div>
    </div>
  );
}

const toolbarBtnStyle: React.CSSProperties = {
  height: 28,
  padding: '0 12px',
  borderRadius: 6,
  border: '1px solid #232733',
  background: '#151821',
  color: '#cdd2df',
  fontSize: 12,
  cursor: 'pointer',
};


