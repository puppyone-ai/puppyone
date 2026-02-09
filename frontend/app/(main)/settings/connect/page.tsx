'use client';

import { ConnectContentView } from '@/components/ConnectContentView';
import { useRouter } from 'next/navigation';

export default function ConnectPage() {
  const router = useRouter();

  return <ConnectContentView onBack={() => router.back()} />;
}
