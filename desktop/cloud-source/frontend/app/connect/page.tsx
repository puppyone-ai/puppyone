'use client';

import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';

const ConnectContentView = dynamic(
  () => import('../../components/ConnectContentView').then(m => m.ConnectContentView),
  { ssr: false },
);

export default function ConnectPage() {
  const router = useRouter();

  const handleBackToProjects = () => {
    router.push('/home');
  };

  return (
    <main
      style={{
        display: 'flex',
        height: '100vh',
        overflow: 'hidden',
        backgroundColor: 'var(--po-inset)',
      }}
    >
      <section
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: 'var(--po-inset)',
        }}
      >
        <ConnectContentView onBack={handleBackToProjects} />
      </section>
    </main>
  );
}
