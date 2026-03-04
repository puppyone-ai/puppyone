'use client';

import React, { useState } from 'react';
import { useOrganization } from '@/contexts/OrganizationContext';
import {
  inviteMember,
  updateMemberRole,
  removeMember,
} from '@/lib/organizationsApi';

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

// SVG Icons
const MailIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
    <polyline points="22,6 12,13 2,6"></polyline>
  </svg>
);

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"></polyline>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
  </svg>
);

const SendIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="22" y1="2" x2="11" y2="13"></line>
    <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
  </svg>
);

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
      <div className="flex-1 flex items-center justify-center p-8">
        <span className="text-sm text-[#666]">Loading...</span>
      </div>
    );
  }

  return (
    <div className="flex-1 p-8 overflow-y-auto flex justify-center">
      <div className="w-full max-w-4xl">
        
        {/* Header Section */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-xl font-semibold text-[#eee] tracking-tight">Team</h1>
            <p className="text-sm text-[#666] mt-1">
              Manage members and their access to {currentOrg.name}.
            </p>
          </div>
        </div>

        {/* Feedback */}
        {feedback && (
          <div className={`flex justify-between items-center px-4 py-3 mb-6 rounded-lg text-sm font-medium border ${feedback.type === 'error' ? 'bg-red-500/10 border-red-500/30 text-red-400' : 'bg-green-500/10 border-green-500/30 text-green-400'}`} style={{ animation: 'dialog-fade-in 0.2s ease-out' }}>
            {feedback.msg}
            <button onClick={() => setFeedback(null)} className="opacity-80 hover:opacity-100 flex"><TrashIcon /></button>
          </div>
        )}

        {/* Main Card */}
        <div className="border border-[#27272a] rounded-xl overflow-hidden bg-[#09090b] shadow-sm">
          
          {/* Card Header */}
          <div className="px-6 py-5 border-b border-[#1f1f23] flex justify-between items-center">
            <div>
              <h2 className="text-sm font-medium text-[#e4e4e7] mb-1">Organization Members</h2>
              <div className="text-sm text-[#71717a]">
                {members.length} / {currentOrg.seat_limit} seats used in your {currentOrg.plan} plan.
              </div>
            </div>
            {isOwner && !showInvite && (
              <button 
                onClick={() => setShowInvite(true)} 
                className="flex items-center gap-2 rounded-md bg-white text-black px-3 h-8 text-sm font-medium hover:bg-gray-200 transition-all"
              >
                <MailIcon /> Invite Member
              </button>
            )}
          </div>

          {/* Invite Form */}
          {showInvite && (
            <div className="px-6 py-4 bg-[#141416] border-b border-[#1f1f23]" style={{ animation: 'dialog-fade-in 0.15s ease-out' }}>
              <div className="flex gap-3">
                <input
                  type="email"
                  placeholder="Email address"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="flex-1 bg-[#09090b] border border-[#27272a] rounded-md px-3 h-8 text-[#e4e4e7] text-sm outline-none focus:border-[#52525b] transition-colors"
                  onKeyDown={(e) => e.key === 'Enter' && handleInvite()}
                  autoFocus
                />
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as 'member' | 'viewer')}
                  className="w-32 bg-[#09090b] border border-[#27272a] rounded-md px-3 h-8 text-[#e4e4e7] text-sm outline-none focus:border-[#52525b] transition-colors"
                >
                  <option value="member">Member</option>
                  <option value="viewer">Viewer</option>
                </select>
                <button
                  onClick={handleInvite}
                  disabled={inviting || !inviteEmail.trim()}
                  className={`flex items-center gap-2 rounded-md bg-white text-black px-3 h-8 text-sm font-medium transition-all ${inviting || !inviteEmail.trim() ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-200'}`}
                >
                  <SendIcon /> {inviting ? 'Sending...' : 'Send Invite'}
                </button>
                <button 
                  onClick={() => setShowInvite(false)} 
                  className="flex items-center gap-2 rounded-md bg-[#18181b] border border-[#27272a] text-[#e4e4e7] px-3 h-8 text-sm font-medium hover:bg-[#27272a] transition-all"
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
                <div key={m.id} className={`flex justify-between items-center px-6 py-4 bg-[#09090b] ${isLast ? '' : 'border-b border-[#1f1f23]'}`}>
                  <div className="flex items-center gap-4">
                    {m.avatar_url ? (
                      <img src={m.avatar_url} alt="" className="w-10 h-10 rounded-full object-cover" />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-[#27272a] flex items-center justify-center text-sm font-semibold text-[#a1a1aa]">
                        {initial}
                      </div>
                    )}
                    <div>
                      <div className="text-sm font-medium text-[#e4e4e7] flex items-center gap-2">
                        {name}
                        {m.role === 'owner' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 uppercase font-semibold tracking-wider">Owner</span>
                        )}
                      </div>
                      {m.email && m.display_name && (
                        <div className="text-sm text-[#71717a] mt-0.5">{m.email}</div>
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
                            className="pl-3 pr-7 py-1.5 h-8 text-sm bg-transparent border-transparent cursor-pointer appearance-none outline-none"
                            style={{ color: ROLE_COLORS[m.role] || '#e4e4e7' }}
                          >
                            <option value="member" className="text-[#e4e4e7] bg-[#09090b]">Member</option>
                            <option value="viewer" className="text-[#e4e4e7] bg-[#09090b]">Viewer</option>
                          </select>
                          <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-[#52525b]">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                          </div>
                        </div>
                        <div className="w-px h-5 bg-[#27272a]"></div>
                        <button
                          onClick={() => handleRemove(m.user_id, name)}
                          className="text-[#71717a] hover:text-red-500 p-1 flex items-center transition-colors"
                          title="Remove member"
                        >
                          <TrashIcon />
                        </button>
                      </>
                    ) : (
                      <span className="text-sm font-medium" style={{ color: ROLE_COLORS[m.role] || '#71717a' }}>
                        {ROLE_LABELS[m.role] || m.role}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes dialog-fade-in {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
