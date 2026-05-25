'use client';

import { SWRConfig } from 'swr';
import type { ReactNode } from 'react';

export function SWRGlobalProvider({ children }: { children: ReactNode }) {
  return (
    <SWRConfig
      value={{
        dedupingInterval: 5000,
        revalidateOnFocus: false,
        focusThrottleInterval: 300000,
        errorRetryCount: 2,
      }}
    >
      {children}
    </SWRConfig>
  );
}
