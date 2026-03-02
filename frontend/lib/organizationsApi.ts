import { apiRequest } from './apiClient';

export type OrganizationInfo = {
  id: string;
  name: string;
  slug: string;
  avatar_url?: string | null;
  type?: string;
  plan: string;
  seat_limit: number;
  created_at: string;
  member_count?: number;
};

export type OrgMember = {
  id: string;
  user_id: string;
  email?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  role: 'owner' | 'member' | 'viewer';
  joined_at: string;
};

export type OrgInvitation = {
  id: string;
  email: string;
  role: string;
  status: string;
  expires_at: string;
  created_at: string;
};

export async function getOrganizations(): Promise<OrganizationInfo[]> {
  return apiRequest<OrganizationInfo[]>('/api/v1/organizations/');
}

export async function getOrganization(orgId: string): Promise<OrganizationInfo> {
  return apiRequest<OrganizationInfo>(`/api/v1/organizations/${orgId}`);
}

export async function createOrganization(name: string, slug?: string): Promise<OrganizationInfo> {
  return apiRequest<OrganizationInfo>('/api/v1/organizations/', {
    method: 'POST',
    body: JSON.stringify({ name, slug }),
  });
}

export async function updateOrganization(
  orgId: string,
  data: { name?: string; avatar_url?: string }
): Promise<OrganizationInfo> {
  return apiRequest<OrganizationInfo>(`/api/v1/organizations/${orgId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteOrganization(orgId: string): Promise<void> {
  return apiRequest<void>(`/api/v1/organizations/${orgId}`, { method: 'DELETE' });
}

export async function getMembers(orgId: string): Promise<OrgMember[]> {
  return apiRequest<OrgMember[]>(`/api/v1/organizations/${orgId}/members`);
}

export async function inviteMember(
  orgId: string,
  email: string,
  role: string = 'member'
): Promise<OrgInvitation> {
  return apiRequest<OrgInvitation>(`/api/v1/organizations/${orgId}/invite`, {
    method: 'POST',
    body: JSON.stringify({ email, role }),
  });
}

export async function updateMemberRole(
  orgId: string,
  targetUserId: string,
  role: string
): Promise<void> {
  return apiRequest<void>(
    `/api/v1/organizations/${orgId}/members/${targetUserId}/role`,
    { method: 'PUT', body: JSON.stringify({ role }) }
  );
}

export async function removeMember(orgId: string, targetUserId: string): Promise<void> {
  return apiRequest<void>(
    `/api/v1/organizations/${orgId}/members/${targetUserId}`,
    { method: 'DELETE' }
  );
}

export async function leaveOrganization(orgId: string): Promise<void> {
  return apiRequest<void>(`/api/v1/organizations/${orgId}/leave`, { method: 'POST' });
}

export async function getInvitations(orgId: string): Promise<OrgInvitation[]> {
  return apiRequest<OrgInvitation[]>(`/api/v1/organizations/${orgId}/invitations`);
}

export async function acceptInvitation(token: string): Promise<void> {
  return apiRequest<void>(`/api/v1/organizations/invitations/${token}/accept`, {
    method: 'POST',
  });
}
