'use client';

import { redirect } from 'next/navigation';

export default function OAuthCallbackPage() {
  redirect('/oauth/callback/notion');
}
