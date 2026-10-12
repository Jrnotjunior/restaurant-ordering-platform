export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Shared customer password policy.
 * Keep this consistent across registration, password changes, and recovery.
 * Supabase remains responsible for authentication and server-side enforcement.
 */
export function getPasswordPolicyError(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return 'Password must be at least 8 characters.';
  if (password.length > PASSWORD_MAX_LENGTH) return 'Password must be no more than 128 characters.';
  return null;
}

export function getPasswordGuidance(_password: string): string[] {
  return ['Use at least 8 characters', '128 characters or fewer'];
}
