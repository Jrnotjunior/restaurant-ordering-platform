export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

const COMMON_PASSWORDS = new Set(['password', 'password1', 'password123', '12345678', '123456789', 'qwerty123', 'admin123', 'iloveyou', 'welcome1', 'letmein123']);

export function isCommonPassword(password: string): boolean {
  return COMMON_PASSWORDS.has(password.toLowerCase());
}

export function getPasswordPolicyError(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return 'Password must be at least 8 characters.';
  if (password.length > PASSWORD_MAX_LENGTH) return 'Password must be no more than 128 characters.';
  if (!/[a-z]/.test(password)) return 'Password must include at least one lowercase letter.';
  if (!/[A-Z]/.test(password)) return 'Password must include at least one uppercase letter.';
  if (!/\d/.test(password)) return 'Password must include at least one number.';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must include at least one symbol.';
  if (isCommonPassword(password)) return 'Choose a less common password that is harder to guess.';
  return null;
}

export function getPasswordGuidance(password: string): Array<{ label: string; met: boolean }> {
  return [
    { label: 'At least 8 characters', met: password.length >= PASSWORD_MIN_LENGTH },
    { label: 'Lowercase letter', met: /[a-z]/.test(password) },
    { label: 'Uppercase letter', met: /[A-Z]/.test(password) },
    { label: 'Number', met: /\d/.test(password) },
    { label: 'Symbol', met: /[^A-Za-z0-9]/.test(password) },
    { label: 'Not a common password', met: password.length > 0 && !isCommonPassword(password) },
  ];
}
