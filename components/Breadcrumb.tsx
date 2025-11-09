import Link from 'next/link';

export type Crumb = { href?: string; label: string };

export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '8px 12px',
        borderBottom: '1px solid #1f1f1f',
        background: '#0b0b0b',
        color: '#aaa',
        fontSize: 12,
      }}
    >
      {items.map((it, i) => (
        <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {it.href ? (
            <Link href={it.href} style={{ color: '#9db4ff', textDecoration: 'none' }}>{it.label}</Link>
          ) : (
            <span style={{ color: '#ddd' }}>{it.label}</span>
          )}
          {i < items.length - 1 && <span style={{ opacity: .5 }}>/</span>}
        </span>
      ))}
    </nav>
  );
}


