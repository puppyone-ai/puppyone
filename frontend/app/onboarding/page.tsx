'use client';

import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/supabase/SupabaseAuthProvider';
import { WelcomeScreen } from '../../components/onboarding/WelcomeScreen';

export default function OnboardingWelcomePage() {
  const router = useRouter();
  const { session } = useAuth();
  
  const userName = session?.user?.email?.split('@')[0] || 'User';

  const handleStart = () => {
    router.push('/onboarding/step1');
  };

  return (
    <WelcomeScreen 
      onStart={handleStart}
      userName={userName}
    />
  );
}