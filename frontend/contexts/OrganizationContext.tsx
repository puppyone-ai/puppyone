'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
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
  const [orgs, setOrgs] = useState<OrganizationInfo[]>([]);
  const [currentOrgId, setCurrentOrgId] = useState<string | null>(null);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const currentOrg = orgs.find(o => o.id === currentOrgId) ?? null;

  const myRole = members.find(m => m.user_id === userId)?.role ?? null;

  const refreshOrgs = useCallback(async () => {
    if (!session) return;
    try {
      const data = await getOrganizations();
      setOrgs(data);
      if (data.length > 0 && !currentOrgId) {
        const stored = typeof window !== 'undefined'
          ? localStorage.getItem('puppyone_current_org')
          : null;
        const target = data.find(o => o.id === stored) ?? data[0];
        setCurrentOrgId(target.id);
      }
    } catch (err) {
      console.error('Failed to load organizations:', err);
    }
  }, [session, currentOrgId]);

  const refreshMembers = useCallback(async () => {
    if (!currentOrgId) return;
    try {
      const data = await getMembers(currentOrgId);
      setMembers(data);
    } catch (err) {
      console.error('Failed to load members:', err);
    }
  }, [currentOrgId]);

  useEffect(() => {
    if (session) {
      setIsLoading(true);
      refreshOrgs().finally(() => setIsLoading(false));
    }
  }, [session]);

  useEffect(() => {
    if (currentOrgId) {
      refreshMembers();
      if (typeof window !== 'undefined') {
        localStorage.setItem('puppyone_current_org', currentOrgId);
      }
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
        isLoading,
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
