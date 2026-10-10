export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '12345678', '123456789',
  'qwerty123', 'admin123', 'iloveyou', 'welcome1', 'letmein123',
]);

export function getPasswordPolicyError(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return 'Password must be at least 8 characters.';
  if (password.length > PASSWORD_MAX_LENGTH) return 'Password must be no more than 128 characters.';
  if (COMMON_PASSWORDS.has(password.toLowerCase())) return 'Choose a less common password that is harder to guess.';
  return null;
}

export function getPasswordGuidance(password: string): string[] {
  return [
    password.length >= PASSWORD_MIN_LENGTH ? 'At least 8 characters' : 'Use at least 8 characters',
    password.length <= PASSWORD_MAX_LENGTH ? '128 characters or fewer' : 'Keep it to 128 characters or fewer',
    /[a-z]/.test(password) && /[A-Z]/.test(password) ? 'Uppercase and lowercase letters' : 'Consider mixing uppercase and lowercase letters',
    /\d/.test(password) ? 'Includes a number' : 'Consider adding a number',
    /[^A-Za-z0-9]/.test(password) ? 'Includes a symbol' : 'Consider adding a symbol',
  ];
}
