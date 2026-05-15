export default function NotFound() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--po-inset)', color: 'var(--po-text-muted)', fontFamily: 'var(--po-font-sans)' }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: 48, fontWeight: 600, color: 'var(--po-text)', margin: 0 }}>404</h1>
        <p style={{ fontSize: 14, marginTop: 8 }}>Page not found</p>
      </div>
    </div>
  );
}
