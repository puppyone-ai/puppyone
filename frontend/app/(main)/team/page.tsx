'use client';

import React, { useState } from 'react';
import { useOrganization } from '@/contexts/OrganizationContext';
import {
  inviteMember,
  updateMemberRole,
  removeMember,
} from '@/lib/organizationsApi';
import { PageLoading, Dots } from '@/components/loading';
import { OrganizationPageShell } from '@/components/organization/OrganizationPageShell';
import { Mail, Send, Trash2, X } from 'lucide-react';

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  member: 'Member',
  viewer: 'Viewer',
};

const ROLE_COLORS: Record<string, string> = {
  owner: '#f59e0b',
  member: '#3b82f6',
  viewer: '#6b7280',
};

export default function TeamPage() {
  const { currentOrg, members, myRole, refreshMembers } = useOrganization();
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'member' | 'viewer'>('member');
  const [inviting, setInviting] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; msg: string } | null>(null);

  const isOwner = myRole === 'owner';

  const handleInvite = async () => {
    if (!currentOrg || !inviteEmail.trim()) return;
    setInviting(true);
    setFeedback(null);
    try {
      await inviteMember(currentOrg.id, inviteEmail.trim(), inviteRole);
      setFeedback({ type: 'success', msg: `Invitation sent to ${inviteEmail}` });
      setInviteEmail('');
      setShowInvite(false);
      await refreshMembers();
      setTimeout(() => setFeedback(null), 3000);
    } catch (err: any) {
      setFeedback({ type: 'error', msg: err.message || 'Failed to send invitation' });
    } finally {
      setInviting(false);
    }
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    if (!currentOrg) return;
    try {
      await updateMemberRole(currentOrg.id, userId, newRole);
      await refreshMembers();
      setFeedback({ type: 'success', msg: 'Role updated successfully' });
      setTimeout(() => setFeedback(null), 3000);
    } catch (err: any) {
      setFeedback({ type: 'error', msg: err.message || 'Failed to update role' });
    }
  };

  const handleRemove = async (userId: string, displayName: string) => {
    if (!currentOrg) return;
    if (!confirm(`Remove ${displayName} from the organization?`)) return;
    try {
      await removeMember(currentOrg.id, userId);
      await refreshMembers();
      setFeedback({ type: 'success', msg: 'Member removed successfully' });
      setTimeout(() => setFeedback(null), 3000);
    } catch (err: any) {
      setFeedback({ type: 'error', msg: err.message || 'Failed to remove member' });
    }
  };

  if (!currentOrg) {
    return (
      <div className="flex-1">
        <PageLoading variant="fill" />
      </div>
    );
  }

  return (
    <OrganizationPageShell
      title="Team"
      description={`Manage members and their access to ${currentOrg.name}.`}
      actions={
        isOwner && !showInvite ? (
          <button
            onClick={() => setShowInvite(true)}
            className="flex h-8 items-center gap-2 rounded-md bg-white px-3 text-[14px] font-medium text-black transition-colors hover:bg-[#e8e8e8]"
          >
            <Mail size={14} strokeWidth={2} />
            Invite Member
          </button>
        ) : null
      }
    >
        {/* Feedback */}
        {feedback && (
          <div className={`mb-6 flex items-center justify-between rounded-[8px] border px-4 py-3 text-[13px] font-medium ${feedback.type === 'error' ? 'border-red-500/25 bg-red-500/[0.08] text-red-400' : 'border-emerald-500/25 bg-emerald-500/[0.08] text-emerald-400'}`} style={{ animation: 'dialog-fade-in 0.2s ease-out' }}>
            {feedback.msg}
            <button onClick={() => setFeedback(null)} className="flex opacity-75 transition-opacity hover:opacity-100">
              <X size={14} strokeWidth={2} />
            </button>
          </div>
        )}

        {/* Main Card */}
        <div className="overflow-hidden rounded-[8px] border border-white/[0.08] bg-[#101010]">
          
          {/* Card Header */}
          <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-4">
            <div>
              <h2 className="mb-1 text-[14px] font-medium text-[#e4e4e7]">Members</h2>
              <div className="text-[13px] text-[#71717a]">
                {members.length} / {currentOrg.seat_limit} seats used in your {currentOrg.plan} plan.
              </div>
            </div>
          </div>

          {/* Invite Form */}
          {showInvite && (
            <div className="border-b border-white/[0.08] bg-[#141414] px-5 py-4" style={{ animation: 'dialog-fade-in 0.15s ease-out' }}>
              <div className="flex gap-3">
                <input
                  type="email"
                  placeholder="Email address"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="h-8 flex-1 rounded-md border border-white/[0.1] bg-[#0b0b0b] px-3 text-[14px] text-[#e4e4e7] outline-none transition-colors placeholder:text-[#52525b] focus:border-[#52525b]"
                  onKeyDown={(e) => e.key === 'Enter' && handleInvite()}
                  autoFocus
                />
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as 'member' | 'viewer')}
                  className="h-8 w-32 rounded-md border border-white/[0.1] bg-[#0b0b0b] px-3 text-[14px] text-[#e4e4e7] outline-none transition-colors focus:border-[#52525b]"
                >
                  <option value="member">Member</option>
                  <option value="viewer">Viewer</option>
                </select>
                <button
                  onClick={handleInvite}
                  disabled={inviting || !inviteEmail.trim()}
                  className={`flex h-8 items-center gap-2 rounded-md bg-white px-3 text-[14px] font-medium text-black transition-colors ${inviting || !inviteEmail.trim() ? 'cursor-not-allowed opacity-50' : 'hover:bg-[#e8e8e8]'}`}
                >
                  {inviting ? <Dots size="xs" /> : <Send size={14} strokeWidth={2} />}
                  {inviting ? 'Sending…' : 'Send Invite'}
                </button>
                <button 
                  onClick={() => setShowInvite(false)} 
                  className="flex h-8 items-center gap-2 rounded-md border border-white/[0.1] bg-[#1a1a1a] px-3 text-[14px] font-medium text-[#d4d4d8] transition-colors hover:bg-[#232323]"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Members List */}
          <div className="flex flex-col">
            {members.map((m, index) => {
              const name = m.display_name || m.email || m.user_id.slice(0, 8);
              const initial = (name[0] || '?').toUpperCase();
              const isLast = index === members.length - 1;
              
              return (
                <div key={m.id} className={`flex items-center justify-between px-5 py-4 ${isLast ? '' : 'border-b border-white/[0.06]'}`}>
                  <div className="flex items-center gap-4">
                    {m.avatar_url ? (
                      <img src={m.avatar_url} alt="" className="h-9 w-9 rounded-full object-cover" />
                    ) : (
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#242428] text-[13px] font-semibold text-[#a1a1aa]">
                        {initial}
                      </div>
                    )}
                    <div>
                      <div className="flex items-center gap-2 text-[14px] font-medium text-[#e4e4e7]">
                        {name}
                        {m.role === 'owner' && (
                          <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-500">Owner</span>
                        )}
                      </div>
                      {m.email && m.display_name && (
                        <div className="mt-0.5 text-[13px] text-[#71717a]">{m.email}</div>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-4">
                    {isOwner && m.role !== 'owner' ? (
                      <>
                        <div className="relative">
                          <select
                            value={m.role}
                            onChange={(e) => handleRoleChange(m.user_id, e.target.value)}
                            className="h-8 cursor-pointer appearance-none border-transparent bg-transparent py-1.5 pl-3 pr-7 text-[14px] outline-none"
                            style={{ color: ROLE_COLORS[m.role] || '#e4e4e7' }}
                          >
                            <option value="member" className="text-[#e4e4e7] bg-[#09090b]">Member</option>
                            <option value="viewer" className="text-[#e4e4e7] bg-[#09090b]">Viewer</option>
                          </select>
                          <div className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[#52525b]">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                          </div>
                        </div>
                        <div className="h-5 w-px bg-white/[0.08]"></div>
                        <button
                          onClick={() => handleRemove(m.user_id, name)}
                          className="flex items-center p-1 text-[#71717a] transition-colors hover:text-red-500"
                          title="Remove member"
                        >
                          <Trash2 size={14} strokeWidth={2} />
                        </button>
                      </>
                    ) : (
                      <span className="text-[14px] font-medium" style={{ color: ROLE_COLORS[m.role] || '#71717a' }}>
                        {ROLE_LABELS[m.role] || m.role}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

      <style jsx>{`
        @keyframes dialog-fade-in {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </OrganizationPageShell>
  );
}
