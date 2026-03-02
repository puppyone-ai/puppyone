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
    router.push('/projects');
  };

  return (
    <main
      style={{
        display: 'flex',
        height: '100vh',
        overflow: 'hidden',
        backgroundColor: '#0a0a0a',
      }}
    >
      <section
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#0a0a0a',
        }}
      >
        <ConnectContentView onBack={handleBackToProjects} />
      </section>
    </main>
  );
}
