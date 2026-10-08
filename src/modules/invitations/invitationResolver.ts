import type { InvitationType } from './invitationTypes';
import { isInvitationType } from './invitationTypes';

export function resolveInvitationTypeFromMetadata(metadata: unknown): InvitationType | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const value = (metadata as { invitation_type?: unknown }).invitation_type;
  return isInvitationType(value) ? value : null;
}

export function getInvitationEntryUrl(type: InvitationType) {
  const base = `${window.location.origin}${import.meta.env.BASE_URL}`;
  return type === 'employee_staff'
    ? `${base}?employee-invite=1`
    : `${base}?tenant-invite=1&tenant-onboarding=1`;
}

export function resolveInvitationTypeFromLocation(
  location: Pick<Location, 'pathname' | 'search'>
): InvitationType | null {
  const search = new URLSearchParams(location.search);
  const pathname = location.pathname;

  if (
    pathname.endsWith('/employee-invite') ||
    pathname.endsWith('/employee-invite/') ||
    search.get('employee-invite') === '1' ||
    search.get('flow') === 'employee-invite'
  ) {
    return 'employee_staff';
  }

  if (
    search.get('tenant-invite') === '1' ||
    search.get('tenant-owner-access') === '1' ||
    search.get('flow') === 'tenant-owner'
  ) {
    return 'tenant_owner';
  }

  return null;
}
