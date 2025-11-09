type HeaderBarProps = {
  userAvatarUrl?: string | null;
};

export function HeaderBar({ userAvatarUrl }: HeaderBarProps) {
  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        height: 56,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 12px',
        borderBottom: '1px solid #1f1f1f',
        background: '#0b0b0b',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <img src="/puppybase.svg" alt="PuppyBase" width={20} height={20} />
        <div style={{ fontSize: 14, color: '#ddd', letterSpacing: 0.2 }}>PuppyBase</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {userAvatarUrl ? (
          <img
            src={userAvatarUrl}
            alt="User"
            width={28}
            height={28}
            style={{ borderRadius: 999, border: '1px solid #2a2a2a', objectFit: 'cover' }}
          />
        ) : (
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 999,
              border: '1px solid #2a2a2a',
              display: 'grid',
              placeItems: 'center',
              color: '#aaa',
              background: '#151515',
              fontSize: 12,
            }}
          >
            U
          </div>
        )}
      </div>
    </header>
  );
}


