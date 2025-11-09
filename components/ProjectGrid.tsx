import Link from 'next/link';
import type { ProjectInfo } from '../lib/mock';

export function ProjectGrid({ projects }: { projects: ProjectInfo[] }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
        gap: 16,
        padding: 16,
      }}
    >
      {projects.map((p) => (
        <Link
          key={p.id}
          href={`/projects/${p.id}`}
          style={{
            border: '1px solid #1f1f1f',
            borderRadius: 12,
            background: '#101010',
            padding: 14,
            color: '#ddd',
            textDecoration: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <img src="/puppybase.svg" alt="" width={18} height={18} />
            <div style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</div>
          </div>
          {p.description && (
            <div style={{ fontSize: 12, color: '#9aa' }}>{p.description}</div>
          )}
          <div style={{ fontSize: 12, color: '#8fb' }}>{p.tables.length} tables</div>
        </Link>
      ))}
    </div>
  );
}


