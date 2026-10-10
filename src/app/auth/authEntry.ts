import { resolveInvitationTypeFromLocation } from '../../modules/invitations/invitationResolver';

export type AuthEntry =
  | 'tenant-invitation'
  | 'employee-invitation'
  | 'rider-invitation'
  | 'customer-or-public'
  | 'normal-app';

function pathEndsWith(pathname: string, value: string) {
  return pathname.endsWith(value) || pathname.endsWith(`${value}/`);
}

function hasNestedFlowMarker(search: URLSearchParams, marker: string) {
  const confirmationUrl = search.get('confirmation_url');
  if (!confirmationUrl) return false;

  try {
    const nested = new URL(confirmationUrl, 'https://invalid.local');
    return nested.searchParams.get(marker) === '1'
      || nested.pathname.endsWith(`/${marker}`)
      || nested.pathname.endsWith(`/${marker}/`);
  } catch {
    return confirmationUrl.includes(`${marker}=1`);
  }
}

/**
 * Resolves the purpose of an incoming Auth callback.
 *
 * Important: a generic token_hash is NOT an invitation signal. Customer
 * email-confirmation links also carry Auth callback parameters. Invitation
 * flows must carry an explicit flow marker or invitation-specific path.
 */
export function resolveAuthEntry(location: Pick<Location, 'pathname' | 'search' | 'hash'>): AuthEntry {
  const search = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));

  // The tenant onboarding destination intentionally carries tenant-invite=1
  // as context. It must reach AppContent's onboarding route, not be captured
  // again by this callback entry resolver (which would loop on the landing page).
  if (search.get('tenant-onboarding') === '1') return 'normal-app';

  const pathname = location.pathname;
  const invitationType = resolveInvitationTypeFromLocation(location);
  const isGenericInvitation = search.get('invitation') === '1';
  const isEmployeeInvitation =
    invitationType === 'employee_staff' ||
    hasNestedFlowMarker(search, 'employee-invite');

  if (isEmployeeInvitation) return 'employee-invitation';

  if (isGenericInvitation) return 'tenant-invitation';

  const isRiderInvitation =
    pathEndsWith(pathname, '/invite') ||
    search.get('invite') === '1';

  if (isRiderInvitation) return 'rider-invitation';

  const isTenantInvitation =
    invitationType === 'tenant_owner' ||
    (search.has('confirmation_url') && !hasNestedFlowMarker(search, 'employee-invite'));

  if (isTenantInvitation) return 'tenant-invitation';

  void hash;

  return 'normal-app';
}
