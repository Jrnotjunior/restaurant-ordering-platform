export type AuthEntry =
  | 'tenant-invitation'
  | 'employee-invitation'
  | 'rider-invitation'
  | 'customer-or-public'
  | 'normal-app';

function pathEndsWith(pathname: string, value: string) {
  return pathname.endsWith(value) || pathname.endsWith(`${value}/`);
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

  const pathname = location.pathname;
  const isEmployeeInvitation =
    pathEndsWith(pathname, '/employee-invite') ||
    search.get('employee-invite') === '1';

  if (isEmployeeInvitation) return 'employee-invitation';

  const isRiderInvitation =
    pathEndsWith(pathname, '/invite') ||
    search.get('invite') === '1';

  if (isRiderInvitation) return 'rider-invitation';

  const isTenantInvitation =
    search.get('tenant-invite') === '1' ||
    search.get('tenant-owner-access') === '1' ||
    search.has('confirmation_url') ||
    search.get('flow') === 'tenant-owner';

  if (isTenantInvitation) return 'tenant-invitation';

  // Customer confirmation/password-recovery callbacks intentionally fall
  // through to the normal application. Their token is handled by Supabase
  // Auth, not by the tenant invitation screen.
  void hash;

  return 'normal-app';
}
