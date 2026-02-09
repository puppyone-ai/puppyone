'use client';

import { useRouter } from 'next/navigation';
import { ConnectContentView } from '../../components/ConnectContentView';

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
