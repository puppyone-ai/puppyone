'use client';

import type { ReactNode } from 'react';

interface OrganizationPageShellProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function OrganizationPageShell({
  title,
  description,
  actions,
  children,
}: OrganizationPageShellProps) {
  return (
    <div className="flex-1 overflow-y-auto bg-[#0e0e0e]">
      <div className="mx-auto w-full max-w-[900px] px-8 py-8 pb-24">
        <div className="mb-8 flex items-start justify-between gap-6">
          <div className="min-w-0">
            <h1 className="text-[24px] font-semibold leading-tight tracking-tight text-[#f4f4f5]">
              {title}
            </h1>
            {description && (
              <p className="mt-1.5 text-[14px] leading-6 text-[#6f6f78]">
                {description}
              </p>
            )}
          </div>
          {actions && <div className="shrink-0 pt-0.5">{actions}</div>}
        </div>

        {children}
      </div>
    </div>
  );
}
