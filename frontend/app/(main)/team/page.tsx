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
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
      <div style={styles.empty}>
        <span style={styles.emptyText}>Loading...</span>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.content}>
        
        {/* Header */}
        <div style={{ marginBottom: 40 }}>
          <h1 style={styles.title}>Team</h1>
          <p style={styles.subtitle}>
            Manage members and their access to {currentOrg.name}.
          </p>
        </div>

        {/* Feedback */}
        {feedback && (
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '12px 16px', marginBottom: 24, borderRadius: 8, fontSize: 13, fontWeight: 500,
            background: feedback.type === 'error' ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
            border: `1px solid ${feedback.type === 'error' ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`,
            color: feedback.type === 'error' ? '#f87171' : '#4ade80',
            animation: 'dialog-fade-in 0.2s ease-out',
          }}>
            {feedback.msg}
            <button onClick={() => setFeedback(null)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', opacity: 0.8, display: 'flex' }}><TrashIcon /></button>
          </div>
        )}

        {/* Main Card */}
        <div style={styles.cardBox}>
          
          {/* Card Header */}
          <div style={{ padding: '20px 24px', borderBottom: '1px solid #1f1f23', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 500, color: '#e4e4e7', margin: '0 0 4px 0' }}>Organization Members</h2>
              <div style={{ fontSize: 13, color: '#71717a' }}>
                {members.length} / {currentOrg.seat_limit} seats used in your {currentOrg.plan} plan.
              </div>
            </div>
            {isOwner && !showInvite && (
              <button onClick={() => setShowInvite(true)} style={styles.btnPrimary}>
                <MailIcon /> Invite Member
              </button>
            )}
          </div>

          {/* Invite Form */}
          {showInvite && (
            <div style={{ padding: '16px 24px', background: '#141416', borderBottom: '1px solid #1f1f23', animation: 'dialog-fade-in 0.15s ease-out' }}>
              <div style={{ display: 'flex', gap: 12 }}>
                <input
                  type="email"
                  placeholder="Email address"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  style={styles.input}
                  onKeyDown={(e) => e.key === 'Enter' && handleInvite()}
                  autoFocus
                />
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as 'member' | 'viewer')}
                  style={{ ...styles.select, maxWidth: 140 }}
                >
                  <option value="member">Member</option>
                  <option value="viewer">Viewer</option>
                </select>
                <button
                  onClick={handleInvite}
                  disabled={inviting || !inviteEmail.trim()}
                  style={{ ...styles.btnPrimary, opacity: inviting || !inviteEmail.trim() ? 0.5 : 1 }}
                >
                  <SendIcon /> {inviting ? 'Sending...' : 'Send Invite'}
                </button>
                <button onClick={() => setShowInvite(false)} style={styles.btnSecondary}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Members List */}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {members.map((m, index) => {
              const name = m.display_name || m.email || m.user_id.slice(0, 8);
              const initial = (name[0] || '?').toUpperCase();
              const isLast = index === members.length - 1;
              
              return (
                <div key={m.id} style={{ 
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', 
                  padding: '16px 24px', 
                  borderBottom: isLast ? 'none' : '1px solid #1f1f23',
                  background: '#09090b'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    {m.avatar_url ? (
                      <img src={m.avatar_url} alt="" style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover' }} />
                    ) : (
                      <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#27272a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 600, color: '#a1a1aa' }}>
                        {initial}
                      </div>
                    )}
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 500, color: '#e4e4e7', display: 'flex', alignItems: 'center', gap: 8 }}>
                        {name}
                        {m.role === 'owner' && (
                          <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em' }}>Owner</span>
                        )}
                      </div>
                      {m.email && m.display_name && (
                        <div style={{ fontSize: 13, color: '#71717a', marginTop: 2 }}>{m.email}</div>
                      )}
                    </div>
                  </div>
                  
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    {isOwner && m.role !== 'owner' ? (
                      <>
                        <div style={{ position: 'relative' }}>
                          <select
                            value={m.role}
                            onChange={(e) => handleRoleChange(m.user_id, e.target.value)}
                            style={{ ...styles.select, padding: '6px 28px 6px 12px', height: 32, fontSize: 13, color: ROLE_COLORS[m.role] || '#e4e4e7', background: 'transparent', borderColor: 'transparent', cursor: 'pointer', appearance: 'none', WebkitAppearance: 'none' }}
                          >
                            <option value="member">Member</option>
                            <option value="viewer">Viewer</option>
                          </select>
                          <div style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#52525b' }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                          </div>
                        </div>
                        <div style={{ width: 1, height: 20, background: '#27272a' }}></div>
                        <button
                          onClick={() => handleRemove(m.user_id, name)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#71717a', padding: 4, display: 'flex', alignItems: 'center', transition: 'color 0.15s' }}
                          title="Remove member"
                          onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                          onMouseLeave={e => e.currentTarget.style.color = '#71717a'}
                        >
                          <TrashIcon />
                        </button>
                      </>
                    ) : (
                      <span style={{ fontSize: 13, color: ROLE_COLORS[m.role] || '#71717a', fontWeight: 500 }}>
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

const styles: Record<string, React.CSSProperties> = {
  container: {
    flex: 1,
    display: 'flex',
    justifyContent: 'center',
    padding: '48px 24px',
    overflowY: 'auto',
    background: '#000', // Fits standard dark mode bg
  },
  content: {
    width: '100%',
    maxWidth: 768,
  },
  title: {
    fontSize: 24,
    fontWeight: 600,
    color: '#e4e4e7',
    margin: '0 0 8px 0',
    fontFamily: '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, sans-serif',
  },
  subtitle: {
    fontSize: 14,
    color: '#a1a1aa',
    margin: 0,
  },
  cardBox: {
    border: '1px solid #27272a',
    borderRadius: 12,
    overflow: 'hidden',
    background: '#09090b',
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
  },
  input: {
    flex: 1,
    background: '#09090b',
    border: '1px solid #27272a',
    borderRadius: 6,
    padding: '8px 12px',
    color: '#e4e4e7',
    fontSize: 13,
    outline: 'none',
    transition: 'border-color 0.15s',
  },
  select: {
    background: '#09090b',
    border: '1px solid #27272a',
    borderRadius: 6,
    padding: '8px 12px',
    color: '#e4e4e7',
    fontSize: 13,
    outline: 'none',
    transition: 'border-color 0.15s',
  },
  btnPrimary: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 16px',
    background: '#e4e4e7',
    border: 'none',
    borderRadius: 6,
    color: '#09090b',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    transition: 'all 0.15s',
  },
  btnSecondary: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 16px',
    background: '#18181b',
    border: '1px solid #27272a',
    borderRadius: 6,
    color: '#e4e4e7',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
  empty: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    background: '#000',
  },
  emptyText: {
    fontSize: 14,
    color: '#52525b',
  },
};
