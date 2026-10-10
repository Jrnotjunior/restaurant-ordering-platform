export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '12345678', '123456789',
  'qwerty123', 'admin123', 'iloveyou', 'welcome1', 'letmein123',
]);

export function getPasswordPolicyError(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return 'Password must be at least 8 characters.';
  if (password.length > PASSWORD_MAX_LENGTH) return 'Password must be no more than 128 characters.';
  if (!/[a-z]/.test(password)) return 'Password must include at least one lowercase letter.';
  if (!/[A-Z]/.test(password)) return 'Password must include at least one uppercase letter.';
  if (!/\d/.test(password)) return 'Password must include at least one number.';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must include at least one symbol.';
  if (COMMON_PASSWORDS.has(password.toLowerCase())) return 'Choose a less common password that is harder to guess.';
  return null;
}

export function getPasswordGuidance(password: string): string[] {
  return [
    password.length >= PASSWORD_MIN_LENGTH ? 'At least 8 characters' : 'Use at least 8 characters',
    password.length <= PASSWORD_MAX_LENGTH ? '128 characters or fewer' : 'Keep it to 128 characters or fewer',
    /[a-z]/.test(password) ? 'Includes a lowercase letter' : 'Add a lowercase letter',
    /[A-Z]/.test(password) ? 'Includes an uppercase letter' : 'Add an uppercase letter',
    /\d/.test(password) ? 'Includes a number' : 'Add a number',
    /[^A-Za-z0-9]/.test(password) ? 'Includes a symbol' : 'Add a symbol',
    COMMON_PASSWORDS.has(password.toLowerCase()) ? 'Avoid common passwords' : 'Not a common password',
  ];
}
