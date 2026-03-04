'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import useSWR from 'swr';
import {
  getOrganizations,
  getMembers,
  type OrganizationInfo,
  type OrgMember,
} from '@/lib/organizationsApi';
import { useAuth } from '@/app/supabase/SupabaseAuthProvider';

interface OrganizationContextValue {
  orgs: OrganizationInfo[];
  currentOrg: OrganizationInfo | null;
  members: OrgMember[];
  myRole: 'owner' | 'member' | 'viewer' | null;
  isLoading: boolean;
  switchOrg: (orgId: string) => void;
  refreshOrgs: () => Promise<void>;
  refreshMembers: () => Promise<void>;
}

const OrganizationContext = createContext<OrganizationContextValue | null>(null);

export function OrganizationProvider({ children }: { children: React.ReactNode }) {
  const { session, userId } = useAuth();
  const [currentOrgId, setCurrentOrgId] = useState<string | null>(null);

  const {
    data: orgs = [],
    isLoading: isOrgsLoading,
    mutate: mutateOrgs,
  } = useSWR(
    session ? 'organizations' : null,
    () => getOrganizations(),
    { dedupingInterval: 30000, revalidateOnFocus: false }
  );

  // Auto-select org when orgs load
  useEffect(() => {
    if (orgs.length > 0 && !currentOrgId) {
      const stored = typeof window !== 'undefined'
        ? localStorage.getItem('puppyone_current_org')
        : null;
      const target = orgs.find(o => o.id === stored) ?? orgs[0];
      setCurrentOrgId(target.id);
    }
  }, [orgs, currentOrgId]);

  const {
    data: members = [],
    mutate: mutateMembers,
  } = useSWR(
    currentOrgId ? ['org-members', currentOrgId] : null,
    ([, orgId]) => getMembers(orgId),
    { dedupingInterval: 30000, revalidateOnFocus: false }
  );

  const currentOrg = orgs.find(o => o.id === currentOrgId) ?? null;
  const myRole = members.find(m => m.user_id === userId)?.role ?? null;

  const refreshOrgs = useCallback(async () => {
    await mutateOrgs();
  }, [mutateOrgs]);

  const refreshMembers = useCallback(async () => {
    await mutateMembers();
  }, [mutateMembers]);

  useEffect(() => {
    if (currentOrgId && typeof window !== 'undefined') {
      localStorage.setItem('puppyone_current_org', currentOrgId);
    }
  }, [currentOrgId]);

  const switchOrg = useCallback((orgId: string) => {
    setCurrentOrgId(orgId);
  }, []);

  return (
    <OrganizationContext.Provider
      value={{
        orgs,
        currentOrg,
        members,
        myRole,
        isLoading: isOrgsLoading,
        switchOrg,
        refreshOrgs,
        refreshMembers,
      }}
    >
      {children}
    </OrganizationContext.Provider>
  );
}

export function useOrganization() {
  const ctx = useContext(OrganizationContext);
  if (!ctx) {
    throw new Error('useOrganization must be used within OrganizationProvider');
  }
  return ctx;
}
