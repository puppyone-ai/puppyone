import type { TableData } from '../lib/mock';

export function TableGrid({ data }: { data: TableData }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - 56px - 48px - 40px)',
        borderTop: '1px solid #1d2027',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `40px repeat(${data.columns.length}, minmax(160px, 1fr))`,
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          background: '#121621',
          color: '#7d8596',
          borderBottom: '1px solid #1d2027',
        }}
      >
        <div style={headerCellStyle}></div>
        {data.columns.map((col) => (
          <div key={col} style={headerCellStyle}>
            {col}
          </div>
        ))}
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {data.rows.map((row, rowIdx) => (
          <div
            key={rowIdx}
            style={{
              display: 'grid',
              gridTemplateColumns: `40px repeat(${data.columns.length}, minmax(160px, 1fr))`,
              borderBottom: '1px solid #161922',
              background: rowIdx % 2 === 0 ? '#0f1115' : '#0c0d12',
              color: '#d7dbec',
              fontSize: 12,
            }}
          >
            <div style={{ ...bodyCellStyle, justifyContent: 'center' }}>
              <input type="checkbox" style={{ width: 12, height: 12, accentColor: '#4E5AF7' }} />
            </div>
            {data.columns.map((col) => (
              <div key={col} style={bodyCellStyle}>
                {row[col] ?? '—'}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div
        style={{
          padding: '6px 16px',
          fontSize: 11,
          color: '#758097',
          borderTop: '1px solid #1d2027',
          background: '#0f1115',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>Rows {data.rows.length}</span>
        <span>Preview only</span>
      </div>
    </div>
  )
}

const headerCellStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderRight: '1px solid #1d2027',
};

const bodyCellStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderRight: '1px solid #161922',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

